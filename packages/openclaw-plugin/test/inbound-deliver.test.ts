import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { OpenGramClient } from "../src/api-client.js";
import { initializeChatManager } from "../src/chat-manager.js";
import { clearChatQueuesForTests, isSuperseded } from "../src/chat-queue.js";
import { clearProcessedIdsForTests, startInboundListener, type DispatchFn, type ReplyPayload, type DeliverKind } from "../src/inbound.js";
import { clearActiveStreamsForTests, hasActiveStream } from "../src/streaming.js";
import type { Chat, ListChatsResponse } from "../src/types.js";

function createMockClient(overrides?: Partial<OpenGramClient>): OpenGramClient {
  return {
    createMessage: vi.fn().mockResolvedValue({ id: "msg-1" }),
    sendChunk: vi.fn().mockResolvedValue(undefined),
    completeMessage: vi.fn().mockResolvedValue(undefined),
    cancelMessage: vi.fn().mockResolvedValue(undefined),
    cancelStreamingMessagesForChat: vi.fn().mockResolvedValue({ cancelledMessageIds: [] }),
    getChat: vi.fn().mockResolvedValue({ id: "chat-1", agentIds: ["grami"] } as Chat),
    listChats: vi.fn().mockResolvedValue({ data: [], cursor: { hasMore: false } } as ListChatsResponse),
    connectSSE: vi.fn(),
    health: vi.fn().mockResolvedValue({ status: "ok", version: "1.0.0", uptime: 100 }),
    uploadMedia: vi.fn().mockResolvedValue({ id: "media-1" }),
    sendTyping: vi.fn().mockResolvedValue(undefined),
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

describe("inbound deliver integration", () => {
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

      // Eager streaming message created before any blocks
      expect(client.createMessage).toHaveBeenCalledWith("chat-1", {
        role: "agent",
        senderId: "grami",
        streaming: true,
      });

      // Simulate block streaming — should NOT call createMessage again
      await capturedDeliver({ text: "Hi there" }, { kind: "block" });
      expect(client.createMessage).toHaveBeenCalledTimes(1);
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

    it("keeps block content when final payload text is empty", async () => {
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
        id: "evt-empty-final-1",
        type: "message.created",
        payload: {
          chatId: "chat-1",
          messageId: "user-msg-empty-final-1",
          role: "user",
          content: "Tell me something",
          senderId: "user:primary",
        },
      });

      await vi.waitFor(() => expect(capturedDeliver).toBeDefined());

      await capturedDeliver({ text: "Accumulated answer from blocks." }, { kind: "block" });
      await capturedDeliver({ text: "" }, { kind: "final" });

      // Expected: finalize eager stream with previously streamed block content.
      // Current behavior cancels the stream and leaves an empty bubble.
      expect(client.completeMessage).toHaveBeenCalledWith("msg-1", "Accumulated answer from blocks.");
      expect(client.cancelMessage).not.toHaveBeenCalledWith("msg-1");

      abortController.abort();
    });

    it("finalizes eager stream on final message when no blocks preceded", async () => {
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

      // Eager streaming message was created
      expect(client.createMessage).toHaveBeenCalledWith("chat-1", {
        role: "agent",
        senderId: "grami",
        streaming: true,
      });

      // Final with no preceding blocks — should complete the eager stream
      await capturedDeliver({ text: "Here's the answer." }, { kind: "final" });

      // completeMessage should have been called to finalize the eager stream
      expect(client.completeMessage).toHaveBeenCalledWith("msg-1", "Here's the answer.");
      // Only the eager streaming createMessage, no additional normal message
      expect(client.createMessage).toHaveBeenCalledTimes(1);

      abortController.abort();
    });

    it("keeps streamed block content when final payload text is empty", async () => {
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
        id: "evt-2b",
        type: "message.created",
        payload: {
          chatId: "chat-1",
          messageId: "user-msg-2b",
          role: "user",
          content: "Quick question",
          senderId: "user:primary",
        },
      });

      await vi.waitFor(() => expect(capturedDeliver).toBeDefined());

      await capturedDeliver({ text: "Partial answer from blocks" }, { kind: "block" });
      await capturedDeliver({ text: "" }, { kind: "final" });

      // Empty final text should finalize from accumulated partial content.
      expect(client.completeMessage).toHaveBeenCalledWith("msg-1", "Partial answer from blocks");
      expect(client.cancelMessage).not.toHaveBeenCalledWith("msg-1");

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

    it("onCleanup cancels active stream after blocks", async () => {
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

      // Eager streaming message created before blocks
      expect(client.createMessage).toHaveBeenCalledWith("chat-1", {
        role: "agent",
        senderId: "grami",
        streaming: true,
      });

      // Send a block
      await capturedDeliver({ text: "Partial" }, { kind: "block" });
      // No additional createMessage — stream was pre-seeded
      expect(client.createMessage).toHaveBeenCalledTimes(1);

      // Call onCleanup (simulates unexpected completion)
      capturedCleanup();
      expect(client.cancelMessage).toHaveBeenCalledWith("msg-1");

      abortController.abort();
    });

    it("onCleanup cancels eager stream even without blocks", async () => {
      const client = createMockClient();
      await initializeChatManager(client, baseCfg);

      let capturedCleanup!: () => void;

      const dispatch: DispatchFn = ({ onCleanup }) => {
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
        id: "evt-cleanup-eager",
        type: "message.created",
        payload: {
          chatId: "chat-1",
          messageId: "user-msg-cleanup-eager",
          role: "user",
          content: "Hello",
          senderId: "user:primary",
        },
      });

      await vi.waitFor(() => expect(capturedCleanup).toBeDefined());

      // Eager streaming message created
      expect(client.createMessage).toHaveBeenCalledWith("chat-1", {
        role: "agent",
        senderId: "grami",
        streaming: true,
      });

      // Call onCleanup without any blocks — should cancel the eager stream
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
          .mockResolvedValueOnce({ id: "msg-eager" })
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

      // First createMessage is the eager streaming message
      expect(client.createMessage).toHaveBeenCalledWith("chat-1", {
        role: "agent",
        senderId: "grami",
        streaming: true,
      });

      await capturedDeliver(
        { mediaUrl: "https://example.com/photo.jpg" },
        { kind: "final" },
      );

      // Eager stream cancelled (no text), then a new message for media
      expect(client.cancelMessage).toHaveBeenCalledWith("msg-eager");
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

  describe("rapid sequential messages (KAI-230 — supersede)", () => {
    it("supersedes first dispatch when second message arrives mid-stream", async () => {
      let msgCounter = 0;
      const client = createMockClient({
        createMessage: vi.fn().mockImplementation(() =>
          Promise.resolve({ id: `msg-${++msgCounter}` }),
        ),
      });
      await initializeChatManager(client, baseCfg);

      const dispatches: Array<{
        deliver: (payload: ReplyPayload, meta: { kind: DeliverKind }) => Promise<void>;
        onCleanup: () => void;
        dispatchId?: string;
      }> = [];

      // Capture all dispatches — the dispatch function is synchronous, storing
      // the deliver/cleanup handles for later manual invocation.
      const dispatch: DispatchFn = ({ deliver, onCleanup }) => {
        dispatches.push({ deliver, onCleanup });
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

      // First message
      mockEs.triggerMessage({
        id: "evt-rapid-1",
        type: "message.created",
        payload: {
          chatId: "chat-1",
          messageId: "user-msg-rapid-1",
          role: "user",
          content: "First message",
          senderId: "user:primary",
        },
      });

      await vi.waitFor(() => expect(dispatches.length).toBe(1));

      // First dispatch is active — send a block
      await dispatches[0].deliver({ text: "Working on first..." }, { kind: "block" });

      // Second message arrives while first is still processing
      mockEs.triggerMessage({
        id: "evt-rapid-2",
        type: "message.created",
        payload: {
          chatId: "chat-1",
          messageId: "user-msg-rapid-2",
          role: "user",
          content: "Second message",
          senderId: "user:primary",
        },
      });

      await vi.waitFor(() => expect(dispatches.length).toBe(2));

      // First dispatch's stream should have been cancelled (superseded)
      // msg-1 is the eager streaming message for the first dispatch
      expect(client.cancelMessage).toHaveBeenCalledWith("msg-1");

      // Late deliver from the first dispatch should be a no-op
      await dispatches[0].deliver({ text: "Late reply from first" }, { kind: "final" });

      // msg-2 is the eager streaming message for the second dispatch
      // completeMessage should NOT have been called with msg-1 (it was cancelled)
      expect(client.completeMessage).not.toHaveBeenCalled();

      // Second dispatch can deliver normally
      await dispatches[1].deliver({ text: "Reply to second" }, { kind: "final" });
      expect(client.completeMessage).toHaveBeenCalledWith("msg-2", "Reply to second");

      abortController.abort();
    });

    it("three rapid messages: only the last dispatch produces output", async () => {
      let msgCounter = 0;
      const client = createMockClient({
        createMessage: vi.fn().mockImplementation(() =>
          Promise.resolve({ id: `msg-${++msgCounter}` }),
        ),
      });
      await initializeChatManager(client, baseCfg);

      const dispatches: Array<{
        deliver: (payload: ReplyPayload, meta: { kind: DeliverKind }) => Promise<void>;
      }> = [];

      const dispatch: DispatchFn = ({ deliver }) => {
        dispatches.push({ deliver });
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

      // Fire three messages in quick succession
      for (let i = 1; i <= 3; i++) {
        mockEs.triggerMessage({
          id: `evt-triple-${i}`,
          type: "message.created",
          payload: {
            chatId: "chat-1",
            messageId: `user-msg-triple-${i}`,
            role: "user",
            content: `Message ${i}`,
            senderId: "user:primary",
          },
        });
        // Small delay to let the async handler kick in
        await new Promise((r) => setTimeout(r, 20));
      }

      await vi.waitFor(() => expect(dispatches.length).toBe(3));

      // Late delivers from first two should be no-ops
      await dispatches[0].deliver({ text: "Ghost 1" }, { kind: "final" });
      await dispatches[1].deliver({ text: "Ghost 2" }, { kind: "final" });

      // Neither should have called completeMessage
      expect(client.completeMessage).not.toHaveBeenCalled();

      // Only the third dispatch should produce output
      await dispatches[2].deliver({ text: "The real reply" }, { kind: "final" });
      expect(client.completeMessage).toHaveBeenCalledTimes(1);
      expect(client.completeMessage).toHaveBeenCalledWith("msg-3", "The real reply");

      abortController.abort();
    });

    it("different chats are not affected by each other's supersede", async () => {
      let msgCounter = 0;
      const client = createMockClient({
        createMessage: vi.fn().mockImplementation(() =>
          Promise.resolve({ id: `msg-${++msgCounter}` }),
        ),
      });
      await initializeChatManager(client, {
        ...baseCfg,
        channels: {
          opengram: {
            ...baseCfg.channels.opengram,
          },
        },
      });
      // Override getChat to return chats with different IDs
      (client.getChat as ReturnType<typeof vi.fn>).mockImplementation((chatId: string) =>
        Promise.resolve({ id: chatId, agentIds: ["grami"] }),
      );

      const dispatches: Array<{
        chatId: string;
        deliver: (payload: ReplyPayload, meta: { kind: DeliverKind }) => Promise<void>;
      }> = [];

      const dispatch: DispatchFn = ({ chatId, deliver }) => {
        dispatches.push({ chatId, deliver });
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

      // Message to chat-A
      mockEs.triggerMessage({
        id: "evt-iso-1",
        type: "message.created",
        payload: {
          chatId: "chat-A",
          messageId: "user-msg-iso-A",
          role: "user",
          content: "Hello A",
          senderId: "user:primary",
        },
      });

      await vi.waitFor(() => expect(dispatches.length).toBe(1));

      // Message to chat-B
      mockEs.triggerMessage({
        id: "evt-iso-2",
        type: "message.created",
        payload: {
          chatId: "chat-B",
          messageId: "user-msg-iso-B",
          role: "user",
          content: "Hello B",
          senderId: "user:primary",
        },
      });

      await vi.waitFor(() => expect(dispatches.length).toBe(2));

      // Both should be able to deliver independently
      await dispatches[0].deliver({ text: "Reply A" }, { kind: "final" });
      await dispatches[1].deliver({ text: "Reply B" }, { kind: "final" });

      expect(client.completeMessage).toHaveBeenCalledTimes(2);
      expect(client.completeMessage).toHaveBeenCalledWith("msg-1", "Reply A");
      expect(client.completeMessage).toHaveBeenCalledWith("msg-2", "Reply B");

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
