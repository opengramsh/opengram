import { createRoute } from '@hono/zod-openapi';

import { writeErrorResponses, createRouter } from '@/src/api/schemas/common';
import {
  SubscribeBodySchema,
  SubscribeResponseSchema,
  TestPushBodySchema,
  TestPushResponseSchema,
  UnsubscribeBodySchema,
  UnsubscribeResponseSchema,
} from '@/src/api/schemas/push';
import { writeMiddleware } from '@/src/api/write-controls';
import { repairPushSubjectFromOrigin } from '@/src/config/opengram-config';
import { deletePushSubscription, sendTestPushNotification, upsertPushSubscription } from '@/src/services/push-service';

const push = createRouter();

const subscribeRoute = createRoute({
  operationId: 'subscribePush',
  method: 'post',
  path: '/subscribe',
  tags: ['Push'],
  summary: 'Subscribe to push notifications',
  security: [{ bearerAuth: [] }],
  middleware: [writeMiddleware] as const,
  request: {
    body: { content: { 'application/json': { schema: SubscribeBodySchema } }, required: true },
  },
  responses: {
    201: { content: { 'application/json': { schema: SubscribeResponseSchema } }, description: 'Subscription created' },
    ...writeErrorResponses,
  },
});

push.openapi(subscribeRoute, (c) => {
  const body = c.req.valid('json');
  const result = upsertPushSubscription(body, c.req.raw.headers.get('user-agent'));

  const origin = c.req.raw.headers.get('origin');
  if (origin) {
    repairPushSubjectFromOrigin(origin);
  }

  return c.json(result, 201);
});

const unsubscribeRoute = createRoute({
  operationId: 'unsubscribePush',
  method: 'delete',
  path: '/subscribe',
  tags: ['Push'],
  summary: 'Unsubscribe from push notifications',
  security: [{ bearerAuth: [] }],
  middleware: [writeMiddleware] as const,
  request: {
    body: { content: { 'application/json': { schema: UnsubscribeBodySchema } }, required: true },
  },
  responses: {
    200: { content: { 'application/json': { schema: UnsubscribeResponseSchema } }, description: 'Unsubscribed' },
    ...writeErrorResponses,
  },
});

push.openapi(unsubscribeRoute, (c) => {
  const body = c.req.valid('json');
  const removed = deletePushSubscription(body.endpoint);
  return c.json({ ok: true as const, removed });
});

const testPushRoute = createRoute({
  operationId: 'testPush',
  method: 'post',
  path: '/test',
  tags: ['Push'],
  summary: 'Send a test push notification',
  security: [{ bearerAuth: [] }],
  middleware: [writeMiddleware] as const,
  request: {
    body: { content: { 'application/json': { schema: TestPushBodySchema } }, required: true },
  },
  responses: {
    200: { content: { 'application/json': { schema: TestPushResponseSchema } }, description: 'Test push sent' },
    ...writeErrorResponses,
  },
});

push.openapi(testPushRoute, async (c) => {
  const body = c.req.valid('json');
  const result = await sendTestPushNotification(body);
  return c.json({ ok: true as const, ...result });
});

export default push;
