import { describe, expect, it, vi } from "vitest";

import { startDispatchWorker } from "../src/dispatch-worker.js";
import type { DispatchClaimResponse, OpenGramClient } from "../src/api-client.js";

const { processClaimedDispatchBatchMock } = vi.hoisted(() => ({
  processClaimedDispatchBatchMock: vi.fn(),
}));

vi.mock("../src/inbound.js", () => ({
  processClaimedDispatchBatch: processClaimedDispatchBatchMock,
}));

function createClaimedBatch(overrides?: Partial<DispatchClaimResponse>): DispatchClaimResponse {
  return {
    batchId: "batch-1",
    chatId: "chat-1",
    kind: "user_batch",
    agentIdHint: "grami",
    compiledContent: "Hello",
    items: [],
    attachments: [],
    ...overrides,
  };
}

function createMockClient(overrides?: Partial<OpenGramClient>): OpenGramClient {
  return {
    claimDispatchMany: vi.fn().mockResolvedValue([]),
    heartbeatDispatch: vi.fn().mockResolvedValue(undefined),
    completeDispatch: vi.fn().mockResolvedValue(undefined),
    failDispatch: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as OpenGramClient;
}

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("dispatch worker", () => {
  it("claims and completes a batch after successful processing", async () => {
    processClaimedDispatchBatchMock.mockResolvedValue({ skipped: false });

    const client = createMockClient({
      claimDispatchMany: vi
        .fn()
        .mockResolvedValueOnce([createClaimedBatch()])
        .mockResolvedValue([]),
    });

    const abortController = new AbortController();
    const lifecycle = startDispatchWorker({
      client,
      cfg: {} as any,
      abortSignal: abortController.signal,
    });

    await vi.waitFor(() => {
      expect(processClaimedDispatchBatchMock).toHaveBeenCalledTimes(1);
      expect(client.completeDispatch).toHaveBeenCalledTimes(1);
    });

    abortController.abort();
    await lifecycle;
  });

  it("fails a batch when processing throws", async () => {
    processClaimedDispatchBatchMock.mockRejectedValue(new Error("sdk failed"));

    const client = createMockClient({
      claimDispatchMany: vi
        .fn()
        .mockResolvedValueOnce([createClaimedBatch({ batchId: "batch-fail" })])
        .mockResolvedValue([]),
    });

    const abortController = new AbortController();
    const lifecycle = startDispatchWorker({
      client,
      cfg: {} as any,
      abortSignal: abortController.signal,
    });

    await vi.waitFor(() => {
      expect(client.failDispatch).toHaveBeenCalledWith(
        "batch-fail",
        expect.objectContaining({
          workerId: expect.any(String),
          reason: "sdk failed",
          retryable: true,
        }),
      );
    });

    abortController.abort();
    await lifecycle;
  });

  it("processes different chats in parallel when one batch is slow", async () => {
    const slowBatchDeferred = createDeferred<{ skipped: boolean }>();
    processClaimedDispatchBatchMock.mockImplementation(async ({ batch }) => {
      if (batch.batchId === "batch-slow") {
        return slowBatchDeferred.promise;
      }
      return { skipped: false };
    });

    const client = createMockClient({
      claimDispatchMany: vi
        .fn()
        .mockResolvedValueOnce([createClaimedBatch({ batchId: "batch-slow", chatId: "chat-a" })])
        .mockResolvedValueOnce([createClaimedBatch({ batchId: "batch-fast", chatId: "chat-b" })])
        .mockResolvedValue([]),
    });

    const abortController = new AbortController();
    const lifecycle = startDispatchWorker({
      client,
      cfg: {} as any,
      abortSignal: abortController.signal,
      autoscaleEnabled: false,
      minConcurrency: 2,
      maxConcurrency: 2,
    });

    await vi.waitFor(() => {
      expect(client.completeDispatch).toHaveBeenCalledWith("batch-fast", expect.any(String));
    });

    expect(client.completeDispatch).not.toHaveBeenCalledWith("batch-slow", expect.any(String));

    slowBatchDeferred.resolve({ skipped: false });
    await vi.waitFor(() => {
      expect(client.completeDispatch).toHaveBeenCalledWith("batch-slow", expect.any(String));
    });

    abortController.abort();
    await lifecycle;
  });
});
