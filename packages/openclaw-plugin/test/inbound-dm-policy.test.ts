import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { OpenGramClient } from "../src/api-client.js";
import { initializeChatManager } from "../src/chat-manager.js";
import { clearProcessedIdsForTests, startInboundListener, type DispatchFn } from "../src/inbound.js";
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
    sendTyping: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as OpenGramClient;
}

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

describe("inbound DM policy enforcement", () => {
  beforeEach(() => {
    clearActiveStreamsForTests();
    clearProcessedIdsForTests();
  });

  afterEach(() => {
    clearActiveStreamsForTests();
    clearProcessedIdsForTests();
  });

  describe("dmPolicy: open", () => {
    const openCfg = {
      channels: {
        opengram: {
          enabled: true,
          baseUrl: "http://localhost:3000",
          agents: ["grami"],
          dmPolicy: "open",
        },
      },
    };

    it("passes through all messages without checking allowlist", async () => {
      const client = createMockClient();
      await initializeChatManager(client, openCfg);

      const dispatch = vi.fn();
      const mockEs = createMockEventSource();
      (client.connectSSE as ReturnType<typeof vi.fn>).mockReturnValue(mockEs);

      const abortController = new AbortController();
      startInboundListener({
        client,
        cfg: openCfg,
        abortSignal: abortController.signal,
        reconnectDelayMs: 100,
        dispatch,
      });

      mockEs.triggerMessage({
        id: "evt-1",
        type: "message.created",
        payload: {
          chatId: "chat-1",
          messageId: "user-msg-open-1",
          role: "user",
          content: "Hello!",
          senderId: "user:unknown",
        },
      });

      await vi.waitFor(() => expect(dispatch).toHaveBeenCalled());
      expect(dispatch).toHaveBeenCalledWith(
        expect.objectContaining({ chatId: "chat-1", content: "Hello!" }),
      );

      abortController.abort();
    });
  });

  describe("dmPolicy: disabled", () => {
    const disabledCfg = {
      channels: {
        opengram: {
          enabled: true,
          baseUrl: "http://localhost:3000",
          agents: ["grami"],
          dmPolicy: "disabled",
        },
      },
    };

    it("drops all messages", async () => {
      const client = createMockClient();
      await initializeChatManager(client, disabledCfg);

      const dispatch = vi.fn();
      const mockEs = createMockEventSource();
      (client.connectSSE as ReturnType<typeof vi.fn>).mockReturnValue(mockEs);

      const abortController = new AbortController();
      startInboundListener({
        client,
        cfg: disabledCfg,
        abortSignal: abortController.signal,
        reconnectDelayMs: 100,
        dispatch,
      });

      mockEs.triggerMessage({
        id: "evt-disabled-1",
        type: "message.created",
        payload: {
          chatId: "chat-1",
          messageId: "user-msg-disabled-1",
          role: "user",
          content: "Hello!",
          senderId: "user:primary",
        },
      });

      await new Promise((r) => setTimeout(r, 50));
      expect(dispatch).not.toHaveBeenCalled();

      abortController.abort();
    });
  });

  describe("dmPolicy: pairing", () => {
    const pairingCfg = {
      channels: {
        opengram: {
          enabled: true,
          baseUrl: "http://localhost:3000",
          agents: ["grami"],
          dmPolicy: "pairing",
        },
      },
    };

    function createMockPairingRuntime(allowedSenders: string[] = []) {
      return {
        channel: {
          pairing: {
            readAllowFromStore: vi.fn().mockResolvedValue(allowedSenders),
            upsertPairingRequest: vi.fn().mockResolvedValue({ code: "ABC123", created: true }),
            buildPairingReply: vi.fn().mockReturnValue("Please pair with code: ABC123"),
          },
          routing: {
            resolveAgentRoute: vi.fn().mockReturnValue({
              agentId: "main",
              channel: "opengram",
              accountId: "default",
              sessionKey: "agent:main:opengram:direct:chat-1",
              matchedBy: "default",
            }),
          },
          reply: {
            dispatchReplyWithBufferedBlockDispatcher: vi.fn(),
            finalizeInboundContext: vi.fn((ctx: any) => ctx),
          },
        },
      };
    }

    it("allows known sender from pairing store", async () => {
      const runtime = createMockPairingRuntime(["user:primary"]);
      setOpenGramRuntime(runtime as any);

      const client = createMockClient();
      await initializeChatManager(client, pairingCfg);

      const dispatch = vi.fn();
      const mockEs = createMockEventSource();
      (client.connectSSE as ReturnType<typeof vi.fn>).mockReturnValue(mockEs);

      const abortController = new AbortController();
      startInboundListener({
        client,
        cfg: pairingCfg,
        abortSignal: abortController.signal,
        reconnectDelayMs: 100,
        dispatch,
      });

      mockEs.triggerMessage({
        id: "evt-pairing-known-1",
        type: "message.created",
        payload: {
          chatId: "chat-1",
          messageId: "user-msg-pairing-known-1",
          role: "user",
          content: "Hello!",
          senderId: "user:primary",
        },
      });

      await vi.waitFor(() => expect(dispatch).toHaveBeenCalled());
      expect(dispatch).toHaveBeenCalledWith(
        expect.objectContaining({ chatId: "chat-1", content: "Hello!" }),
      );

      abortController.abort();
    });

    it("blocks unknown sender and sends pairing code", async () => {
      const runtime = createMockPairingRuntime([]);
      setOpenGramRuntime(runtime as any);

      const client = createMockClient();
      await initializeChatManager(client, pairingCfg);

      const dispatch = vi.fn();
      const mockEs = createMockEventSource();
      (client.connectSSE as ReturnType<typeof vi.fn>).mockReturnValue(mockEs);

      const abortController = new AbortController();
      startInboundListener({
        client,
        cfg: pairingCfg,
        abortSignal: abortController.signal,
        reconnectDelayMs: 100,
        dispatch,
      });

      mockEs.triggerMessage({
        id: "evt-pairing-unknown-1",
        type: "message.created",
        payload: {
          chatId: "chat-1",
          messageId: "user-msg-pairing-unknown-1",
          role: "user",
          content: "Hello!",
          senderId: "user:unknown",
        },
      });

      await new Promise((r) => setTimeout(r, 50));
      expect(dispatch).not.toHaveBeenCalled();

      // Should have created a pairing request
      expect(runtime.channel.pairing.upsertPairingRequest).toHaveBeenCalledWith({
        channel: "opengram",
        id: "user:unknown",
      });

      // Should have sent the pairing reply message
      expect(client.createMessage).toHaveBeenCalledWith("chat-1", {
        role: "system",
        senderId: "openclaw",
        content: "Please pair with code: ABC123",
      });

      abortController.abort();
    });

    it("allows sender from config allowFrom", async () => {
      const cfgWithAllowFrom = {
        channels: {
          opengram: {
            enabled: true,
            baseUrl: "http://localhost:3000",
            agents: ["grami"],
            dmPolicy: "pairing",
            allowFrom: ["user:special"],
          },
        },
      };

      const runtime = createMockPairingRuntime([]); // Empty store
      setOpenGramRuntime(runtime as any);

      const client = createMockClient();
      await initializeChatManager(client, cfgWithAllowFrom);

      const dispatch = vi.fn();
      const mockEs = createMockEventSource();
      (client.connectSSE as ReturnType<typeof vi.fn>).mockReturnValue(mockEs);

      const abortController = new AbortController();
      startInboundListener({
        client,
        cfg: cfgWithAllowFrom,
        abortSignal: abortController.signal,
        reconnectDelayMs: 100,
        dispatch,
      });

      mockEs.triggerMessage({
        id: "evt-pairing-config-1",
        type: "message.created",
        payload: {
          chatId: "chat-1",
          messageId: "user-msg-pairing-config-1",
          role: "user",
          content: "Hello from special!",
          senderId: "user:special",
        },
      });

      await vi.waitFor(() => expect(dispatch).toHaveBeenCalled());
      expect(dispatch).toHaveBeenCalledWith(
        expect.objectContaining({ content: "Hello from special!" }),
      );

      abortController.abort();
    });

    it("allows wildcard in config allowFrom", async () => {
      const cfgWithWildcard = {
        channels: {
          opengram: {
            enabled: true,
            baseUrl: "http://localhost:3000",
            agents: ["grami"],
            dmPolicy: "pairing",
            allowFrom: ["*"],
          },
        },
      };

      const runtime = createMockPairingRuntime([]); // Empty store
      setOpenGramRuntime(runtime as any);

      const client = createMockClient();
      await initializeChatManager(client, cfgWithWildcard);

      const dispatch = vi.fn();
      const mockEs = createMockEventSource();
      (client.connectSSE as ReturnType<typeof vi.fn>).mockReturnValue(mockEs);

      const abortController = new AbortController();
      startInboundListener({
        client,
        cfg: cfgWithWildcard,
        abortSignal: abortController.signal,
        reconnectDelayMs: 100,
        dispatch,
      });

      mockEs.triggerMessage({
        id: "evt-pairing-wildcard-1",
        type: "message.created",
        payload: {
          chatId: "chat-1",
          messageId: "user-msg-pairing-wildcard-1",
          role: "user",
          content: "Hello from anyone!",
          senderId: "user:anyone",
        },
      });

      await vi.waitFor(() => expect(dispatch).toHaveBeenCalled());

      abortController.abort();
    });

    it("enforces policy on request.resolved events too", async () => {
      const runtime = createMockPairingRuntime([]);
      setOpenGramRuntime(runtime as any);

      const client = createMockClient();
      await initializeChatManager(client, pairingCfg);

      const dispatch = vi.fn();
      const mockEs = createMockEventSource();
      (client.connectSSE as ReturnType<typeof vi.fn>).mockReturnValue(mockEs);

      const abortController = new AbortController();
      startInboundListener({
        client,
        cfg: pairingCfg,
        abortSignal: abortController.signal,
        reconnectDelayMs: 100,
        dispatch,
      });

      mockEs.triggerMessage({
        id: "evt-req-pairing-1",
        type: "request.resolved",
        payload: {
          chatId: "chat-1",
          requestId: "req-1",
          type: "choice",
          title: "Deploy?",
          resolutionPayload: { selectedOptionIds: ["approve"] },
          senderId: "user:unknown",
        },
      });

      await new Promise((r) => setTimeout(r, 50));
      expect(dispatch).not.toHaveBeenCalled();

      abortController.abort();
    });
  });

  describe("dmPolicy: allowlist", () => {
    const allowlistCfg = {
      channels: {
        opengram: {
          enabled: true,
          baseUrl: "http://localhost:3000",
          agents: ["grami"],
          dmPolicy: "allowlist",
          allowFrom: ["user:primary"],
        },
      },
    };

    it("allows sender in config allowFrom", async () => {
      const client = createMockClient();
      await initializeChatManager(client, allowlistCfg);

      const dispatch = vi.fn();
      const mockEs = createMockEventSource();
      (client.connectSSE as ReturnType<typeof vi.fn>).mockReturnValue(mockEs);

      const abortController = new AbortController();
      startInboundListener({
        client,
        cfg: allowlistCfg,
        abortSignal: abortController.signal,
        reconnectDelayMs: 100,
        dispatch,
      });

      mockEs.triggerMessage({
        id: "evt-allowlist-1",
        type: "message.created",
        payload: {
          chatId: "chat-1",
          messageId: "user-msg-allowlist-1",
          role: "user",
          content: "Hello!",
          senderId: "user:primary",
        },
      });

      await vi.waitFor(() => expect(dispatch).toHaveBeenCalled());

      abortController.abort();
    });

    it("drops unknown sender without sending pairing code", async () => {
      const client = createMockClient();
      await initializeChatManager(client, allowlistCfg);

      const dispatch = vi.fn();
      const mockEs = createMockEventSource();
      (client.connectSSE as ReturnType<typeof vi.fn>).mockReturnValue(mockEs);

      const abortController = new AbortController();
      startInboundListener({
        client,
        cfg: allowlistCfg,
        abortSignal: abortController.signal,
        reconnectDelayMs: 100,
        dispatch,
      });

      mockEs.triggerMessage({
        id: "evt-allowlist-2",
        type: "message.created",
        payload: {
          chatId: "chat-1",
          messageId: "user-msg-allowlist-2",
          role: "user",
          content: "Hello!",
          senderId: "user:unknown",
        },
      });

      await new Promise((r) => setTimeout(r, 50));
      expect(dispatch).not.toHaveBeenCalled();
      // No pairing code message sent
      expect(client.createMessage).not.toHaveBeenCalled();

      abortController.abort();
    });
  });
});
