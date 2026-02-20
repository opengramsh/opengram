import { Hono } from 'hono';

import { parseJsonBody, toErrorResponse } from '@/src/api/http';
import { applyWriteMiddlewares } from '@/src/api/write-controls';
import { deletePushSubscription, sendTestPushNotification, upsertPushSubscription } from '@/src/services/push-service';

const push = new Hono();

push.post('/subscribe', async (c) => {
  try {
    applyWriteMiddlewares(c.req.raw);
    const body = await parseJsonBody<{ endpoint: unknown; keys: unknown }>(c.req.raw);
    const result = upsertPushSubscription(body, c.req.raw.headers.get('user-agent'));
    return c.json(result, 201);
  } catch (error) {
    return toErrorResponse(error);
  }
});

push.delete('/subscribe', async (c) => {
  try {
    applyWriteMiddlewares(c.req.raw);
    const body = await parseJsonBody<{ endpoint: unknown }>(c.req.raw);
    const removed = deletePushSubscription(body.endpoint);
    return c.json({ ok: true, removed });
  } catch (error) {
    return toErrorResponse(error);
  }
});

push.post('/test', async (c) => {
  try {
    applyWriteMiddlewares(c.req.raw);
    const body = await parseJsonBody<Record<string, unknown>>(c.req.raw);
    const result = await sendTestPushNotification(body);
    return c.json({ ok: true, ...result });
  } catch (error) {
    return toErrorResponse(error);
  }
});

export default push;
