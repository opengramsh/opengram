import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { OpenGramClient } from "../src/api-client.js";
import {
  cancelAllStreamsForChat,
  cancelStream,
  clearActiveStreamsForTests,
  finalizeStream,
  handleBlockReply,
  hasActiveStream,
  initStream,
} from "../src/streaming.js";

function createMockClient(overrides?: Partial<OpenGramClient>): OpenGramClient {
  return {
    createMessage: vi.fn().mockResolvedValue({ id: "msg-stream-1" }),
    sendChunk: vi.fn().mockResolvedValue(undefined),
    completeMessage: vi.fn().mockResolvedValue(undefined),
    cancelMessage: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as OpenGramClient;
}

describe("streaming", () => {
  beforeEach(() => {
    clearActiveStreamsForTests();
  });

  afterEach(() => {
    clearActiveStreamsForTests();
  });

  describe("handleBlockReply", () => {
    it("creates a streaming message on first block reply", async () => {
      const client = createMockClient();

      await handleBlockReply(client, "chat-1", "grami", "dispatch-1", { text: "Hello" });

      expect(client.createMessage).toHaveBeenCalledWith("chat-1", {
        role: "agent",
        senderId: "grami",
        streaming: true,
      });
      expect(client.sendChunk).toHaveBeenCalledWith("msg-stream-1", "Hello");
      expect(hasActiveStream("dispatch-1")).toBe(true);
    });

    it("sends only the delta on subsequent block replies", async () => {
      const client = createMockClient();

      await handleBlockReply(client, "chat-1", "grami", "dispatch-1", { text: "Hello" });
      await handleBlockReply(client, "chat-1", "grami", "dispatch-1", { text: "Hello world" });
      await handleBlockReply(client, "chat-1", "grami", "dispatch-1", {
        text: "Hello world, how are you?",
      });

      // createMessage should only be called once (first block)
      expect(client.createMessage).toHaveBeenCalledTimes(1);

      // sendChunk called three times with deltas
      expect(client.sendChunk).toHaveBeenCalledTimes(3);
      expect(client.sendChunk).toHaveBeenNthCalledWith(1, "msg-stream-1", "Hello");
      expect(client.sendChunk).toHaveBeenNthCalledWith(2, "msg-stream-1", " world");
      expect(client.sendChunk).toHaveBeenNthCalledWith(3, "msg-stream-1", ", how are you?");
    });

    it("skips sendChunk when accumulated text has not grown", async () => {
      const client = createMockClient();

      await handleBlockReply(client, "chat-1", "grami", "dispatch-1", { text: "Hello" });
      // Same text again — no new delta
      await handleBlockReply(client, "chat-1", "grami", "dispatch-1", { text: "Hello" });

      expect(client.sendChunk).toHaveBeenCalledTimes(1);
    });

    it("handles empty payload text", async () => {
      const client = createMockClient();

      await handleBlockReply(client, "chat-1", "grami", "dispatch-1", {});

      // Creates streaming message but no delta to send (empty string)
      expect(client.createMessage).toHaveBeenCalledTimes(1);
      expect(client.sendChunk).not.toHaveBeenCalled();
    });

    it("handles payload with empty string", async () => {
      const client = createMockClient();

      await handleBlockReply(client, "chat-1", "grami", "dispatch-1", { text: "" });

      expect(client.createMessage).toHaveBeenCalledTimes(1);
      expect(client.sendChunk).not.toHaveBeenCalled();
    });

    it("isolates streams by dispatchId", async () => {
      let messageCounter = 0;
      const client = createMockClient({
        createMessage: vi.fn().mockImplementation(() =>
          Promise.resolve({ id: `msg-${++messageCounter}` }),
        ),
      });

      await handleBlockReply(client, "chat-1", "grami", "dispatch-A", { text: "Stream A" });
      await handleBlockReply(client, "chat-1", "grami", "dispatch-B", { text: "Stream B" });

      expect(client.createMessage).toHaveBeenCalledTimes(2);
      expect(client.sendChunk).toHaveBeenCalledWith("msg-1", "Stream A");
      expect(client.sendChunk).toHaveBeenCalledWith("msg-2", "Stream B");
      expect(hasActiveStream("dispatch-A")).toBe(true);
      expect(hasActiveStream("dispatch-B")).toBe(true);
    });

    it("correctly diffs when text is shorter than lastSentLength", async () => {
      const client = createMockClient();

      await handleBlockReply(client, "chat-1", "grami", "dispatch-1", { text: "Hello world" });
      // Shorter text — should not send a chunk (text.length <= lastSentLength)
      await handleBlockReply(client, "chat-1", "grami", "dispatch-1", { text: "Hello" });

      expect(client.sendChunk).toHaveBeenCalledTimes(1);
      expect(client.sendChunk).toHaveBeenCalledWith("msg-stream-1", "Hello world");
    });
  });

  describe("finalizeStream", () => {
    it("completes an active stream and returns true", async () => {
      const client = createMockClient();

      await handleBlockReply(client, "chat-1", "grami", "dispatch-1", { text: "Hello" });
      const result = await finalizeStream(client, "dispatch-1", "Hello world — final.");

      expect(result).toBe(true);
      expect(client.completeMessage).toHaveBeenCalledWith("msg-stream-1", "Hello world — final.");
      expect(hasActiveStream("dispatch-1")).toBe(false);
    });

    it("returns false when no active stream exists", async () => {
      const client = createMockClient();

      const result = await finalizeStream(client, "nonexistent", "Final text");

      expect(result).toBe(false);
      expect(client.completeMessage).not.toHaveBeenCalled();
    });

    it("cleans up the stream state after finalization", async () => {
      const client = createMockClient();

      await handleBlockReply(client, "chat-1", "grami", "dispatch-1", { text: "Partial" });
      expect(hasActiveStream("dispatch-1")).toBe(true);

      await finalizeStream(client, "dispatch-1", "Final");
      expect(hasActiveStream("dispatch-1")).toBe(false);

      // Subsequent handleBlockReply should create a new stream
      await handleBlockReply(client, "chat-1", "grami", "dispatch-1", { text: "New stream" });
      expect(client.createMessage).toHaveBeenCalledTimes(2);
    });
  });

  describe("cancelStream", () => {
    it("cancels an active stream", async () => {
      const client = createMockClient();

      await handleBlockReply(client, "chat-1", "grami", "dispatch-1", { text: "Hello" });
      cancelStream(client, "dispatch-1");

      expect(client.cancelMessage).toHaveBeenCalledWith("msg-stream-1");
      expect(hasActiveStream("dispatch-1")).toBe(false);
    });

    it("is a no-op when no active stream exists", () => {
      const client = createMockClient();

      cancelStream(client, "nonexistent");

      expect(client.cancelMessage).not.toHaveBeenCalled();
    });

    it("swallows errors from cancelMessage", async () => {
      const client = createMockClient({
        cancelMessage: vi.fn().mockRejectedValue(new Error("network error")),
      });

      await handleBlockReply(client, "chat-1", "grami", "dispatch-1", { text: "Hello" });

      // Should not throw
      cancelStream(client, "dispatch-1");
      expect(hasActiveStream("dispatch-1")).toBe(false);
    });
  });

  describe("full stream lifecycle", () => {
    it("create → chunks → complete", async () => {
      const client = createMockClient();

      // Simulate progressive block replies
      await handleBlockReply(client, "chat-1", "grami", "d-1", { text: "The answer" });
      await handleBlockReply(client, "chat-1", "grami", "d-1", { text: "The answer is 42" });
      await handleBlockReply(client, "chat-1", "grami", "d-1", { text: "The answer is 42." });

      const finalized = await finalizeStream(client, "d-1", "The answer is 42.");

      expect(finalized).toBe(true);
      expect(client.createMessage).toHaveBeenCalledTimes(1);
      expect(client.sendChunk).toHaveBeenCalledTimes(3);
      expect(client.completeMessage).toHaveBeenCalledWith("msg-stream-1", "The answer is 42.");
      expect(hasActiveStream("d-1")).toBe(false);
    });

    it("create → chunks → cancel on error", async () => {
      const client = createMockClient();

      await handleBlockReply(client, "chat-1", "grami", "d-1", { text: "Partial output" });
      cancelStream(client, "d-1");

      expect(client.cancelMessage).toHaveBeenCalledWith("msg-stream-1");
      expect(hasActiveStream("d-1")).toBe(false);

      // finalizeStream after cancel should return false
      const result = await finalizeStream(client, "d-1", "Doesn't matter");
      expect(result).toBe(false);
    });
  });

  describe("initStream", () => {
    it("pre-seeded stream skips createMessage on first block", async () => {
      const client = createMockClient();

      initStream("dispatch-pre", "chat-1", "msg-eager-1", "grami");
      await handleBlockReply(client, "chat-1", "grami", "dispatch-pre", { text: "Hello" });

      // createMessage should NOT be called — the stream was pre-seeded
      expect(client.createMessage).not.toHaveBeenCalled();
      expect(client.sendChunk).toHaveBeenCalledWith("msg-eager-1", "Hello");
      expect(hasActiveStream("dispatch-pre")).toBe(true);
    });

    it("allows direct finalizeStream without any blocks", async () => {
      const client = createMockClient();

      initStream("dispatch-pre", "chat-1", "msg-eager-1", "grami");
      const result = await finalizeStream(client, "dispatch-pre", "Final text");

      expect(result).toBe(true);
      expect(client.completeMessage).toHaveBeenCalledWith("msg-eager-1", "Final text");
      expect(hasActiveStream("dispatch-pre")).toBe(false);
    });

    it("cancels an eager stream when final text is omitted and no blocks were streamed", async () => {
      const client = createMockClient();

      initStream("dispatch-empty", "chat-1", "msg-eager-empty", "grami");
      const result = await finalizeStream(client, "dispatch-empty");

      expect(result).toBe(true);
      expect(client.cancelMessage).toHaveBeenCalledWith("msg-eager-empty");
      expect(client.completeMessage).not.toHaveBeenCalled();
      expect(hasActiveStream("dispatch-empty")).toBe(false);
    });

    it("completes from partial content when final text is omitted after blocks", async () => {
      const client = createMockClient();

      initStream("dispatch-partial", "chat-1", "msg-eager-partial", "grami");
      await handleBlockReply(client, "chat-1", "grami", "dispatch-partial", { text: "Partial" });
      const result = await finalizeStream(client, "dispatch-partial");

      expect(result).toBe(true);
      expect(client.completeMessage).toHaveBeenCalledWith("msg-eager-partial");
      expect(client.cancelMessage).not.toHaveBeenCalledWith("msg-eager-partial");
      expect(hasActiveStream("dispatch-partial")).toBe(false);
    });

    it("allows cancelStream without any blocks", () => {
      const client = createMockClient();

      initStream("dispatch-pre", "chat-1", "msg-eager-1", "grami");
      cancelStream(client, "dispatch-pre");

      expect(client.cancelMessage).toHaveBeenCalledWith("msg-eager-1");
      expect(hasActiveStream("dispatch-pre")).toBe(false);
    });
  });

  describe("concurrent dispatch safety", () => {
    it("two dispatches to the same chat create separate streams", async () => {
      let msgCounter = 0;
      const client = createMockClient({
        createMessage: vi.fn().mockImplementation(() =>
          Promise.resolve({ id: `msg-${++msgCounter}` }),
        ),
      });

      await handleBlockReply(client, "chat-1", "grami", "dispatch-A", { text: "A1" });
      await handleBlockReply(client, "chat-1", "grami", "dispatch-B", { text: "B1" });

      expect(client.createMessage).toHaveBeenCalledTimes(2);
      expect(hasActiveStream("dispatch-A")).toBe(true);
      expect(hasActiveStream("dispatch-B")).toBe(true);

      // Each stream gets its own message
      expect(client.sendChunk).toHaveBeenCalledWith("msg-1", "A1");
      expect(client.sendChunk).toHaveBeenCalledWith("msg-2", "B1");
    });

    it("finalizing one dispatch does not affect another", async () => {
      let msgCounter = 0;
      const client = createMockClient({
        createMessage: vi.fn().mockImplementation(() =>
          Promise.resolve({ id: `msg-${++msgCounter}` }),
        ),
      });

      await handleBlockReply(client, "chat-1", "grami", "dispatch-A", { text: "A text" });
      await handleBlockReply(client, "chat-1", "grami", "dispatch-B", { text: "B text" });

      const resultA = await finalizeStream(client, "dispatch-A", "A final");
      expect(resultA).toBe(true);
      expect(hasActiveStream("dispatch-A")).toBe(false);
      expect(hasActiveStream("dispatch-B")).toBe(true);

      // dispatch-B can still receive blocks
      await handleBlockReply(client, "chat-1", "grami", "dispatch-B", { text: "B text more" });
      expect(client.sendChunk).toHaveBeenCalledWith("msg-2", " more");
    });

    it("canceling one dispatch does not affect another", async () => {
      let msgCounter = 0;
      const client = createMockClient({
        createMessage: vi.fn().mockImplementation(() =>
          Promise.resolve({ id: `msg-${++msgCounter}` }),
        ),
      });

      await handleBlockReply(client, "chat-1", "grami", "dispatch-X", { text: "X" });
      await handleBlockReply(client, "chat-1", "grami", "dispatch-Y", { text: "Y" });

      cancelStream(client, "dispatch-X");
      expect(hasActiveStream("dispatch-X")).toBe(false);
      expect(hasActiveStream("dispatch-Y")).toBe(true);

      const resultY = await finalizeStream(client, "dispatch-Y", "Y final");
      expect(resultY).toBe(true);
    });

    it("rapid block replies accumulate deltas correctly", async () => {
      const client = createMockClient();

      // Simulate rapid successive blocks
      await handleBlockReply(client, "chat-1", "grami", "d-rapid", { text: "A" });
      await handleBlockReply(client, "chat-1", "grami", "d-rapid", { text: "AB" });
      await handleBlockReply(client, "chat-1", "grami", "d-rapid", { text: "ABC" });
      await handleBlockReply(client, "chat-1", "grami", "d-rapid", { text: "ABCD" });
      await handleBlockReply(client, "chat-1", "grami", "d-rapid", { text: "ABCDE" });

      expect(client.createMessage).toHaveBeenCalledTimes(1);
      expect(client.sendChunk).toHaveBeenCalledTimes(5);
      expect(client.sendChunk).toHaveBeenNthCalledWith(1, "msg-stream-1", "A");
      expect(client.sendChunk).toHaveBeenNthCalledWith(2, "msg-stream-1", "B");
      expect(client.sendChunk).toHaveBeenNthCalledWith(3, "msg-stream-1", "C");
      expect(client.sendChunk).toHaveBeenNthCalledWith(4, "msg-stream-1", "D");
      expect(client.sendChunk).toHaveBeenNthCalledWith(5, "msg-stream-1", "E");
    });

    /**
     * BUG KAI-217: finalizeStream 409 race condition — reply text lost.
     *
     * When the OpenGram server's stale-streaming sweeper auto-cancels a
     * streaming message (no chunks for >60s during extended thinking),
     * completeMessage() throws (409 Conflict). The current code propagates
     * the exception, so buildDeliver's "if (!wasStreaming)" fallback in
     * inbound.ts never runs, and the reply text is permanently lost.
     *
     * This test demonstrates the bug: finalizeStream throws instead of
     * gracefully handling the 409 and allowing the caller to fall back.
     */
    it("BUG KAI-217: should not throw when completeMessage fails (e.g. 409 conflict)", async () => {
      const client = createMockClient({
        completeMessage: vi.fn().mockRejectedValue(new Error("completeMessage failed: 409")),
      });

      initStream("d-409", "chat-1", "msg-swept", "grami");

      const result = await finalizeStream(client, "d-409", "Important reply that would be lost");

      // Must not throw. Falls back to createMessage internally, returning true.
      expect(result).toBe(true);

      // Stream must be cleaned up regardless of the error.
      expect(hasActiveStream("d-409")).toBe(false);
    });

    it("BUG KAI-217: fallback createMessage is called with correct args on 409", async () => {
      const client = createMockClient({
        completeMessage: vi.fn().mockRejectedValue(new Error("409 Conflict")),
      });

      initStream("d-fallback", "chat-42", "msg-swept-2", "agent-x");

      await finalizeStream(client, "d-fallback", "Recovered reply text");

      // completeMessage was attempted first
      expect(client.completeMessage).toHaveBeenCalledWith("msg-swept-2", "Recovered reply text");

      // Fallback createMessage sent the full text as a regular message
      expect(client.createMessage).toHaveBeenCalledWith("chat-42", {
        role: "agent",
        senderId: "agent-x",
        content: "Recovered reply text",
      });

      expect(hasActiveStream("d-fallback")).toBe(false);
    });

    it("re-creating a stream after finalization works", async () => {
      const client = createMockClient({
        createMessage: vi.fn()
          .mockResolvedValueOnce({ id: "msg-1" })
          .mockResolvedValueOnce({ id: "msg-2" }),
      });

      await handleBlockReply(client, "chat-1", "grami", "d-reuse", { text: "First" });
      await finalizeStream(client, "d-reuse", "First final");

      expect(hasActiveStream("d-reuse")).toBe(false);

      await handleBlockReply(client, "chat-1", "grami", "d-reuse", { text: "Second" });
      expect(hasActiveStream("d-reuse")).toBe(true);
      expect(client.createMessage).toHaveBeenCalledTimes(2);
      expect(client.sendChunk).toHaveBeenCalledWith("msg-2", "Second");
    });
  });

  describe("cancelAllStreamsForChat", () => {
    it("cancels all streams for a given chat", async () => {
      let msgCounter = 0;
      const client = createMockClient({
        createMessage: vi.fn().mockImplementation(() =>
          Promise.resolve({ id: `msg-${++msgCounter}` }),
        ),
      });

      initStream("d-1", "chat-1", "msg-s1", "grami");
      initStream("d-2", "chat-1", "msg-s2", "grami");
      initStream("d-3", "chat-2", "msg-s3", "grami");

      cancelAllStreamsForChat(client, "chat-1");

      expect(client.cancelMessage).toHaveBeenCalledWith("msg-s1");
      expect(client.cancelMessage).toHaveBeenCalledWith("msg-s2");
      expect(client.cancelMessage).not.toHaveBeenCalledWith("msg-s3");
      expect(hasActiveStream("d-1")).toBe(false);
      expect(hasActiveStream("d-2")).toBe(false);
      expect(hasActiveStream("d-3")).toBe(true);
    });

    it("is a no-op when no streams exist for the chat", () => {
      const client = createMockClient();
      cancelAllStreamsForChat(client, "chat-nonexistent");
      expect(client.cancelMessage).not.toHaveBeenCalled();
    });

    it("swallows errors from cancelMessage", () => {
      const client = createMockClient({
        cancelMessage: vi.fn().mockRejectedValue(new Error("network")),
      });

      initStream("d-err", "chat-1", "msg-err", "grami");

      // Should not throw
      cancelAllStreamsForChat(client, "chat-1");
      expect(hasActiveStream("d-err")).toBe(false);
    });
  });
});
