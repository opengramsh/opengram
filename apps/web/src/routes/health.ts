import { createRoute } from '@hono/zod-openapi';

import pkg from '@/package.json';
import { createRouter } from '@/src/api/schemas/common';
import { HealthResponseSchema } from '@/src/api/schemas/health';

const processStartedAt = Date.now();

const health = createRouter();

const getHealthRoute = createRoute({
  operationId: 'getHealth',
  method: 'get',
  path: '/',
  tags: ['Health'],
  summary: 'Health check',
  responses: {
    200: { content: { 'application/json': { schema: HealthResponseSchema } }, description: 'Service is healthy' },
  },
});

health.openapi(getHealthRoute, (c) => {
  const uptime = Math.floor((Date.now() - processStartedAt) / 1000);
  return c.json({
    service: 'opengram' as const,
    status: 'ok' as const,
    version: pkg.version,
    uptime,
  });
});

export default health;
