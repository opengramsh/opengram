import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { OpenGramClient } from "../src/api-client.js";
import {
  clearChatQueuesForTests,
  enqueueOrSupersede,
  getActiveDispatchId,
  isSuperseded,
  markSuperseded,
  setDispatchCleanup,
} from "../src/chat-queue.js";
import { clearActiveStreamsForTests, initStream } from "../src/streaming.js";

function createMockClient(overrides?: Partial<OpenGramClient>): OpenGramClient {
  return {
    createMessage: vi.fn().mockResolvedValue({ id: "msg-1" }),
    sendChunk: vi.fn().mockResolvedValue(undefined),
    completeMessage: vi.fn().mockResolvedValue(undefined),
    cancelMessage: vi.fn().mockResolvedValue(undefined),
    cancelStreamingMessagesForChat: vi.fn().mockResolvedValue({ cancelledMessageIds: [] }),
    ...overrides,
  } as unknown as OpenGramClient;
}

describe("chat-queue", () => {
  beforeEach(() => {
    clearChatQueuesForTests();
    clearActiveStreamsForTests();
  });

  afterEach(() => {
    clearChatQueuesForTests();
    clearActiveStreamsForTests();
  });

  describe("enqueueOrSupersede", () => {
    it("runs callback immediately when no active dispatch", async () => {
      const client = createMockClient();
      const callback = vi.fn().mockResolvedValue(undefined);

      enqueueOrSupersede("chat-1", "d-1", callback, client);
      await vi.waitFor(() => expect(callback).toHaveBeenCalledWith("d-1"));

      expect(getActiveDispatchId("chat-1")).toBeUndefined(); // finished
    });

    it("sets active dispatch during callback execution", async () => {
      const client = createMockClient();
      let resolveCallback!: () => void;
      const callbackPromise = new Promise<void>((r) => { resolveCallback = r; });
      const callback = vi.fn().mockReturnValue(callbackPromise);

      enqueueOrSupersede("chat-1", "d-1", callback, client);

      // While callback is running, the dispatch should be active
      expect(getActiveDispatchId("chat-1")).toBe("d-1");

      resolveCallback();
      await vi.waitFor(() => expect(getActiveDispatchId("chat-1")).toBeUndefined());
    });

    it("supersedes active dispatch when new message arrives", async () => {
      const client = createMockClient();
      let resolveFirst!: () => void;
      const firstPromise = new Promise<void>((r) => { resolveFirst = r; });
      const firstCallback = vi.fn().mockReturnValue(firstPromise);
      const firstCleanup = vi.fn();

      enqueueOrSupersede("chat-1", "d-1", firstCallback, client);
      setDispatchCleanup("chat-1", "d-1", firstCleanup);

      // New message arrives while d-1 is active
      const secondCallback = vi.fn().mockResolvedValue(undefined);
      enqueueOrSupersede("chat-1", "d-2", secondCallback, client);

      // d-1 should be superseded
      expect(isSuperseded("d-1")).toBe(true);
      expect(firstCleanup).toHaveBeenCalled();

      // d-2 should be the new active dispatch
      expect(getActiveDispatchId("chat-1")).toBe("d-2");
      expect(secondCallback).toHaveBeenCalledWith("d-2");

      // Resolve first to avoid dangling promise
      resolveFirst();
    });

    it("does not bulk-cancel server-side chat streams when superseding", async () => {
      const client = createMockClient();
      let resolveFirst!: () => void;
      const firstPromise = new Promise<void>((r) => { resolveFirst = r; });

      enqueueOrSupersede("chat-1", "d-1", () => firstPromise, client);

      enqueueOrSupersede("chat-1", "d-2", async () => {}, client);

      expect(client.cancelStreamingMessagesForChat).not.toHaveBeenCalled();

      resolveFirst();
    });

    it("cancels all plugin-side streams for the chat when superseding", async () => {
      const client = createMockClient();
      let resolveFirst!: () => void;
      const firstPromise = new Promise<void>((r) => { resolveFirst = r; });

      // Pre-seed a stream for d-1
      initStream("d-1", "chat-1", "msg-stream-1", "grami");

      enqueueOrSupersede("chat-1", "d-1", () => firstPromise, client);
      enqueueOrSupersede("chat-1", "d-2", async () => {}, client);

      // cancelMessage should have been called for the stream
      expect(client.cancelMessage).toHaveBeenCalledWith("msg-stream-1");

      resolveFirst();
    });

    it("cleans up active dispatch when callback fails", async () => {
      const client = createMockClient();
      const callback = vi.fn().mockRejectedValue(new Error("dispatch error"));

      enqueueOrSupersede("chat-1", "d-fail", callback, client);

      await vi.waitFor(() => expect(getActiveDispatchId("chat-1")).toBeUndefined());
    });

    it("isolates queues by chatId", async () => {
      const client = createMockClient();
      let resolveA!: () => void;
      let resolveB!: () => void;
      const promiseA = new Promise<void>((r) => { resolveA = r; });
      const promiseB = new Promise<void>((r) => { resolveB = r; });

      enqueueOrSupersede("chat-A", "d-A", () => promiseA, client);
      enqueueOrSupersede("chat-B", "d-B", () => promiseB, client);

      expect(getActiveDispatchId("chat-A")).toBe("d-A");
      expect(getActiveDispatchId("chat-B")).toBe("d-B");

      // Superseding chat-A should not affect chat-B
      enqueueOrSupersede("chat-A", "d-A2", async () => {}, client);
      expect(isSuperseded("d-A")).toBe(true);
      expect(isSuperseded("d-B")).toBe(false);
      expect(getActiveDispatchId("chat-B")).toBe("d-B");

      resolveA();
      resolveB();
    });

    it("triple supersede: each dispatch supersedes the previous", async () => {
      const client = createMockClient();
      const resolvers: (() => void)[] = [];
      const promises = [0, 1, 2].map(
        () => new Promise<void>((r) => { resolvers.push(r); }),
      );

      enqueueOrSupersede("chat-1", "d-1", () => promises[0], client);
      enqueueOrSupersede("chat-1", "d-2", () => promises[1], client);
      enqueueOrSupersede("chat-1", "d-3", () => promises[2], client);

      expect(isSuperseded("d-1")).toBe(true);
      expect(isSuperseded("d-2")).toBe(true);
      expect(isSuperseded("d-3")).toBe(false);
      expect(getActiveDispatchId("chat-1")).toBe("d-3");

      for (const r of resolvers) r();
    });
  });

  describe("markSuperseded / isSuperseded", () => {
    it("marks a dispatch as superseded", () => {
      expect(isSuperseded("d-x")).toBe(false);
      markSuperseded("d-x");
      expect(isSuperseded("d-x")).toBe(true);
    });

    it("TTL cleanup removes superseded entry after timeout", () => {
      vi.useFakeTimers();
      markSuperseded("d-ttl");
      expect(isSuperseded("d-ttl")).toBe(true);

      vi.advanceTimersByTime(5 * 60 * 1000 + 1);
      expect(isSuperseded("d-ttl")).toBe(false);
      vi.useRealTimers();
    });
  });

  describe("setDispatchCleanup", () => {
    it("updates cleanup for the active dispatch", async () => {
      const client = createMockClient();
      let resolveCallback!: () => void;
      const callbackPromise = new Promise<void>((r) => { resolveCallback = r; });

      const originalCleanup = vi.fn();
      const updatedCleanup = vi.fn();

      enqueueOrSupersede("chat-1", "d-1", () => callbackPromise, client);

      // Update cleanup
      setDispatchCleanup("chat-1", "d-1", updatedCleanup);

      // Supersede — should call the updated cleanup
      enqueueOrSupersede("chat-1", "d-2", async () => {}, client);

      expect(updatedCleanup).toHaveBeenCalled();
      expect(originalCleanup).not.toHaveBeenCalled();

      resolveCallback();
    });

    it("no-ops if dispatch is not the active one", () => {
      const cleanup = vi.fn();

      // No active dispatch for this chat
      setDispatchCleanup("chat-1", "d-nonexistent", cleanup);

      // Should not throw, just no-op
      expect(cleanup).not.toHaveBeenCalled();
    });
  });
});
