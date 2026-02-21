import { Hono } from 'hono';

import { parseJsonBody, toErrorResponse } from '@/src/api/http';
import { applyWriteMiddlewares } from '@/src/api/write-controls';
import { cancelRequest, resolveRequest, updateRequest } from '@/src/services/requests-service';

const requests = new Hono();

requests.patch('/:requestId', async (c) => {
  try {
    applyWriteMiddlewares(c.req.raw);
    const requestId = c.req.param('requestId');
    const body = await parseJsonBody<Record<string, unknown>>(c.req.raw);
    const updated = updateRequest(requestId, body);
    return c.json(updated);
  } catch (error) {
    return toErrorResponse(error);
  }
});

requests.post('/:requestId/resolve', async (c) => {
  try {
    applyWriteMiddlewares(c.req.raw);
    const requestId = c.req.param('requestId');
    const payload = await parseJsonBody<Record<string, unknown>>(c.req.raw);
    const resolved = resolveRequest(requestId, payload);
    return c.json(resolved);
  } catch (error) {
    return toErrorResponse(error);
  }
});

requests.post('/:requestId/cancel', (c) => {
  try {
    applyWriteMiddlewares(c.req.raw);
    const requestId = c.req.param('requestId');
    const cancelled = cancelRequest(requestId);
    return c.json(cancelled);
  } catch (error) {
    return toErrorResponse(error);
  }
});

export default requests;
