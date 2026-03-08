import { z } from '@hono/zod-openapi';

const DispatchItemSchema = z.object({
  inputId: z.string(),
  sourceKind: z.enum(['user_message', 'request_resolved']),
  sourceId: z.string(),
  senderId: z.string(),
  content: z.string(),
  traceKind: z.string().optional(),
  mediaIds: z.array(z.string()),
  attachmentNames: z.array(z.string()),
});

const DispatchAttachmentSchema = z.object({
  mediaId: z.string(),
  fileName: z.string(),
  kind: z.enum(['image', 'audio', 'file']),
  sourceInputId: z.string(),
  sourceIndex: z.number(),
});

export const DispatchBatchSchema = z.object({
  batchId: z.string(),
  chatId: z.string(),
  kind: z.enum(['user_batch', 'request_batch']),
  agentIdHint: z.string().nullable(),
  compiledContent: z.string(),
  items: z.array(DispatchItemSchema),
  attachments: z.array(DispatchAttachmentSchema),
}).openapi('DispatchBatch');

export const ClaimDispatchBodySchema = z.object({
  workerId: z.string().min(1, 'workerId is required.'),
  leaseMs: z.number().int().min(0).optional(),
  waitMs: z.number().int().min(0).optional(),
  limit: z.number().int().min(1).optional(),
}).openapi('ClaimDispatchInput');

export const ClaimDispatchSingleBodySchema = z.object({
  workerId: z.string().min(1, 'workerId is required.'),
  leaseMs: z.number().int().min(0).optional(),
  waitMs: z.number().int().min(0).optional(),
}).openapi('ClaimDispatchSingleInput');

export const HeartbeatDispatchBodySchema = z.object({
  workerId: z.string().min(1, 'workerId is required.'),
  extendMs: z.number().int().min(0).optional(),
}).openapi('HeartbeatDispatchInput');

export const CompleteDispatchBodySchema = z.object({
  workerId: z.string().min(1, 'workerId is required.'),
}).openapi('CompleteDispatchInput');

export const FailDispatchBodySchema = z.object({
  workerId: z.string().min(1, 'workerId is required.'),
  reason: z.string().min(1, 'reason is required.'),
  retryable: z.boolean(),
  retryDelayMs: z.number().int().min(0).optional(),
}).openapi('FailDispatchInput');

export const BatchIdParamSchema = z.object({
  batchId: z.string().openapi({ param: { name: 'batchId', in: 'path' }, example: 'batch_123' }),
});

export const ClaimManyResponseSchema = z.object({
  batches: z.array(DispatchBatchSchema),
}).openapi('ClaimManyResponse');
