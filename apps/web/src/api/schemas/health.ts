import { z } from '@hono/zod-openapi';

export const HealthResponseSchema = z.object({
  service: z.literal('opengram'),
  status: z.literal('ok'),
  version: z.string(),
  uptime: z.number().openapi({ description: 'Uptime in seconds' }),
}).openapi('HealthResponse');
