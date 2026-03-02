import { z } from '@hono/zod-openapi';

export const EventStreamQuerySchema = z.object({
  cursor: z.string().optional().openapi({ param: { name: 'cursor', in: 'query' } }),
  ephemeral: z.enum(['true', 'false']).optional().openapi({ param: { name: 'ephemeral', in: 'query' }, description: 'Include ephemeral events (e.g. typing indicators). Defaults to true if omitted.' }),
  limit: z.coerce.number().int().min(1).max(200).optional().openapi({ param: { name: 'limit', in: 'query' } }),
}).openapi('EventStreamQuery');
