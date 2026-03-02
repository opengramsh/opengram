import { OpenAPIHono, z } from '@hono/zod-openapi';
import type { Hook } from '@hono/zod-openapi';

// Standard error envelope
export const ErrorResponseSchema = z.object({
  error: z.object({
    code: z.string().openapi({ example: 'VALIDATION_ERROR' }),
    message: z.string().openapi({ example: 'Invalid request.' }),
    details: z.unknown().optional(),
  }),
}).openapi('ErrorResponse');

// Pagination cursor
export const PaginationCursorSchema = z.object({
  next: z.string().nullable(),
  hasMore: z.boolean(),
}).openapi('PaginationCursor');

// Success ok response
export const SuccessOkSchema = z.object({
  ok: z.literal(true),
}).openapi('SuccessOk');

// Reusable path params
export const ChatIdParamSchema = z.object({
  chatId: z.string().openapi({ param: { name: 'chatId', in: 'path' }, example: 'abc123' }),
});

export const MessageIdParamSchema = z.object({
  messageId: z.string().openapi({ param: { name: 'messageId', in: 'path' }, example: 'msg_123' }),
});

export const MediaIdParamSchema = z.object({
  mediaId: z.string().openapi({ param: { name: 'mediaId', in: 'path' }, example: 'med_123' }),
});

// Helper to create a paginated collection schema
export function paginatedSchema<T extends z.ZodTypeAny>(itemSchema: T, name: string) {
  return z.object({
    data: z.array(itemSchema),
    cursor: PaginationCursorSchema,
  }).openapi(name);
}

// Standard query params for paginated endpoints (max 100)
export const PaginationQuerySchema = z.object({
  cursor: z.string().optional().openapi({ param: { name: 'cursor', in: 'query' } }),
  limit: z.coerce.number().int().min(1).max(100).optional().openapi({ param: { name: 'limit', in: 'query' } }),
});

// Message-specific pagination (max 200)
export const MessagePaginationQuerySchema = z.object({
  cursor: z.string().optional().openapi({ param: { name: 'cursor', in: 'query' } }),
  limit: z.coerce.number().int().min(1).max(200).optional().openapi({ param: { name: 'limit', in: 'query' } }),
});

// Shared defaultHook for Zod validation errors — used by all routers
export const validationHook: Hook<any, any, any, any> = (result, c) => {
  if (!result.success) {
    return c.json({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Request validation failed.',
        details: result.error.flatten(),
      },
    }, 400);
  }
};

// Factory to create an OpenAPIHono router with the shared validation hook
export function createRouter() {
  return new OpenAPIHono({ defaultHook: validationHook });
}

// Optional Idempotency-Key header for write endpoints that support idempotency
export const IdempotencyKeyHeaderSchema = z.object({
  'Idempotency-Key': z.string().optional().openapi({
    param: { name: 'Idempotency-Key', in: 'header' },
    description: 'Optional idempotency key. If provided, duplicate requests with the same key and payload return the cached response instead of creating a new resource.',
    example: 'my-unique-key-123',
  }),
});

// Common error responses to reuse across routes
export const readErrorResponses = {
  400: { content: { 'application/json': { schema: ErrorResponseSchema } }, description: 'Validation error' },
  401: { content: { 'application/json': { schema: ErrorResponseSchema } }, description: 'Unauthorized' },
  404: { content: { 'application/json': { schema: ErrorResponseSchema } }, description: 'Not found' },
  500: { content: { 'application/json': { schema: ErrorResponseSchema } }, description: 'Internal server error' },
} as const;

export const writeErrorResponses = {
  ...readErrorResponses,
  409: { content: { 'application/json': { schema: ErrorResponseSchema } }, description: 'Conflict (e.g. idempotency key reuse)' },
  429: { content: { 'application/json': { schema: ErrorResponseSchema } }, description: 'Rate limited' },
} as const;

/** @deprecated Use readErrorResponses or writeErrorResponses */
export const commonErrorResponses = writeErrorResponses;
