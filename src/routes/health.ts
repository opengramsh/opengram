import { Hono } from 'hono';

import pkg from '@/package.json';
import { toErrorResponse } from '@/src/api/http';

const processStartedAt = Date.now();

const health = new Hono();

health.get('/', (c) => {
  try {
    const uptime = Math.floor((Date.now() - processStartedAt) / 1000);
    return c.json({
      status: 'ok',
      version: pkg.version,
      uptime,
    });
  } catch (error) {
    return toErrorResponse(error);
  }
});

export default health;
