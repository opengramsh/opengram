/**
 * KAI-232 — Cross-chat reply routing regression.
 *
 * When OpenClaw's resolveAgentRoute returns a shared session key
 * (e.g. "agent:main:main" from dmScope="main"), buildSessionKey must still
 * produce per-chat session keys so agent sessions remain isolated.
 *
 * This test reproduces the bug: buildSessionKey uses the route's session key
 * suffix ("main") and drops the chatId, causing all chats to share one session.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { OpenGramClient } from "../src/api-client.js";
import { initializeChatManager } from "../src/chat-manager.js";
import { clearProcessedIdsForTests, startInboundListener } from "../src/inbound.js";
import { setOpenGramRuntime } from "../src/runtime.js";
import { clearChatQueuesForTests } from "../src/chat-queue.js";
import { clearActiveStreamsForTests } from "../src/streaming.js";
import type { Chat, ListChatsResponse } from "../src/types.js";

function createMockClient(overrides?: Partial<OpenGramClient>): OpenGramClient {
  return {
    createMessage: vi.fn().mockResolvedValue({ id: "msg-1" }),
    sendChunk: vi.fn().mockResolvedValue(undefined),
    completeMessage: vi.fn().mockResolvedValue(undefined),
    cancelMessage: vi.fn().mockResolvedValue(undefined),
    cancelStreamingMessagesForChat: vi.fn().mockResolvedValue({ cancelledMessageIds: [] }),
    getChat: vi.fn().mockImplementation(async (chatId: string) => ({ id: chatId, agent_ids: ["grami"] } as Chat)),
    listChats: vi.fn().mockResolvedValue({ data: [], cursor: { hasMore: false } } as ListChatsResponse),
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

/**
 * Mock runtime where resolveAgentRoute returns a SHARED session key
 * (dmScope="main"), simulating the real production default.
 */
function createMockRuntimeWithSharedSession() {
  const dispatchSpy = vi.fn().mockImplementation(async (params: any) => {
    await params.dispatcherOptions.deliver(
      { text: "Agent reply" },
      { kind: "final" },
    );
    return { status: "ok" };
  });

  const finalizeInboundContextSpy = vi.fn().mockImplementation((ctx: any) => ({
    ...ctx,
    CommandAuthorized: ctx.CommandAuthorized ?? false,
  }));

  // This is the critical difference: return a SHARED session key for ALL chats,
  // simulating dmScope="main" (the OpenClaw default).
  const resolveAgentRouteSpy = vi.fn().mockReturnValue({
    agentId: "main",
    channel: "opengram",
    accountId: "default",
    sessionKey: "agent:main:main",        // shared — does NOT contain chatId
    mainSessionKey: "agent:main:main",
    matchedBy: "default",
  });

  const runtime = {
    channel: {
      routing: { resolveAgentRoute: resolveAgentRouteSpy },
      reply: {
        dispatchReplyWithBufferedBlockDispatcher: dispatchSpy,
        finalizeInboundContext: finalizeInboundContextSpy,
      },
    },
  };

  return { runtime, dispatchSpy, finalizeInboundContextSpy, resolveAgentRouteSpy };
}

describe("KAI-232: cross-chat session key isolation with shared route", () => {
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

  it("two chats with the same agent must produce different session keys", async () => {
    const { runtime, dispatchSpy, finalizeInboundContextSpy } = createMockRuntimeWithSharedSession();
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

    // Send messages from two different chats
    mockEs.triggerMessage({
      id: "evt-1",
      type: "message.created",
      payload: {
        chatId: "chat-alpha",
        messageId: "msg-alpha-1",
        role: "user",
        content: "Hello from chat alpha",
        senderId: "user:one",
      },
    });

    mockEs.triggerMessage({
      id: "evt-2",
      type: "message.created",
      payload: {
        chatId: "chat-beta",
        messageId: "msg-beta-1",
        role: "user",
        content: "Hello from chat beta",
        senderId: "user:two",
      },
    });

    await vi.waitFor(() => expect(dispatchSpy).toHaveBeenCalledTimes(2));

    // Extract the SessionKey from each finalizeInboundContext call
    const calls = finalizeInboundContextSpy.mock.calls;
    const sessionKeys = calls.map((call: any[]) => call[0].SessionKey as string);

    // CRITICAL ASSERTION: session keys must be different for different chats
    expect(sessionKeys[0]).not.toBe(sessionKeys[1]);

    // Each session key must contain its respective chatId
    expect(sessionKeys[0]).toContain("chat-alpha");
    expect(sessionKeys[1]).toContain("chat-beta");

    abortController.abort();
  });

  it("session key must always contain the chatId even with shared route", async () => {
    const { runtime, dispatchSpy, finalizeInboundContextSpy } = createMockRuntimeWithSharedSession();
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
      id: "evt-single-1",
      type: "message.created",
      payload: {
        chatId: "chat-unique-123",
        messageId: "msg-unique-1",
        role: "user",
        content: "Test message",
        senderId: "user:primary",
      },
    });

    await vi.waitFor(() => expect(dispatchSpy).toHaveBeenCalled());

    const sessionKey = finalizeInboundContextSpy.mock.calls[0][0].SessionKey;

    // Session key must include the chatId for per-chat isolation
    expect(sessionKey).toContain("chat-unique-123");

    // It must NOT be the shared "agent:grami:main" key
    expect(sessionKey).not.toBe("agent:grami:main");
    expect(sessionKey).not.toBe("agent:main:main");

    abortController.abort();
  });

  it("dmScope setting in route must NOT collapse session keys", async () => {
    // Simulate dmScope="main" — route returns the exact same sessionKey for different peers
    const { runtime, dispatchSpy, finalizeInboundContextSpy } = createMockRuntimeWithSharedSession();
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

    // Three chats, all hitting the same agent
    const chatIds = ["chat-a", "chat-b", "chat-c"];
    for (let i = 0; i < chatIds.length; i++) {
      mockEs.triggerMessage({
        id: `evt-dm-${i}`,
        type: "message.created",
        payload: {
          chatId: chatIds[i],
          messageId: `msg-dm-${i}`,
          role: "user",
          content: `Message ${i}`,
          senderId: `user:${i}`,
        },
      });
    }

    await vi.waitFor(() => expect(dispatchSpy).toHaveBeenCalledTimes(3));

    const sessionKeys = finalizeInboundContextSpy.mock.calls.map(
      (call: any[]) => call[0].SessionKey as string,
    );

    // All three session keys must be unique
    const uniqueKeys = new Set(sessionKeys);
    expect(uniqueKeys.size).toBe(3);

    // Each must contain its chatId
    for (let i = 0; i < chatIds.length; i++) {
      expect(sessionKeys[i]).toContain(chatIds[i]);
    }

    abortController.abort();
  });
});
