/**
 * GRAM-058 — Production inbound dispatch uses per-chat session routing.
 *
 * When `dispatch` is not injected (the production case — see channel.ts gateway),
 * inbound handlers must use the SDK dispatcher and finalize context with
 * SessionKey `agent:<agentId>:...` so agent resolution is correct and
 * chats remain isolated.
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
    getChat: vi.fn().mockImplementation(async (chatId: string) => ({ id: chatId, agent_ids: ["grami"] } as Chat)),
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

  const resolveAgentRouteSpy = vi.fn().mockImplementation(({ peer }: { peer?: { id?: string } }) => {
    const chatId = peer?.id ?? "unknown";
    return {
      agentId: "main",
      channel: "opengram",
      accountId: "default",
      sessionKey: `agent:main:opengram:direct:${chatId}`,
      mainSessionKey: "agent:main:main",
      matchedBy: "default",
    };
  });

  const runtime = {
    channel: {
      routing: {
        resolveAgentRoute: resolveAgentRouteSpy,
      },
      reply: {
        dispatchReplyWithBufferedBlockDispatcher: dispatchSpy,
        finalizeInboundContext: finalizeInboundContextSpy,
      },
    },
  };

  return { runtime, dispatchSpy, finalizeInboundContextSpy, resolveAgentRouteSpy };
}

describe("GRAM-058: production inbound dispatch session routing", () => {
  beforeEach(() => {
    clearActiveStreamsForTests();
    clearProcessedIdsForTests();
  });

  afterEach(() => {
    clearActiveStreamsForTests();
    clearProcessedIdsForTests();
  });

  it("should dispatch message.created via SDK when no injected dispatch fn", async () => {
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

  it("should isolate SDK finalize context and replies across multiple chats", async () => {
    const { runtime, dispatchSpy, finalizeInboundContextSpy } = createMockRuntime();
    setOpenGramRuntime(runtime as any);

    const client = createMockClient();
    await initializeChatManager(client, baseCfg);

    const mockEs = createMockEventSource();
    (client.connectSSE as ReturnType<typeof vi.fn>).mockReturnValue(mockEs);

    const abortController = new AbortController();

    startInboundListener({
      client,
      cfg: baseCfg,
      abortSignal: abortController.signal,
      reconnectDelayMs: 100,
    });

    mockEs.triggerMessage({
      id: "evt-chat-1",
      type: "message.created",
      payload: {
        chatId: "chat-1",
        messageId: "user-msg-chat-1",
        role: "user",
        content: "Hello from chat 1",
        senderId: "user:one",
      },
    });

    mockEs.triggerMessage({
      id: "evt-chat-2",
      type: "message.created",
      payload: {
        chatId: "chat-2",
        messageId: "user-msg-chat-2",
        role: "user",
        content: "Hello from chat 2",
        senderId: "user:two",
      },
    });

    await vi.waitFor(() => expect(dispatchSpy).toHaveBeenCalledTimes(2));

    expect(finalizeInboundContextSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        MessageSid: "user-msg-chat-1",
        SessionKey: "agent:grami:opengram:direct:chat-1",
      }),
    );
    expect(finalizeInboundContextSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        MessageSid: "user-msg-chat-2",
        SessionKey: "agent:grami:opengram:direct:chat-2",
      }),
    );

    const createMessageCalls = (client.createMessage as ReturnType<typeof vi.fn>).mock.calls;
    const agentReplies = createMessageCalls.filter(
      ([_chatId, msg]: [string, { role: string }]) => msg.role === "agent",
    );
    const replyChats = new Set(agentReplies.map(([chatId]: [string, unknown]) => chatId));
    expect(replyChats).toEqual(new Set(["chat-1", "chat-2"]));

    abortController.abort();
  });

  it("should skip malformed inbound payloads with empty chatId", async () => {
    const { runtime, dispatchSpy, finalizeInboundContextSpy } = createMockRuntime();
    setOpenGramRuntime(runtime as any);

    const client = createMockClient();
    await initializeChatManager(client, baseCfg);

    const mockEs = createMockEventSource();
    (client.connectSSE as ReturnType<typeof vi.fn>).mockReturnValue(mockEs);

    const log = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };
    const abortController = new AbortController();

    startInboundListener({
      client,
      cfg: baseCfg,
      abortSignal: abortController.signal,
      reconnectDelayMs: 100,
      log,
    });

    mockEs.triggerMessage({
      id: "evt-empty-chatid-1",
      type: "message.created",
      payload: {
        chatId: "   ",
        messageId: "user-msg-empty-chatid-1",
        role: "user",
        content: "Should be ignored",
        senderId: "user:primary",
      },
    });

    await vi.waitFor(() =>
      expect(log.warn).toHaveBeenCalledWith("[opengram] Skipping message.created: empty chatId"),
    );

    expect(dispatchSpy).not.toHaveBeenCalled();
    expect(finalizeInboundContextSpy).not.toHaveBeenCalled();
    expect(client.createMessage).not.toHaveBeenCalled();

    abortController.abort();
  });

  it("should prefer payload.contentFinal for message.created body", async () => {
    const { runtime, dispatchSpy, finalizeInboundContextSpy } = createMockRuntime();
    setOpenGramRuntime(runtime as any);

    const client = createMockClient();
    await initializeChatManager(client, baseCfg);

    const mockEs = createMockEventSource();
    (client.connectSSE as ReturnType<typeof vi.fn>).mockReturnValue(mockEs);

    const abortController = new AbortController();

    startInboundListener({
      client,
      cfg: baseCfg,
      abortSignal: abortController.signal,
      reconnectDelayMs: 100,
    });

    mockEs.triggerMessage({
      id: "evt-contentfinal-1",
      type: "message.created",
      payload: {
        chatId: "chat-1",
        messageId: "user-msg-contentfinal-1",
        role: "user",
        content: "legacy content",
        contentFinal: "final content",
        senderId: "user:primary",
      },
    });

    await vi.waitFor(() => expect(dispatchSpy).toHaveBeenCalled());

    expect(finalizeInboundContextSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        Body: "final content",
        MessageSid: "user-msg-contentfinal-1",
      }),
    );

    abortController.abort();
  });

  it("should fallback from payload.content_final to payload.content", async () => {
    const { runtime, dispatchSpy, finalizeInboundContextSpy } = createMockRuntime();
    setOpenGramRuntime(runtime as any);

    const client = createMockClient();
    await initializeChatManager(client, baseCfg);

    const mockEs = createMockEventSource();
    (client.connectSSE as ReturnType<typeof vi.fn>).mockReturnValue(mockEs);

    const abortController = new AbortController();

    startInboundListener({
      client,
      cfg: baseCfg,
      abortSignal: abortController.signal,
      reconnectDelayMs: 100,
    });

    mockEs.triggerMessage({
      id: "evt-content-snake-1",
      type: "message.created",
      payload: {
        chatId: "chat-1",
        messageId: "user-msg-content-snake-1",
        role: "user",
        content_final: "snake final",
        senderId: "user:primary",
      },
    });

    mockEs.triggerMessage({
      id: "evt-content-legacy-1",
      type: "message.created",
      payload: {
        chatId: "chat-1",
        messageId: "user-msg-content-legacy-1",
        role: "user",
        content: "legacy only",
        senderId: "user:primary",
      },
    });

    await vi.waitFor(() => expect(dispatchSpy).toHaveBeenCalledTimes(2));

    expect(finalizeInboundContextSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        Body: "snake final",
        MessageSid: "user-msg-content-snake-1",
      }),
    );
    expect(finalizeInboundContextSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        Body: "legacy only",
        MessageSid: "user-msg-content-legacy-1",
      }),
    );

    abortController.abort();
  });

  it("should preserve empty string contentFinal over legacy payload.content", async () => {
    const { runtime, dispatchSpy, finalizeInboundContextSpy } = createMockRuntime();
    setOpenGramRuntime(runtime as any);

    const client = createMockClient();
    await initializeChatManager(client, baseCfg);

    const mockEs = createMockEventSource();
    (client.connectSSE as ReturnType<typeof vi.fn>).mockReturnValue(mockEs);

    const abortController = new AbortController();

    startInboundListener({
      client,
      cfg: baseCfg,
      abortSignal: abortController.signal,
      reconnectDelayMs: 100,
    });

    mockEs.triggerMessage({
      id: "evt-contentfinal-empty-1",
      type: "message.created",
      payload: {
        chatId: "chat-1",
        messageId: "user-msg-contentfinal-empty-1",
        role: "user",
        contentFinal: "",
        content: "legacy content",
        senderId: "user:primary",
      },
    });

    await vi.waitFor(() => expect(dispatchSpy).toHaveBeenCalled());

    expect(finalizeInboundContextSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        Body: "",
        MessageSid: "user-msg-contentfinal-empty-1",
      }),
    );

    abortController.abort();
  });
});
