import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { OpenGramClient } from "../src/api-client.js";
import { initializeChatManager } from "../src/chat-manager.js";
import { clearProcessedIdsForTests, startInboundListener, type DispatchFn, type ReplyPayload, type DeliverKind } from "../src/inbound.js";
import { clearActiveStreamsForTests, hasActiveStream } from "../src/streaming.js";
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

describe("inbound deliver integration", () => {
  beforeEach(() => {
    clearActiveStreamsForTests();
    clearProcessedIdsForTests();
  });

  afterEach(() => {
    clearActiveStreamsForTests();
    clearProcessedIdsForTests();
  });

  describe("deliver callback with streaming", () => {
    it("streams block replies then finalizes", async () => {
      const client = createMockClient();
      await initializeChatManager(client, baseCfg);

      let capturedDeliver!: (payload: ReplyPayload, meta: { kind: DeliverKind }) => Promise<void>;
      let capturedCleanup!: () => void;

      const dispatch: DispatchFn = ({ deliver, onCleanup }) => {
        capturedDeliver = deliver;
        capturedCleanup = onCleanup;
      };

      // Simulate SSE event by creating a mock EventSource
      const mockEs = createMockEventSource();
      (client.connectSSE as ReturnType<typeof vi.fn>).mockReturnValue(mockEs);

      const abortController = new AbortController();
      startInboundListener({
        client,
        cfg: baseCfg,
        abortSignal: abortController.signal,
        reconnectDelayMs: 100,
        dispatch,
      });

      // Simulate message.created event
      mockEs.triggerMessage({
        id: "evt-1",
        type: "message.created",
        payload: {
          chatId: "chat-1",
          messageId: "user-msg-1",
          role: "user",
          content: "Hello!",
          senderId: "user:primary",
        },
      });

      // Wait for async handler
      await vi.waitFor(() => expect(capturedDeliver).toBeDefined());

      // Simulate block streaming
      await capturedDeliver({ text: "Hi there" }, { kind: "block" });
      expect(client.createMessage).toHaveBeenCalledWith("chat-1", {
        role: "agent",
        senderId: "grami",
        streaming: true,
      });
      expect(client.sendChunk).toHaveBeenCalledWith("msg-1", "Hi there");

      await capturedDeliver({ text: "Hi there! How can I help?" }, { kind: "block" });
      expect(client.sendChunk).toHaveBeenCalledWith("msg-1", "! How can I help?");

      // Finalize
      await capturedDeliver(
        { text: "Hi there! How can I help you today?" },
        { kind: "final" },
      );
      expect(client.completeMessage).toHaveBeenCalledWith(
        "msg-1",
        "Hi there! How can I help you today?",
      );

      abortController.abort();
    });

    it("sends non-streaming final message when no blocks preceded", async () => {
      const client = createMockClient();
      await initializeChatManager(client, baseCfg);

      let capturedDeliver!: (payload: ReplyPayload, meta: { kind: DeliverKind }) => Promise<void>;

      const dispatch: DispatchFn = ({ deliver }) => {
        capturedDeliver = deliver;
      };

      const mockEs = createMockEventSource();
      (client.connectSSE as ReturnType<typeof vi.fn>).mockReturnValue(mockEs);

      const abortController = new AbortController();
      startInboundListener({
        client,
        cfg: baseCfg,
        abortSignal: abortController.signal,
        reconnectDelayMs: 100,
        dispatch,
      });

      mockEs.triggerMessage({
        id: "evt-2",
        type: "message.created",
        payload: {
          chatId: "chat-1",
          messageId: "user-msg-2",
          role: "user",
          content: "Quick question",
          senderId: "user:primary",
        },
      });

      await vi.waitFor(() => expect(capturedDeliver).toBeDefined());

      // Final with no preceding blocks — should create a normal message
      await capturedDeliver({ text: "Here's the answer." }, { kind: "final" });

      // completeMessage should NOT have been called (no stream to finalize)
      expect(client.completeMessage).not.toHaveBeenCalled();
      // Should create a normal message instead
      expect(client.createMessage).toHaveBeenCalledWith("chat-1", {
        role: "agent",
        senderId: "grami",
        content: "Here's the answer.",
      });

      abortController.abort();
    });

    it("sends tool messages as role=tool", async () => {
      const client = createMockClient();
      await initializeChatManager(client, baseCfg);

      let capturedDeliver!: (payload: ReplyPayload, meta: { kind: DeliverKind }) => Promise<void>;

      const dispatch: DispatchFn = ({ deliver }) => {
        capturedDeliver = deliver;
      };

      const mockEs = createMockEventSource();
      (client.connectSSE as ReturnType<typeof vi.fn>).mockReturnValue(mockEs);

      const abortController = new AbortController();
      startInboundListener({
        client,
        cfg: baseCfg,
        abortSignal: abortController.signal,
        reconnectDelayMs: 100,
        dispatch,
      });

      mockEs.triggerMessage({
        id: "evt-3",
        type: "message.created",
        payload: {
          chatId: "chat-1",
          messageId: "user-msg-3",
          role: "user",
          content: "Run the tool",
          senderId: "user:primary",
        },
      });

      await vi.waitFor(() => expect(capturedDeliver).toBeDefined());

      await capturedDeliver({ text: "Tool output here" }, { kind: "tool" });

      expect(client.createMessage).toHaveBeenCalledWith("chat-1", {
        role: "tool",
        senderId: "grami",
        content: "Tool output here",
      });

      abortController.abort();
    });

    it("onCleanup cancels active stream", async () => {
      const client = createMockClient();
      await initializeChatManager(client, baseCfg);

      let capturedDeliver!: (payload: ReplyPayload, meta: { kind: DeliverKind }) => Promise<void>;
      let capturedCleanup!: () => void;

      const dispatch: DispatchFn = ({ deliver, onCleanup }) => {
        capturedDeliver = deliver;
        capturedCleanup = onCleanup;
      };

      const mockEs = createMockEventSource();
      (client.connectSSE as ReturnType<typeof vi.fn>).mockReturnValue(mockEs);

      const abortController = new AbortController();
      startInboundListener({
        client,
        cfg: baseCfg,
        abortSignal: abortController.signal,
        reconnectDelayMs: 100,
        dispatch,
      });

      mockEs.triggerMessage({
        id: "evt-4",
        type: "message.created",
        payload: {
          chatId: "chat-1",
          messageId: "user-msg-4",
          role: "user",
          content: "Hello",
          senderId: "user:primary",
        },
      });

      await vi.waitFor(() => expect(capturedDeliver).toBeDefined());

      // Start streaming
      await capturedDeliver({ text: "Partial" }, { kind: "block" });
      expect(client.createMessage).toHaveBeenCalledWith("chat-1", {
        role: "agent",
        senderId: "grami",
        streaming: true,
      });

      // Call onCleanup (simulates unexpected completion)
      capturedCleanup();
      expect(client.cancelMessage).toHaveBeenCalledWith("msg-1");

      abortController.abort();
    });

    it("ignores agent messages to prevent loops", async () => {
      const client = createMockClient();
      await initializeChatManager(client, baseCfg);

      const dispatch = vi.fn();

      const mockEs = createMockEventSource();
      (client.connectSSE as ReturnType<typeof vi.fn>).mockReturnValue(mockEs);

      const abortController = new AbortController();
      startInboundListener({
        client,
        cfg: baseCfg,
        abortSignal: abortController.signal,
        reconnectDelayMs: 100,
        dispatch,
      });

      // Agent message should be ignored
      mockEs.triggerMessage({
        id: "evt-5",
        type: "message.created",
        payload: {
          chatId: "chat-1",
          messageId: "agent-msg-1",
          role: "agent",
          content: "I am the agent",
          senderId: "grami",
        },
      });

      // Give the async handler time to process
      await new Promise((r) => setTimeout(r, 50));
      expect(dispatch).not.toHaveBeenCalled();

      abortController.abort();
    });

    it("deduplicates messages with same messageId", async () => {
      const client = createMockClient();
      await initializeChatManager(client, baseCfg);

      const dispatch = vi.fn();

      const mockEs = createMockEventSource();
      (client.connectSSE as ReturnType<typeof vi.fn>).mockReturnValue(mockEs);

      const abortController = new AbortController();
      startInboundListener({
        client,
        cfg: baseCfg,
        abortSignal: abortController.signal,
        reconnectDelayMs: 100,
        dispatch,
      });

      const event = {
        id: "evt-6",
        type: "message.created",
        payload: {
          chatId: "chat-1",
          messageId: "user-msg-dup",
          role: "user",
          content: "Hello",
          senderId: "user:primary",
        },
      };

      mockEs.triggerMessage(event);
      mockEs.triggerMessage(event); // Same messageId

      await new Promise((r) => setTimeout(r, 50));
      expect(dispatch).toHaveBeenCalledTimes(1);

      abortController.abort();
    });
  });

  describe("request.resolved event handling", () => {
    it("dispatches a choice request resolution", async () => {
      const client = createMockClient();
      await initializeChatManager(client, baseCfg);

      let capturedArgs: any;
      const dispatch: DispatchFn = (args) => {
        capturedArgs = args;
      };

      const mockEs = createMockEventSource();
      (client.connectSSE as ReturnType<typeof vi.fn>).mockReturnValue(mockEs);

      const abortController = new AbortController();
      startInboundListener({
        client,
        cfg: baseCfg,
        abortSignal: abortController.signal,
        reconnectDelayMs: 100,
        dispatch,
      });

      mockEs.triggerMessage({
        id: "evt-req-1",
        type: "request.resolved",
        payload: {
          chatId: "chat-1",
          requestId: "req-1",
          type: "choice",
          title: "Deploy?",
          resolutionPayload: { selectedOptionIds: ["approve"] },
        },
      });

      await vi.waitFor(() => expect(capturedArgs).toBeDefined());

      expect(capturedArgs.chatId).toBe("chat-1");
      expect(capturedArgs.messageId).toBe("req:req-1:resolved");
      expect(capturedArgs.content).toBe('[Request resolved: "Deploy?"] Selected: approve');
      expect(capturedArgs.agentId).toBe("grami");

      abortController.abort();
    });

    it("formats text_input resolution", async () => {
      const client = createMockClient();
      await initializeChatManager(client, baseCfg);

      let capturedArgs: any;
      const dispatch: DispatchFn = (args) => {
        capturedArgs = args;
      };

      const mockEs = createMockEventSource();
      (client.connectSSE as ReturnType<typeof vi.fn>).mockReturnValue(mockEs);

      const abortController = new AbortController();
      startInboundListener({
        client,
        cfg: baseCfg,
        abortSignal: abortController.signal,
        reconnectDelayMs: 100,
        dispatch,
      });

      mockEs.triggerMessage({
        id: "evt-req-2",
        type: "request.resolved",
        payload: {
          chatId: "chat-1",
          requestId: "req-2",
          type: "text_input",
          title: "PR Description",
          resolutionPayload: { text: "Fixed the auth bug" },
        },
      });

      await vi.waitFor(() => expect(capturedArgs).toBeDefined());
      expect(capturedArgs.content).toBe('[Request resolved: "PR Description"] Response: Fixed the auth bug');

      abortController.abort();
    });

    it("formats form resolution", async () => {
      const client = createMockClient();
      await initializeChatManager(client, baseCfg);

      let capturedArgs: any;
      const dispatch: DispatchFn = (args) => {
        capturedArgs = args;
      };

      const mockEs = createMockEventSource();
      (client.connectSSE as ReturnType<typeof vi.fn>).mockReturnValue(mockEs);

      const abortController = new AbortController();
      startInboundListener({
        client,
        cfg: baseCfg,
        abortSignal: abortController.signal,
        reconnectDelayMs: 100,
        dispatch,
      });

      mockEs.triggerMessage({
        id: "evt-req-3",
        type: "request.resolved",
        payload: {
          chatId: "chat-1",
          requestId: "req-3",
          type: "form",
          title: "Feature Proposal",
          resolutionPayload: { values: { title: "Dark mode", priority: "high" } },
        },
      });

      await vi.waitFor(() => expect(capturedArgs).toBeDefined());
      expect(capturedArgs.content).toBe(
        '[Request resolved: "Feature Proposal"] Form values: {"title":"Dark mode","priority":"high"}',
      );

      abortController.abort();
    });

    it("formats unknown request type as JSON", async () => {
      const client = createMockClient();
      await initializeChatManager(client, baseCfg);

      let capturedArgs: any;
      const dispatch: DispatchFn = (args) => {
        capturedArgs = args;
      };

      const mockEs = createMockEventSource();
      (client.connectSSE as ReturnType<typeof vi.fn>).mockReturnValue(mockEs);

      const abortController = new AbortController();
      startInboundListener({
        client,
        cfg: baseCfg,
        abortSignal: abortController.signal,
        reconnectDelayMs: 100,
        dispatch,
      });

      mockEs.triggerMessage({
        id: "evt-req-4",
        type: "request.resolved",
        payload: {
          chatId: "chat-1",
          requestId: "req-4",
          type: "custom_widget",
          title: "Custom",
          resolutionPayload: { foo: "bar" },
        },
      });

      await vi.waitFor(() => expect(capturedArgs).toBeDefined());
      expect(capturedArgs.content).toBe('[Request resolved: "Custom"] {"foo":"bar"}');

      abortController.abort();
    });
  });

  describe("SSE reconnect behavior", () => {
    it("reconnects on non-auth error", async () => {
      const client = createMockClient();
      await initializeChatManager(client, baseCfg);

      const mockEs1 = createMockEventSource();
      const mockEs2 = createMockEventSource();
      (client.connectSSE as ReturnType<typeof vi.fn>)
        .mockReturnValueOnce(mockEs1)
        .mockReturnValueOnce(mockEs2);

      const abortController = new AbortController();
      startInboundListener({
        client,
        cfg: baseCfg,
        abortSignal: abortController.signal,
        reconnectDelayMs: 10,
        dispatch: vi.fn(),
      });

      mockEs1.triggerError({ code: 500, message: "Server error" });

      await new Promise((r) => setTimeout(r, 50));

      expect(client.connectSSE).toHaveBeenCalledTimes(2);
      expect(mockEs1.close).toHaveBeenCalled();

      abortController.abort();
    });

    it("does not reconnect on 401 auth error", async () => {
      const client = createMockClient();
      await initializeChatManager(client, baseCfg);

      const mockEs = createMockEventSource();
      (client.connectSSE as ReturnType<typeof vi.fn>).mockReturnValue(mockEs);

      const abortController = new AbortController();
      startInboundListener({
        client,
        cfg: baseCfg,
        abortSignal: abortController.signal,
        reconnectDelayMs: 10,
        dispatch: vi.fn(),
      });

      mockEs.triggerError({ code: 401, message: "Unauthorized" });

      await new Promise((r) => setTimeout(r, 50));

      expect(client.connectSSE).toHaveBeenCalledTimes(1);

      abortController.abort();
    });

    it("does not reconnect on 403 auth error", async () => {
      const client = createMockClient();
      await initializeChatManager(client, baseCfg);

      const mockEs = createMockEventSource();
      (client.connectSSE as ReturnType<typeof vi.fn>).mockReturnValue(mockEs);

      const abortController = new AbortController();
      startInboundListener({
        client,
        cfg: baseCfg,
        abortSignal: abortController.signal,
        reconnectDelayMs: 10,
        dispatch: vi.fn(),
      });

      mockEs.triggerError({ code: 403, message: "Forbidden" });

      await new Promise((r) => setTimeout(r, 50));

      expect(client.connectSSE).toHaveBeenCalledTimes(1);

      abortController.abort();
    });
  });

  describe("deliver callback with media", () => {
    it("downloads and uploads media on final with mediaUrl", async () => {
      const client = createMockClient({
        createMessage: vi.fn()
          .mockResolvedValueOnce({ id: "msg-text" })
          .mockResolvedValueOnce({ id: "msg-media" }),
      });
      await initializeChatManager(client, baseCfg);

      let capturedDeliver!: (payload: ReplyPayload, meta: { kind: DeliverKind }) => Promise<void>;

      const dispatch: DispatchFn = ({ deliver }) => {
        capturedDeliver = deliver;
      };

      const mockEs = createMockEventSource();
      (client.connectSSE as ReturnType<typeof vi.fn>).mockReturnValue(mockEs);

      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockResolvedValue(
        new Response(Buffer.from("image-data"), {
          headers: { "content-type": "image/jpeg" },
        }),
      );

      const abortController = new AbortController();
      startInboundListener({
        client,
        cfg: baseCfg,
        abortSignal: abortController.signal,
        reconnectDelayMs: 100,
        dispatch,
      });

      mockEs.triggerMessage({
        id: "evt-media-1",
        type: "message.created",
        payload: {
          chatId: "chat-1",
          messageId: "user-msg-media",
          role: "user",
          content: "Send me an image",
          senderId: "user:primary",
        },
      });

      await vi.waitFor(() => expect(capturedDeliver).toBeDefined());

      await capturedDeliver(
        { mediaUrl: "https://example.com/photo.jpg" },
        { kind: "final" },
      );

      expect(client.createMessage).toHaveBeenCalledWith("chat-1", {
        role: "agent",
        senderId: "grami",
        content: "",
      });
      expect(client.uploadMedia).toHaveBeenCalledWith("chat-1", expect.objectContaining({
        filename: "photo.jpg",
        contentType: "image/jpeg",
      }));

      globalThis.fetch = originalFetch;
      abortController.abort();
    });
  });
});

/**
 * Minimal mock EventSource for testing.
 */
function createMockEventSource() {
  let onmessage: ((event: MessageEvent) => void) | null = null;
  let onerror: ((event: Event) => void) | null = null;
  let onopen: (() => void) | null = null;

  const es = {
    get onmessage() {
      return onmessage;
    },
    set onmessage(fn: ((event: MessageEvent) => void) | null) {
      onmessage = fn;
    },
    get onerror() {
      return onerror;
    },
    set onerror(fn: ((event: Event) => void) | null) {
      onerror = fn;
    },
    get onopen() {
      return onopen;
    },
    set onopen(fn: (() => void) | null) {
      onopen = fn;
      // Auto-fire open
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

  return es;
}
