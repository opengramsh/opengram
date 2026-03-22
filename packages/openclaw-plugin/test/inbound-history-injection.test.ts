/**
 * KAI-265 — Inject OpenGram message history on fresh agent sessions.
 *
 * When a session key is seen for the first time, recent conversation history
 * is fetched from the OpenGram API and prepended to the message body so the
 * agent has context from prior messages.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { DispatchClaimResponse, OpenGramClient } from "../src/api-client.js";
import { initializeChatManager } from "../src/chat-manager.js";
import { clearProcessedIdsForTests, processClaimedDispatchBatch, startInboundListener } from "../src/inbound.js";
import { setOpenGramRuntime } from "../src/runtime.js";
import { clearChatQueuesForTests } from "../src/chat-queue.js";
import { clearActiveStreamsForTests } from "../src/streaming.js";
import type { Chat, ListChatsResponse, Message } from "../src/types.js";

function createMockClient(overrides?: Partial<OpenGramClient>): OpenGramClient {
  return {
    createMessage: vi.fn().mockResolvedValue({ id: "msg-1" }),
    sendChunk: vi.fn().mockResolvedValue(undefined),
    completeMessage: vi.fn().mockResolvedValue(undefined),
    cancelMessage: vi.fn().mockResolvedValue(undefined),
    cancelStreamingMessagesForChat: vi.fn().mockResolvedValue({ cancelledMessageIds: [] }),
    getChat: vi.fn().mockImplementation(async (chatId: string) => ({ id: chatId, agent_ids: ["grami"] } as Chat)),
    listChats: vi.fn().mockResolvedValue({ data: [], cursor: { hasMore: false } } as ListChatsResponse),
    getMessages: vi.fn().mockResolvedValue([]),
    connectSSE: vi.fn(),
    health: vi.fn().mockResolvedValue({ status: "ok", version: "1.0.0", uptime: 100 }),
    uploadMedia: vi.fn().mockResolvedValue({ id: "media-1" }),
    sendTyping: vi.fn().mockResolvedValue(undefined),
    getMediaUrl: vi.fn().mockImplementation((mediaId: string) => `http://localhost:3000/api/v1/files/${mediaId}`),
    fetchMediaAsImage: vi.fn().mockResolvedValue(null),
    ...overrides,
  } as unknown as OpenGramClient;
}

const baseCfg = {
  channels: {
    opengram: {
      enabled: true,
      baseUrl: "http://localhost:3000",
      agents: ["grami"],
      dmPolicy: "open",
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
  };
}

function createMockRuntime(
  dispatchImpl?: (params: any) => Promise<{ status: string }> | { status: string },
) {
  const dispatchSpy = vi.fn().mockImplementation(dispatchImpl ?? (async (params: any) => {
    await params.dispatcherOptions.deliver(
      { text: "Agent reply" },
      { kind: "final" },
    );
    return { status: "ok" };
  }));

  const finalizeInboundContextSpy = vi.fn().mockImplementation((ctx: any) => ({
    ...ctx,
    CommandAuthorized: ctx.CommandAuthorized ?? false,
  }));

  const resolveAgentRouteSpy = vi.fn().mockImplementation(({ peer }: { peer?: { id?: string } }) => ({
    agentId: "main",
    channel: "opengram",
    accountId: "default",
    sessionKey: `agent:main:opengram:direct:${peer?.id ?? "unknown"}`,
    mainSessionKey: "agent:main:main",
    matchedBy: "default",
  }));

  const runtime = {
    channel: {
      routing: { resolveAgentRoute: resolveAgentRouteSpy },
      reply: {
        dispatchReplyWithBufferedBlockDispatcher: dispatchSpy,
        finalizeInboundContext: finalizeInboundContextSpy,
      },
    },
  };

  return { runtime, dispatchSpy, finalizeInboundContextSpy };
}

function makeHistoryMessages(): Message[] {
  // API returns newest-first
  return [
    { id: "msg-3", role: "agent", content_final: "I can help with that.", content: "I can help with that." } as unknown as Message,
    { id: "msg-2", role: "user", content_final: "Can you help?", content: "Can you help?" } as unknown as Message,
    { id: "msg-1", role: "agent", content_final: "Hello! How can I assist you?", content: "Hello! How can I assist you?" } as unknown as Message,
  ];
}

describe("KAI-265: inject conversation history on fresh sessions", () => {
  beforeEach(() => {
    clearActiveStreamsForTests();
    clearProcessedIdsForTests();
    clearChatQueuesForTests();
  });

  afterEach(() => {
    clearActiveStreamsForTests();
    clearProcessedIdsForTests();
    clearChatQueuesForTests();
  });

  it("should prepend history on first dispatch for a session", async () => {
    const { runtime, finalizeInboundContextSpy } = createMockRuntime();
    setOpenGramRuntime(runtime as any);

    const getMessages = vi.fn().mockResolvedValue(makeHistoryMessages());
    const client = createMockClient({ getMessages } as any);
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
      id: "evt-1",
      type: "message.created",
      payload: {
        chatId: "chat-1",
        messageId: "user-msg-new",
        role: "user",
        content: "New message",
        senderId: "user:primary",
      },
    });

    await vi.waitFor(() => expect(finalizeInboundContextSpy).toHaveBeenCalled());

    // History should be fetched
    expect(getMessages).toHaveBeenCalledWith("chat-1", { limit: 21 });

    // Body should contain the injected history followed by the actual content
    const body = finalizeInboundContextSpy.mock.calls[0][0].Body as string;
    expect(body).toContain("[Prior conversation context:");
    expect(body).toContain("agent: Hello! How can I assist you?");
    expect(body).toContain("user: Can you help?");
    expect(body).toContain("agent: I can help with that.");
    expect(body).toContain("New message");
    // History should appear before the actual message
    expect(body.indexOf("[Prior conversation context:")).toBeLessThan(body.indexOf("New message"));

    abortController.abort();
  });

  it("should NOT inject history on second dispatch for the same session", async () => {
    const { runtime, finalizeInboundContextSpy } = createMockRuntime();
    setOpenGramRuntime(runtime as any);

    const getMessages = vi.fn().mockResolvedValue(makeHistoryMessages());
    const client = createMockClient({ getMessages } as any);
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

    // First message
    mockEs.triggerMessage({
      id: "evt-1",
      type: "message.created",
      payload: {
        chatId: "chat-1",
        messageId: "user-msg-1",
        role: "user",
        content: "First message",
        senderId: "user:primary",
      },
    });

    await vi.waitFor(() => expect(finalizeInboundContextSpy).toHaveBeenCalledTimes(1));

    // Second message to the same chat
    mockEs.triggerMessage({
      id: "evt-2",
      type: "message.created",
      payload: {
        chatId: "chat-1",
        messageId: "user-msg-2",
        role: "user",
        content: "Second message",
        senderId: "user:primary",
      },
    });

    await vi.waitFor(() => expect(finalizeInboundContextSpy).toHaveBeenCalledTimes(2));

    // getMessages should only have been called once (for the first dispatch)
    expect(getMessages).toHaveBeenCalledTimes(1);

    // Second dispatch should NOT have history prefix
    const secondBody = finalizeInboundContextSpy.mock.calls[1][0].Body as string;
    expect(secondBody).not.toContain("[Prior conversation context:");
    expect(secondBody).toBe("Second message");

    abortController.abort();
  });

  it("should re-inject history after a skipped first dispatch attempt", async () => {
    let attempts = 0;
    const { runtime, finalizeInboundContextSpy, dispatchSpy } = createMockRuntime(
      async (params: any) => {
        attempts += 1;
        if (attempts === 1) {
          params.dispatcherOptions.onSkip(
            { text: undefined },
            { kind: "final", reason: "busy" },
          );
          return { status: "skipped" };
        }

        await params.dispatcherOptions.deliver(
          { text: "Agent reply" },
          { kind: "final" },
        );
        return { status: "ok" };
      },
    );
    setOpenGramRuntime(runtime as any);

    const getMessages = vi.fn().mockResolvedValue(makeHistoryMessages());
    const client = createMockClient({ getMessages } as any);
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
      id: "evt-1",
      type: "message.created",
      payload: {
        chatId: "chat-1",
        messageId: "user-msg-retry",
        role: "user",
        content: "Retry me",
        senderId: "user:primary",
      },
    });

    await vi.waitFor(() => expect(dispatchSpy).toHaveBeenCalledTimes(2));

    expect(getMessages).toHaveBeenCalledTimes(2);

    const secondBody = finalizeInboundContextSpy.mock.calls[1][0].Body as string;
    expect(secondBody).toContain("[Prior conversation context:");
    expect(secondBody).toContain("agent: Hello! How can I assist you?");
    expect(secondBody).toContain("Retry me");

    abortController.abort();
  });

  it("should gracefully handle API failure when fetching history", async () => {
    const { runtime, finalizeInboundContextSpy } = createMockRuntime();
    setOpenGramRuntime(runtime as any);

    const getMessages = vi.fn().mockRejectedValue(new Error("API error"));
    const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const client = createMockClient({ getMessages } as any);
    await initializeChatManager(client, baseCfg);

    const mockEs = createMockEventSource();
    (client.connectSSE as ReturnType<typeof vi.fn>).mockReturnValue(mockEs);
    const abortController = new AbortController();

    startInboundListener({
      client,
      cfg: baseCfg,
      abortSignal: abortController.signal,
      reconnectDelayMs: 100,
      log,
    });

    mockEs.triggerMessage({
      id: "evt-1",
      type: "message.created",
      payload: {
        chatId: "chat-1",
        messageId: "user-msg-1",
        role: "user",
        content: "Hello",
        senderId: "user:primary",
      },
    });

    await vi.waitFor(() => expect(finalizeInboundContextSpy).toHaveBeenCalled());

    // Should warn about the failure
    expect(log.warn).toHaveBeenCalledWith(
      expect.stringContaining("Failed to fetch history for session priming"),
    );

    // Dispatch should proceed with original content
    const body = finalizeInboundContextSpy.mock.calls[0][0].Body as string;
    expect(body).toBe("Hello");

    abortController.abort();
  });

  it("should exclude the current inbound message from history", async () => {
    const { runtime, finalizeInboundContextSpy } = createMockRuntime();
    setOpenGramRuntime(runtime as any);

    // History includes the current message (API may return it if already written)
    const getMessages = vi.fn().mockResolvedValue([
      { id: "user-msg-current", role: "user", content_final: "Current msg", content: "Current msg" } as unknown as Message,
      { id: "msg-old", role: "agent", content_final: "Old reply", content: "Old reply" } as unknown as Message,
    ]);
    const client = createMockClient({ getMessages } as any);
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
      id: "evt-1",
      type: "message.created",
      payload: {
        chatId: "chat-1",
        messageId: "user-msg-current",
        role: "user",
        content: "Current msg",
        senderId: "user:primary",
      },
    });

    await vi.waitFor(() => expect(finalizeInboundContextSpy).toHaveBeenCalled());

    const body = finalizeInboundContextSpy.mock.calls[0][0].Body as string;
    // History should contain the old message but not duplicate the current one in the history block
    expect(body).toContain("agent: Old reply");
    // The history block should not include the current message's content as a history entry
    const historyBlock = body.split("\n\n")[0];
    expect(historyBlock).not.toContain("user: Current msg");

    abortController.abort();
  });

  it("should exclude current user message IDs for claimed dispatch batches", async () => {
    const { runtime, finalizeInboundContextSpy } = createMockRuntime();
    setOpenGramRuntime(runtime as any);

    const getMessages = vi.fn().mockResolvedValue([
      { id: "user-msg-current", role: "user", content_final: "Current msg", content: "Current msg" } as unknown as Message,
      { id: "msg-old", role: "agent", content_final: "Old reply", content: "Old reply" } as unknown as Message,
    ]);
    const client = createMockClient({ getMessages } as any);
    await initializeChatManager(client, baseCfg);

    const batch: DispatchClaimResponse = {
      batchId: "batch-1",
      chatId: "chat-1",
      kind: "user_batch",
      agentIdHint: "grami",
      compiledContent: "Current msg",
      items: [
        {
          inputId: "input-1",
          sourceKind: "user_message",
          sourceId: "user-msg-current",
          senderId: "user:primary",
          content: "Current msg",
          mediaIds: [],
          attachmentNames: [],
        },
      ],
      attachments: [],
    };

    await processClaimedDispatchBatch({
      batch,
      cfg: baseCfg as any,
      client,
    });

    const body = finalizeInboundContextSpy.mock.calls[0][0].Body as string;
    expect(body).toContain("agent: Old reply");
    const historyBlock = body.split("\n\n")[0];
    expect(historyBlock).not.toContain("user: Current msg");
  });

  it("should filter out tool and system messages from history", async () => {
    const { runtime, finalizeInboundContextSpy } = createMockRuntime();
    setOpenGramRuntime(runtime as any);

    const getMessages = vi.fn().mockResolvedValue([
      { id: "msg-4", role: "tool", content_final: "tool output", content: "tool output" } as unknown as Message,
      { id: "msg-3", role: "system", content_final: "system msg", content: "system msg" } as unknown as Message,
      { id: "msg-2", role: "user", content_final: "User question", content: "User question" } as unknown as Message,
      { id: "msg-1", role: "agent", content_final: "Agent answer", content: "Agent answer" } as unknown as Message,
    ]);
    const client = createMockClient({ getMessages } as any);
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
      id: "evt-1",
      type: "message.created",
      payload: {
        chatId: "chat-1",
        messageId: "user-msg-new",
        role: "user",
        content: "New message",
        senderId: "user:primary",
      },
    });

    await vi.waitFor(() => expect(finalizeInboundContextSpy).toHaveBeenCalled());

    const body = finalizeInboundContextSpy.mock.calls[0][0].Body as string;
    expect(body).toContain("agent: Agent answer");
    expect(body).toContain("user: User question");
    expect(body).not.toContain("tool output");
    expect(body).not.toContain("system msg");

    abortController.abort();
  });

  it("should skip history injection when no relevant messages exist", async () => {
    const { runtime, finalizeInboundContextSpy } = createMockRuntime();
    setOpenGramRuntime(runtime as any);

    const getMessages = vi.fn().mockResolvedValue([]);
    const client = createMockClient({ getMessages } as any);
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
      id: "evt-1",
      type: "message.created",
      payload: {
        chatId: "chat-1",
        messageId: "user-msg-1",
        role: "user",
        content: "Hello",
        senderId: "user:primary",
      },
    });

    await vi.waitFor(() => expect(finalizeInboundContextSpy).toHaveBeenCalled());

    const body = finalizeInboundContextSpy.mock.calls[0][0].Body as string;
    expect(body).toBe("Hello");
    expect(body).not.toContain("[Prior conversation context:");

    abortController.abort();
  });
});
