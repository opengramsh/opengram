import os from "node:os";

import type { OpenClawConfig } from "openclaw/plugin-sdk";

import type { DispatchClaimResponse, OpenGramClient } from "./api-client.js";
import { processClaimedDispatchBatch, type DispatchFn } from "./inbound.js";

const DEFAULT_WORKER_LEASE_MS = 30_000;
const DEFAULT_WORKER_HEARTBEAT_INTERVAL_MS = 5_000;
const DEFAULT_WORKER_CLAIM_WAIT_MS = 10_000;
const DEFAULT_WORKER_CLAIM_MANY_LIMIT = 10;
const DEFAULT_WORKER_AUTOSCALE_ENABLED = true;
const DEFAULT_WORKER_MIN_CONCURRENCY = 2;
const DEFAULT_WORKER_MAX_CONCURRENCY = 10;
const DEFAULT_WORKER_SCALE_COOLDOWN_MS = 5_000;
const CLAIM_ERROR_BACKOFF_MS = 1_000;
const EMPTY_CLAIM_BACKOFF_MS = 50;
const CAPACITY_BACKOFF_MS = 25;
const SCALE_UP_SATURATION_MS = 3_000;
const SCALE_DOWN_IDLE_MS = 15_000;
const SCALE_UP_STEP = 2;
const SCALE_DOWN_STEP = 1;

type LogLike = {
  info(msg: string): void;
  warn(msg: string): void;
  error(msg: string): void;
};

export type DispatchWorkerParams = {
  client: OpenGramClient;
  cfg: OpenClawConfig;
  abortSignal: AbortSignal;
  log?: LogLike;
  dispatch?: DispatchFn;
  workerId?: string;
  leaseMs?: number;
  heartbeatIntervalMs?: number;
  claimWaitMs?: number;
  autoscaleEnabled?: boolean;
  minConcurrency?: number;
  maxConcurrency?: number;
  scaleCooldownMs?: number;
  claimManyLimit?: number;
};

function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }

    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);

    const onAbort = () => {
      clearTimeout(timer);
      resolve();
    };

    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function buildWorkerId(explicitWorkerId?: string): string {
  if (explicitWorkerId && explicitWorkerId.trim()) {
    return explicitWorkerId.trim();
  }

  const suffix = Math.random().toString(36).slice(2, 8);
  return `opengram-${os.hostname()}-${process.pid}-${suffix}`;
}

function isLeaseOwnershipError(error: unknown): boolean {
  const message = String(error).toLowerCase();
  return message.includes("409");
}

function toFailureReason(error: unknown): string {
  if (error instanceof Error) {
    return error.message.slice(0, 500);
  }
  return String(error).slice(0, 500);
}

function isRetryableProcessingError(error: unknown): boolean {
  const message = String(error).toLowerCase();
  if (message.includes("validation")) {
    return false;
  }
  return true;
}

async function processClaimedBatch(args: {
  client: OpenGramClient;
  batch: DispatchClaimResponse;
  workerId: string;
  cfg: OpenClawConfig;
  log?: LogLike;
  abortSignal: AbortSignal;
  dispatch?: DispatchFn;
  leaseMs: number;
  heartbeatIntervalMs: number;
}) {
  const {
    client,
    batch,
    workerId,
    cfg,
    log,
    abortSignal,
    dispatch,
    leaseMs,
    heartbeatIntervalMs,
  } = args;
  let leaseLost = false;

  const heartbeat = setInterval(() => {
    if (abortSignal.aborted || leaseLost) {
      return;
    }

    client.heartbeatDispatch(batch.batchId, {
      workerId,
      extendMs: leaseMs,
    }).catch((error) => {
      if (isLeaseOwnershipError(error)) {
        leaseLost = true;
      }
      log?.warn(`[opengram] dispatch heartbeat failed for batch ${batch.batchId}: ${String(error)}`);
    });
  }, heartbeatIntervalMs);

  try {
    const result = await processClaimedDispatchBatch({
      batch,
      cfg,
      client,
      log,
      dispatch,
    });

    if (leaseLost) {
      return;
    }

    if (result.skipped) {
      await client.completeDispatch(batch.batchId, workerId);
      return;
    }

    await client.completeDispatch(batch.batchId, workerId);
  } catch (error) {
    if (leaseLost) {
      return;
    }

    const retryable = isRetryableProcessingError(error);
    const reason = toFailureReason(error);
    try {
      await client.failDispatch(batch.batchId, {
        workerId,
        reason,
        retryable,
      });
    } catch (failError) {
      log?.warn(`[opengram] dispatch fail ack failed for batch ${batch.batchId}: ${String(failError)}`);
    }
  } finally {
    clearInterval(heartbeat);
  }
}

export function startDispatchWorker(params: DispatchWorkerParams): Promise<void> {
  const { client, cfg, abortSignal, log, dispatch } = params;
  const workerId = buildWorkerId(params.workerId);
  const leaseMs = Math.max(1_000, params.leaseMs ?? DEFAULT_WORKER_LEASE_MS);
  const heartbeatIntervalMs = Math.max(
    250,
    params.heartbeatIntervalMs ?? DEFAULT_WORKER_HEARTBEAT_INTERVAL_MS,
  );
  const claimWaitMs = Math.max(0, params.claimWaitMs ?? DEFAULT_WORKER_CLAIM_WAIT_MS);
  const autoscaleEnabled = params.autoscaleEnabled ?? DEFAULT_WORKER_AUTOSCALE_ENABLED;
  const minConcurrency = Math.max(
    1,
    params.minConcurrency ?? DEFAULT_WORKER_MIN_CONCURRENCY,
  );
  const maxConcurrency = Math.max(
    minConcurrency,
    params.maxConcurrency ?? DEFAULT_WORKER_MAX_CONCURRENCY,
  );
  const scaleCooldownMs = Math.max(
    0,
    params.scaleCooldownMs ?? DEFAULT_WORKER_SCALE_COOLDOWN_MS,
  );
  const claimManyLimit = Math.max(
    1,
    params.claimManyLimit ?? DEFAULT_WORKER_CLAIM_MANY_LIMIT,
  );

  return new Promise<void>((resolve) => {
    abortSignal.addEventListener("abort", () => resolve(), { once: true });

    let desiredConcurrency = autoscaleEnabled ? minConcurrency : maxConcurrency;
    let activeCount = 0;
    let emptyClaimStreak = 0;
    let lastScaleAt = 0;
    let saturationSince: number | null = null;
    let lastWorkAt = Date.now();

    const maybeAdjustScale = (backlogLikely: boolean) => {
      if (!autoscaleEnabled) {
        return;
      }

      const now = Date.now();
      const inCooldown = now - lastScaleAt < scaleCooldownMs;
      if (activeCount >= desiredConcurrency && backlogLikely) {
        saturationSince ??= now;
      } else {
        saturationSince = null;
      }

      if (
        !inCooldown &&
        saturationSince !== null &&
        now - saturationSince >= SCALE_UP_SATURATION_MS &&
        desiredConcurrency < maxConcurrency
      ) {
        const next = Math.min(
          maxConcurrency,
          desiredConcurrency + SCALE_UP_STEP,
        );
        if (next !== desiredConcurrency) {
          desiredConcurrency = next;
          lastScaleAt = now;
          saturationSince = null;
          log?.info(
            `[opengram] dispatch autoscale up: desiredConcurrency=${desiredConcurrency}`,
          );
          return;
        }
      }

      if (
        !inCooldown &&
        desiredConcurrency > minConcurrency &&
        activeCount < desiredConcurrency &&
        emptyClaimStreak >= 3 &&
        now - lastWorkAt >= SCALE_DOWN_IDLE_MS
      ) {
        const next = Math.max(
          minConcurrency,
          desiredConcurrency - SCALE_DOWN_STEP,
        );
        if (next !== desiredConcurrency) {
          desiredConcurrency = next;
          lastScaleAt = now;
          log?.info(
            `[opengram] dispatch autoscale down: desiredConcurrency=${desiredConcurrency}`,
          );
        }
      }
    };

    const runPump = async () => {
      while (!abortSignal.aborted) {
        const freeSlots = desiredConcurrency - activeCount;
        if (freeSlots <= 0) {
          maybeAdjustScale(false);
          await wait(CAPACITY_BACKOFF_MS, abortSignal);
          continue;
        }

        const claimLimit = Math.max(1, Math.min(claimManyLimit, freeSlots));
        try {
          const batches = await client.claimDispatchMany({
            workerId,
            leaseMs,
            waitMs: claimWaitMs,
            limit: claimLimit,
          });

          if (!batches.length) {
            emptyClaimStreak += 1;
            maybeAdjustScale(false);
            await wait(EMPTY_CLAIM_BACKOFF_MS, abortSignal);
            continue;
          }

          emptyClaimStreak = 0;
          lastWorkAt = Date.now();

          for (const batch of batches) {
            if (abortSignal.aborted) {
              break;
            }

            activeCount += 1;
            void processClaimedBatch({
              client,
              batch,
              workerId,
              cfg,
              log,
              abortSignal,
              dispatch,
              leaseMs,
              heartbeatIntervalMs,
            })
              .catch((error) => {
                log?.warn(
                  `[opengram] dispatch task error for batch ${batch.batchId}: ${String(error)}`,
                );
              })
              .finally(() => {
                activeCount = Math.max(0, activeCount - 1);
                lastWorkAt = Date.now();
                maybeAdjustScale(false);
              });
          }

          maybeAdjustScale(batches.length >= claimLimit);
        } catch (error) {
          if (abortSignal.aborted) {
            break;
          }

          log?.warn(`[opengram] dispatch worker loop error: ${String(error)}`);
          await wait(CLAIM_ERROR_BACKOFF_MS, abortSignal);
        }
      }
    };

    void runPump();
    log?.info(
      `[opengram] dispatch worker initialized: desiredConcurrency=${desiredConcurrency}, min=${minConcurrency}, max=${maxConcurrency}, autoscale=${autoscaleEnabled}, claimManyLimit=${claimManyLimit}`,
    );
  });
}
