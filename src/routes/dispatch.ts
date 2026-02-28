import { Hono } from 'hono';

import { parseJsonBody, toErrorResponse, validationError } from '@/src/api/http';
import { applyWriteMiddlewares } from '@/src/api/write-controls';
import { loadOpengramConfig } from '@/src/config/opengram-config';
import {
  claimDispatchBatches,
  completeDispatchBatch,
  failDispatchBatch,
  heartbeatDispatchBatch,
} from '@/src/services/dispatch-service';

type ClaimDispatchBody = {
  workerId?: unknown;
  leaseMs?: unknown;
  waitMs?: unknown;
  limit?: unknown;
};

type HeartbeatDispatchBody = {
  workerId?: unknown;
  extendMs?: unknown;
};

type CompleteDispatchBody = {
  workerId?: unknown;
};

type FailDispatchBody = {
  workerId?: unknown;
  reason?: unknown;
  retryable?: unknown;
  retryDelayMs?: unknown;
};

function requireWorkerId(value: unknown) {
  if (typeof value !== 'string' || !value.trim()) {
    throw validationError('workerId is required.', { field: 'workerId' });
  }

  return value.trim();
}

function optionalPositiveInteger(value: unknown, field: string) {
  if (value === undefined) {
    return undefined;
  }

  if (!Number.isInteger(value) || (value as number) < 0) {
    throw validationError(`${field} must be a non-negative integer.`, { field });
  }

  return value as number;
}

function optionalPositiveIntegerAtLeastOne(value: unknown, field: string) {
  if (value === undefined) {
    return undefined;
  }

  if (!Number.isInteger(value) || (value as number) < 1) {
    throw validationError(`${field} must be a positive integer.`, { field });
  }

  return value as number;
}

const dispatch = new Hono();

dispatch.post('/claim', async (c) => {
  try {
    applyWriteMiddlewares(c.req.raw);
    const body = await parseJsonBody<ClaimDispatchBody>(c.req.raw);
    const cfg = loadOpengramConfig().server.dispatch;
    const workerId = requireWorkerId(body.workerId);
    const leaseMs = optionalPositiveInteger(body.leaseMs, 'leaseMs') ?? cfg.leaseMs;
    const waitMs = optionalPositiveInteger(body.waitMs, 'waitMs') ?? cfg.claimWaitMs;
    const claimed = await claimDispatchBatches({
      workerId,
      leaseMs,
      waitMs,
      limit: 1,
      signal: c.req.raw.signal,
    });
    if (!claimed.length) {
      return new Response(null, { status: 204 });
    }

    return c.json(claimed[0]);
  } catch (error) {
    return toErrorResponse(error);
  }
});

dispatch.post('/claim-many', async (c) => {
  try {
    applyWriteMiddlewares(c.req.raw);
    const body = await parseJsonBody<ClaimDispatchBody>(c.req.raw);
    const cfg = loadOpengramConfig().server.dispatch;
    const workerId = requireWorkerId(body.workerId);
    const leaseMs = optionalPositiveInteger(body.leaseMs, 'leaseMs') ?? cfg.leaseMs;
    const waitMs = optionalPositiveInteger(body.waitMs, 'waitMs') ?? cfg.claimWaitMs;
    const limit = optionalPositiveIntegerAtLeastOne(body.limit, 'limit') ?? cfg.claim.claimManyLimit;

    const batches = await claimDispatchBatches({
      workerId,
      leaseMs,
      waitMs,
      limit,
      signal: c.req.raw.signal,
    });
    if (!batches.length) {
      return new Response(null, { status: 204 });
    }

    return c.json({ batches });
  } catch (error) {
    return toErrorResponse(error);
  }
});

dispatch.post('/:batchId/heartbeat', async (c) => {
  try {
    applyWriteMiddlewares(c.req.raw);
    const batchId = c.req.param('batchId');
    const body = await parseJsonBody<HeartbeatDispatchBody>(c.req.raw);
    const workerId = requireWorkerId(body.workerId);
    const cfg = loadOpengramConfig().server.dispatch;
    const extendMs = optionalPositiveInteger(body.extendMs, 'extendMs') ?? cfg.leaseMs;

    heartbeatDispatchBatch(batchId, workerId, extendMs);
    return new Response(null, { status: 204 });
  } catch (error) {
    return toErrorResponse(error);
  }
});

dispatch.post('/:batchId/complete', async (c) => {
  try {
    applyWriteMiddlewares(c.req.raw);
    const batchId = c.req.param('batchId');
    const body = await parseJsonBody<CompleteDispatchBody>(c.req.raw);
    const workerId = requireWorkerId(body.workerId);

    completeDispatchBatch(batchId, workerId);
    return new Response(null, { status: 204 });
  } catch (error) {
    return toErrorResponse(error);
  }
});

dispatch.post('/:batchId/fail', async (c) => {
  try {
    applyWriteMiddlewares(c.req.raw);
    const batchId = c.req.param('batchId');
    const body = await parseJsonBody<FailDispatchBody>(c.req.raw);
    const workerId = requireWorkerId(body.workerId);
    if (typeof body.reason !== 'string' || !body.reason.trim()) {
      throw validationError('reason is required.', { field: 'reason' });
    }
    if (typeof body.retryable !== 'boolean') {
      throw validationError('retryable must be a boolean.', { field: 'retryable' });
    }
    const retryDelayMs = optionalPositiveInteger(body.retryDelayMs, 'retryDelayMs');

    failDispatchBatch(batchId, {
      workerId,
      reason: body.reason.trim(),
      retryable: body.retryable,
      retryDelayMs,
    });
    return new Response(null, { status: 204 });
  } catch (error) {
    return toErrorResponse(error);
  }
});

export default dispatch;
