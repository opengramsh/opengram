/**
 * GRAM-056 — Production dispatch path: SDK dispatch when no injected dispatch fn.
 *
 * When `dispatch` is not injected (the production case — see channel.ts gateway),
 * `handleMessageCreated` and `handleRequestResolved` must fall through to the
 * SDK's `dispatchReplyWithBufferedBlockDispatcher` via the PluginRuntime singleton.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { OpenGramClient } from "../src/api-client.js";
import { initializeChatManager } from "../src/chat-manager.js";
import { clearProcessedIdsForTests, startInboundListener } from "../src/inbound.js";
import { setOpenGramRuntime } from "../src/runtime.js";
import { clearActiveStreamsForTests } from "../src/streaming.js";
import type { Chat, ListChatsResponse } from "../src/types.js";

function createMockClient(overrides?: Partial<OpenGramClient>): OpenGramClient {
  return {
    createMessage: vi.fn().mockResolvedValue({ id: "msg-1" }),
    sendChunk: vi.fn().mockResolvedValue(undefined),
    completeMessage: vi.fn().mockResolvedValue(undefined),
    cancelMessage: vi.fn().mockResolvedValue(undefined),
    getChat: vi.fn().mockResolvedValue({ id: "chat-1", agentIds: ["grami"] } as Chat),
    listChats: vi.fn().mockResolvedValue({ data: [], cursor: { hasMore: false } } as ListChatsResponse),
    connectSSE: vi.fn(),
    health: vi.fn().mockResolvedValue({ status: "ok", version: "1.0.0", uptime: 100 }),
    uploadMedia: vi.fn().mockResolvedValue({ id: "media-1" }),
    ...overrides,
  } as unknown as OpenGramClient;
}

const baseCfg = {
  channels: {
    opengram: {
      enabled: true,
      baseUrl: "http://localhost:3000",
      agents: ["grami"],
    },
  },
};

function createMockEventSource() {
  let onmessage: ((event: MessageEvent) => void) | null = null;
  let onerror: ((event: Event) => void) | null = null;
  let onopen: (() => void) | null = null;

  return {
    get onmessage() { return onmessage; },
    set onmessage(fn: ((event: MessageEvent) => void) | null) { onmessage = fn; },
    get onerror() { return onerror; },
    set onerror(fn: ((event: Event) => void) | null) { onerror = fn; },
    get onopen() { return onopen; },
    set onopen(fn: (() => void) | null) {
      onopen = fn;
      if (fn) fn();
    },
    close: vi.fn(),
    addEventListener: vi.fn(),
    triggerMessage(data: unknown) {
      if (onmessage) {
        onmessage(new MessageEvent("message", { data: JSON.stringify(data) }));
      }
    },
    triggerError(event?: Partial<Event & { code?: number; message?: string }>) {
      if (onerror) {
        onerror(event as Event);
      }
    },
  };
}

/**
 * Build a minimal mock PluginRuntime that captures dispatch calls.
 * The `dispatchReplyWithBufferedBlockDispatcher` mock simulates a successful
 * agent reply by calling the deliver callback with a final text payload.
 */
function createMockRuntime() {
  const dispatchSpy = vi.fn().mockImplementation(async (params: any) => {
    // Simulate the agent replying via the deliver callback
    await params.dispatcherOptions.deliver(
      { text: "Agent reply from SDK" },
      { kind: "final" },
    );
    return { status: "ok" };
  });

  const finalizeInboundContextSpy = vi.fn().mockImplementation((ctx: any) => ({
    ...ctx,
    CommandAuthorized: ctx.CommandAuthorized ?? false,
  }));

  const resolveAgentRouteSpy = vi.fn().mockReturnValue({
    agentId: "grami",
    channel: "opengram",
    accountId: "default",
    sessionKey: "agent:grami:opengram:direct:chat-1",
    mainSessionKey: "agent:grami:main",
    matchedBy: "default",
  });

  const runtime = {
    channel: {
      reply: {
        dispatchReplyWithBufferedBlockDispatcher: dispatchSpy,
        finalizeInboundContext: finalizeInboundContextSpy,
      },
      routing: {
        resolveAgentRoute: resolveAgentRouteSpy,
      },
    },
  };

  return { runtime, dispatchSpy, finalizeInboundContextSpy, resolveAgentRouteSpy };
}

describe("GRAM-056: production dispatch path (no injected dispatch)", () => {
  beforeEach(() => {
    clearActiveStreamsForTests();
    clearProcessedIdsForTests();
  });

  afterEach(() => {
    clearActiveStreamsForTests();
    clearProcessedIdsForTests();
  });

  it("should dispatch message.created via SDK when no injected dispatch fn", async () => {
    const { runtime, dispatchSpy, finalizeInboundContextSpy, resolveAgentRouteSpy } =
      createMockRuntime();
    setOpenGramRuntime(runtime as any);

    const client = createMockClient();
    await initializeChatManager(client, baseCfg);

    const mockEs = createMockEventSource();
    (client.connectSSE as ReturnType<typeof vi.fn>).mockReturnValue(mockEs);

    const abortController = new AbortController();

    // Start listener WITHOUT dispatch — production path
    startInboundListener({
      client,
      cfg: baseCfg,
      abortSignal: abortController.signal,
      reconnectDelayMs: 100,
      // dispatch is intentionally omitted — production path
    });

    // Send a user message
    mockEs.triggerMessage({
      id: "evt-prod-1",
      type: "message.created",
      payload: {
        chatId: "chat-1",
        messageId: "user-msg-prod-1",
        role: "user",
        content: "Hello from production!",
        senderId: "user:primary",
      },
    });

    // Wait for async processing
    await vi.waitFor(() => expect(dispatchSpy).toHaveBeenCalled());

    // Verify resolveAgentRoute was called with correct params
    expect(resolveAgentRouteSpy).toHaveBeenCalledWith({
      cfg: baseCfg,
      channel: "opengram",
      peer: { kind: "direct", id: "chat-1" },
    });

    // Verify finalizeInboundContext was called with correct MsgContext
    expect(finalizeInboundContextSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        Body: "Hello from production!",
        RawBody: "Hello from production!",
        CommandBody: "Hello from production!",
        From: "opengram:chat-1",
        To: "opengram:chat-1",
        SessionKey: "agent:grami:opengram:direct:chat-1",
        ChatType: "direct",
        Provider: "opengram",
        Surface: "opengram",
        MessageSid: "user-msg-prod-1",
        OriginatingChannel: "opengram",
        OriginatingTo: "opengram:chat-1",
        CommandAuthorized: true,
      }),
    );

    // Verify dispatchReplyWithBufferedBlockDispatcher was called
    const dispatchCall = dispatchSpy.mock.calls[0][0];
    expect(dispatchCall.cfg).toBe(baseCfg);
    expect(dispatchCall.ctx).toEqual(
      expect.objectContaining({ Body: "Hello from production!" }),
    );
    expect(dispatchCall.dispatcherOptions.deliver).toBeTypeOf("function");
    expect(dispatchCall.dispatcherOptions.onError).toBeTypeOf("function");

    // The mock runtime simulates an agent reply, which should trigger createMessage
    const createMessageCalls = (client.createMessage as ReturnType<typeof vi.fn>).mock.calls;
    const agentReplies = createMessageCalls.filter(
      ([_chatId, msg]: [string, { role: string }]) => msg.role === "agent",
    );
    expect(agentReplies.length).toBeGreaterThanOrEqual(1);
    expect(agentReplies[0][1].content).toBe("Agent reply from SDK");

    abortController.abort();
  });

  it("should dispatch request.resolved via SDK when no injected dispatch fn", async () => {
    const { runtime, dispatchSpy, finalizeInboundContextSpy } = createMockRuntime();
    setOpenGramRuntime(runtime as any);

    const client = createMockClient();
    await initializeChatManager(client, baseCfg);

    const mockEs = createMockEventSource();
    (client.connectSSE as ReturnType<typeof vi.fn>).mockReturnValue(mockEs);

    const abortController = new AbortController();

    // Start listener WITHOUT dispatch — production path
    startInboundListener({
      client,
      cfg: baseCfg,
      abortSignal: abortController.signal,
      reconnectDelayMs: 100,
    });

    // Send a request.resolved event
    mockEs.triggerMessage({
      id: "evt-req-prod-1",
      type: "request.resolved",
      payload: {
        chatId: "chat-1",
        requestId: "req-prod-1",
        type: "choice",
        title: "Deploy?",
        resolutionPayload: { selectedOptionIds: ["approve"] },
      },
    });

    await vi.waitFor(() => expect(dispatchSpy).toHaveBeenCalled());

    // Verify finalizeInboundContext was called with the formatted resolution body
    expect(finalizeInboundContextSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        Body: '[Request resolved: "Deploy?"] Selected: approve',
        MessageSid: "req:req-prod-1:resolved",
        SessionKey: "agent:grami:opengram:direct:chat-1",
      }),
    );

    // Verify the SDK dispatch happened
    const dispatchCall = dispatchSpy.mock.calls[0][0];
    expect(dispatchCall.ctx.Body).toBe('[Request resolved: "Deploy?"] Selected: approve');

    // The mock delivers a reply — verify it went through
    const createMessageCalls = (client.createMessage as ReturnType<typeof vi.fn>).mock.calls;
    const agentReplies = createMessageCalls.filter(
      ([_chatId, msg]: [string, { role: string }]) => msg.role === "agent",
    );
    expect(agentReplies.length).toBeGreaterThanOrEqual(1);

    abortController.abort();
  });

  it("should still use injected dispatch when provided", async () => {
    const { runtime, dispatchSpy } = createMockRuntime();
    setOpenGramRuntime(runtime as any);

    const client = createMockClient();
    await initializeChatManager(client, baseCfg);

    const mockEs = createMockEventSource();
    (client.connectSSE as ReturnType<typeof vi.fn>).mockReturnValue(mockEs);

    const injectedDispatch = vi.fn();
    const abortController = new AbortController();

    startInboundListener({
      client,
      cfg: baseCfg,
      abortSignal: abortController.signal,
      reconnectDelayMs: 100,
      dispatch: injectedDispatch,
    });

    mockEs.triggerMessage({
      id: "evt-inject-1",
      type: "message.created",
      payload: {
        chatId: "chat-1",
        messageId: "user-msg-inject-1",
        role: "user",
        content: "Hello with injected dispatch",
        senderId: "user:primary",
      },
    });

    await vi.waitFor(() => expect(injectedDispatch).toHaveBeenCalled());

    // SDK dispatch should NOT have been called
    expect(dispatchSpy).not.toHaveBeenCalled();

    abortController.abort();
  });
});
