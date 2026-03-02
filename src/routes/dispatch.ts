import { createRoute } from '@hono/zod-openapi';

import { writeErrorResponses, createRouter } from '@/src/api/schemas/common';
import {
  BatchIdParamSchema,
  ClaimDispatchBodySchema,
  ClaimDispatchSingleBodySchema,
  ClaimManyResponseSchema,
  CompleteDispatchBodySchema,
  DispatchBatchSchema,
  FailDispatchBodySchema,
  HeartbeatDispatchBodySchema,
} from '@/src/api/schemas/dispatch';
import { writeMiddleware } from '@/src/api/write-controls';
import { loadOpengramConfig } from '@/src/config/opengram-config';
import {
  claimDispatchBatches,
  completeDispatchBatch,
  failDispatchBatch,
  heartbeatDispatchBatch,
} from '@/src/services/dispatch-service';

const dispatch = createRouter();

const claimRoute = createRoute({
  operationId: 'claimDispatch',
  method: 'post',
  path: '/claim',
  tags: ['Dispatch'],
  summary: 'Claim a dispatch batch',
  security: [{ bearerAuth: [] }],
  middleware: [writeMiddleware] as const,
  request: {
    body: { content: { 'application/json': { schema: ClaimDispatchSingleBodySchema } }, required: true },
  },
  responses: {
    200: { content: { 'application/json': { schema: DispatchBatchSchema } }, description: 'Batch claimed' },
    204: { description: 'No batches available' },
    ...writeErrorResponses,
  },
});

dispatch.openapi(claimRoute, async (c) => {
  const body = c.req.valid('json');
  const cfg = loadOpengramConfig().server.dispatch;
  const claimed = await claimDispatchBatches({
    workerId: body.workerId,
    leaseMs: body.leaseMs ?? cfg.leaseMs,
    waitMs: body.waitMs ?? cfg.claimWaitMs,
    limit: 1,
    signal: c.req.raw.signal,
  });
  if (!claimed.length) {
    return c.body(null, 204);
  }

  return c.json(claimed[0]);
});

const claimManyRoute = createRoute({
  operationId: 'claimManyDispatches',
  method: 'post',
  path: '/claim-many',
  tags: ['Dispatch'],
  summary: 'Claim multiple dispatch batches',
  security: [{ bearerAuth: [] }],
  middleware: [writeMiddleware] as const,
  request: {
    body: { content: { 'application/json': { schema: ClaimDispatchBodySchema } }, required: true },
  },
  responses: {
    200: { content: { 'application/json': { schema: ClaimManyResponseSchema } }, description: 'Batches claimed' },
    204: { description: 'No batches available' },
    ...writeErrorResponses,
  },
});

dispatch.openapi(claimManyRoute, async (c) => {
  const body = c.req.valid('json');
  const cfg = loadOpengramConfig().server.dispatch;

  const batches = await claimDispatchBatches({
    workerId: body.workerId,
    leaseMs: body.leaseMs ?? cfg.leaseMs,
    waitMs: body.waitMs ?? cfg.claimWaitMs,
    limit: body.limit ?? cfg.claim.claimManyLimit,
    signal: c.req.raw.signal,
  });
  if (!batches.length) {
    return c.body(null, 204);
  }

  return c.json({ batches });
});

const heartbeatRoute = createRoute({
  operationId: 'heartbeatDispatch',
  method: 'post',
  path: '/{batchId}/heartbeat',
  tags: ['Dispatch'],
  summary: 'Heartbeat a dispatch batch lease',
  security: [{ bearerAuth: [] }],
  middleware: [writeMiddleware] as const,
  request: {
    params: BatchIdParamSchema,
    body: { content: { 'application/json': { schema: HeartbeatDispatchBodySchema } }, required: true },
  },
  responses: {
    204: { description: 'Heartbeat acknowledged' },
    ...writeErrorResponses,
  },
});

dispatch.openapi(heartbeatRoute, (c) => {
  const { batchId } = c.req.valid('param');
  const body = c.req.valid('json');
  const cfg = loadOpengramConfig().server.dispatch;

  heartbeatDispatchBatch(batchId, body.workerId, body.extendMs ?? cfg.leaseMs);
  return c.body(null, 204);
});

const completeRoute = createRoute({
  operationId: 'completeDispatch',
  method: 'post',
  path: '/{batchId}/complete',
  tags: ['Dispatch'],
  summary: 'Complete a dispatch batch',
  security: [{ bearerAuth: [] }],
  middleware: [writeMiddleware] as const,
  request: {
    params: BatchIdParamSchema,
    body: { content: { 'application/json': { schema: CompleteDispatchBodySchema } }, required: true },
  },
  responses: {
    204: { description: 'Batch completed' },
    ...writeErrorResponses,
  },
});

dispatch.openapi(completeRoute, (c) => {
  const { batchId } = c.req.valid('param');
  const body = c.req.valid('json');

  completeDispatchBatch(batchId, body.workerId);
  return c.body(null, 204);
});

const failRoute = createRoute({
  operationId: 'failDispatch',
  method: 'post',
  path: '/{batchId}/fail',
  tags: ['Dispatch'],
  summary: 'Fail a dispatch batch',
  security: [{ bearerAuth: [] }],
  middleware: [writeMiddleware] as const,
  request: {
    params: BatchIdParamSchema,
    body: { content: { 'application/json': { schema: FailDispatchBodySchema } }, required: true },
  },
  responses: {
    204: { description: 'Batch failed' },
    ...writeErrorResponses,
  },
});

dispatch.openapi(failRoute, (c) => {
  const { batchId } = c.req.valid('param');
  const body = c.req.valid('json');

  failDispatchBatch(batchId, {
    workerId: body.workerId,
    reason: body.reason.trim(),
    retryable: body.retryable,
    retryDelayMs: body.retryDelayMs,
  });
  return c.body(null, 204);
});

export default dispatch;
