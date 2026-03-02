import { z } from '@hono/zod-openapi';

export const RequestSchema = z.object({
  id: z.string(),
  chat_id: z.string(),
  type: z.enum(['choice', 'text_input', 'form']),
  status: z.enum(['pending', 'resolved', 'cancelled']),
  title: z.string(),
  body: z.string().nullable(),
  config: z.record(z.string(), z.unknown()),
  created_at: z.string().openapi({ format: 'date-time' }),
  resolved_at: z.string().nullable().openapi({ format: 'date-time' }),
  resolved_by: z.string().nullable(),
  resolution_payload: z.record(z.string(), z.unknown()).nullable(),
  trace: z.record(z.string(), z.unknown()).nullable(),
}).openapi('Request');

export const RequestListSchema = z.object({
  data: z.array(RequestSchema),
}).openapi('RequestList');

export const CreateRequestBodySchema = z.object({
  type: z.enum(['choice', 'text_input', 'form']),
  title: z.string(),
  body: z.string().nullable().optional(),
  config: z.record(z.string(), z.unknown()).openapi({ description: 'Type-specific configuration (e.g. choices, fields)' }),
  trace: z.record(z.string(), z.unknown()).optional(),
}).openapi('CreateRequestInput');

export const UpdateRequestBodySchema = z.object({
  title: z.string().optional(),
  body: z.string().nullable().optional(),
  config: z.record(z.string(), z.unknown()).optional(),
  trace: z.record(z.string(), z.unknown()).optional(),
}).openapi('UpdateRequestInput');

export const ResolveRequestBodySchema = z.record(z.string(), z.unknown()).openapi('ResolveRequestInput');

export const RequestIdParamSchema = z.object({
  requestId: z.string().openapi({ param: { name: 'requestId', in: 'path' }, example: 'req_123' }),
});
