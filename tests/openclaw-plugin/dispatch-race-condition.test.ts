import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearChatQueuesForTests,
  enqueueOrSupersede,
  isSuperseded,
} from "../../packages/openclaw-plugin/src/chat-queue.js";
import { clearActiveStreamsForTests, hasActiveStream, initStream } from "../../packages/openclaw-plugin/src/streaming.js";

/**
 * KAI-234: Dispatch race condition — after createMessage returns, isSuperseded
 * must be checked before calling initStream.
 *
 * When N messages arrive in quick succession for the same chat:
 *   1. All N enqueueOrSupersede() calls execute synchronously
 *   2. Each supersedes the previous — but no streams exist yet to cancel
 *   3. All N dispatch callbacks run concurrently
 *   4. All N call createMessage(..., { streaming: true }) — all in-flight
 *   5. All N come back, creating N streaming messages on the server
 *   6. Only the last dispatch is valid; the other N-1 streaming messages
 *      must be cancelled because the supersede happened before createMessage
 *      returned.
 *
 * Fix: After createMessage returns, check isSuperseded(dispatchId). If true,
 * cancel the just-created message and return early — do NOT call initStream.
 */

function makeClient(createMessageDelay = 50) {
  const createdMessages: string[] = [];
  const cancelledMessages: string[] = [];
  const cancelledChats: string[] = [];
  let msgSeq = 0;

  return {
    createdMessages,
    cancelledMessages,
    cancelledChats,
    createMessage: vi.fn(async (_chatId: string, _opts: Record<string, unknown>) => {
      // Simulate network latency — all calls are in-flight during this delay
      await new Promise((r) => setTimeout(r, createMessageDelay));
      const id = `msg-${++msgSeq}`;
      createdMessages.push(id);
      return { id };
    }),
    cancelMessage: vi.fn(async (messageId: string) => {
      cancelledMessages.push(messageId);
    }),
    cancelStreamingMessagesForChat: vi.fn(async (chatId: string) => {
      cancelledChats.push(chatId);
    }),
    sendTyping: vi.fn(async () => {}),
    sendChunk: vi.fn(async () => {}),
    completeMessage: vi.fn(async () => {}),
  };
}

type MockClient = ReturnType<typeof makeClient>;

describe("KAI-234: dispatch race condition — supersede check after createMessage", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    clearChatQueuesForTests();
    clearActiveStreamsForTests();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("superseded dispatches cancel their streaming message and skip initStream", async () => {
    /**
     * Mirrors the FIXED production code from inbound.ts — after createMessage
     * returns, isSuperseded is checked and the message is cancelled if true.
     */
    const client = makeClient(100) as unknown as MockClient & import("../../packages/openclaw-plugin/src/api-client.js").OpenGramClient;
    const chatId = "chat-1";
    const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

    const initStreamCalls: string[] = [];
    const cancelledBySupersedCheck: string[] = [];

    // Fire 3 rapid messages for the same chat
    for (let i = 1; i <= 3; i++) {
      const dispatchId = `${chatId}:${i}`;

      enqueueOrSupersede(
        chatId,
        dispatchId,
        async () => {
          const streamingMsg = await (client as any).createMessage(chatId, {
            role: "agent",
            senderId: "agent-1",
            streaming: true,
          });

          // THE FIX: check isSuperseded after createMessage (matches inbound.ts)
          if (isSuperseded(dispatchId)) {
            await (client as any).cancelMessage(streamingMsg.id).catch(() => {});
            cancelledBySupersedCheck.push(streamingMsg.id);
            return;
          }

          initStream(dispatchId, chatId, streamingMsg.id, "agent-1");
          initStreamCalls.push(dispatchId);
        },
        client as any,
        log,
      );
    }

    // Advance past createMessage delay
    await vi.advanceTimersByTimeAsync(200);

    // Only the last dispatch should have called initStream
    expect(initStreamCalls).toEqual([`${chatId}:3`]);

    // Dispatches 1 and 2 should have been cancelled after createMessage returned
    expect(cancelledBySupersedCheck).toHaveLength(2);
    expect(cancelledBySupersedCheck).toContain("msg-1");
    expect(cancelledBySupersedCheck).toContain("msg-2");

    // Only dispatch 3's stream is active
    expect(hasActiveStream(`${chatId}:1`)).toBe(false);
    expect(hasActiveStream(`${chatId}:2`)).toBe(false);
    expect(hasActiveStream(`${chatId}:3`)).toBe(true);
  });

  it("6 rapid messages: only the last dispatch creates an active stream", async () => {
    /**
     * Stress test: 6 messages in quick succession — matches the scenario
     * described in the KAI-234 bug report.
     */
    const client = makeClient(50) as unknown as MockClient & import("../../packages/openclaw-plugin/src/api-client.js").OpenGramClient;
    const chatId = "chat-stress";
    const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

    const initStreamCalls: string[] = [];
    const cancelledBySupersedCheck: string[] = [];

    for (let i = 1; i <= 6; i++) {
      const dispatchId = `${chatId}:${i}`;

      enqueueOrSupersede(
        chatId,
        dispatchId,
        async () => {
          const streamingMsg = await (client as any).createMessage(chatId, {
            role: "agent",
            senderId: "agent-1",
            streaming: true,
          });

          if (isSuperseded(dispatchId)) {
            await (client as any).cancelMessage(streamingMsg.id).catch(() => {});
            cancelledBySupersedCheck.push(streamingMsg.id);
            return;
          }

          initStream(dispatchId, chatId, streamingMsg.id, "agent-1");
          initStreamCalls.push(dispatchId);
        },
        client as any,
        log,
      );
    }

    await vi.advanceTimersByTimeAsync(200);

    // Only the 6th dispatch should proceed
    expect(initStreamCalls).toEqual([`${chatId}:6`]);

    // The first 5 dispatches should have cancelled their streaming messages
    expect(cancelledBySupersedCheck).toHaveLength(5);

    // Only dispatch 6 has an active stream
    for (let i = 1; i <= 5; i++) {
      expect(hasActiveStream(`${chatId}:${i}`)).toBe(false);
    }
    expect(hasActiveStream(`${chatId}:6`)).toBe(true);
  });

  it("cancelMessage failure does not propagate (caught with .catch)", async () => {
    /**
     * If the server already cleaned up the streaming message (404),
     * the .catch(() => {}) prevents the error from bubbling.
     */
    const client = makeClient(50) as unknown as MockClient & import("../../packages/openclaw-plugin/src/api-client.js").OpenGramClient;
    // Make cancelMessage reject
    (client as any).cancelMessage = vi.fn(async () => {
      throw new Error("404 Not Found");
    });
    const chatId = "chat-cancel-fail";
    const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

    const initStreamCalls: string[] = [];

    for (let i = 1; i <= 2; i++) {
      const dispatchId = `${chatId}:${i}`;

      enqueueOrSupersede(
        chatId,
        dispatchId,
        async () => {
          const streamingMsg = await (client as any).createMessage(chatId, {
            role: "agent",
            senderId: "agent-1",
            streaming: true,
          });

          if (isSuperseded(dispatchId)) {
            // .catch(() => {}) swallows the 404 — must not throw
            await (client as any).cancelMessage(streamingMsg.id).catch(() => {});
            return;
          }

          initStream(dispatchId, chatId, streamingMsg.id, "agent-1");
          initStreamCalls.push(dispatchId);
        },
        client as any,
        log,
      );
    }

    // Should not throw despite cancelMessage rejecting
    await vi.advanceTimersByTimeAsync(200);

    expect(initStreamCalls).toEqual([`${chatId}:2`]);
    expect(hasActiveStream(`${chatId}:1`)).toBe(false);
    expect(hasActiveStream(`${chatId}:2`)).toBe(true);
  });
});
