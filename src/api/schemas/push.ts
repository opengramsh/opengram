import { z } from '@hono/zod-openapi';

export const SubscribeBodySchema = z.object({
  endpoint: z.string().url().openapi({ description: 'Push subscription HTTPS endpoint URL' }),
  keys: z.object({
    p256dh: z.string(),
    auth: z.string(),
  }),
}).openapi('PushSubscribeInput');

export const UnsubscribeBodySchema = z.object({
  endpoint: z.string().url().openapi({ description: 'Push subscription endpoint URL to remove' }),
}).openapi('PushUnsubscribeInput');

export const TestPushBodySchema = z.object({
  title: z.string().optional(),
  body: z.string().optional(),
  chatId: z.string().optional(),
  url: z.string().optional(),
}).openapi('TestPushInput');

export const SubscribeResponseSchema = z.object({
  id: z.string(),
  endpoint: z.string(),
}).openapi('PushSubscribeResponse');

export const UnsubscribeResponseSchema = z.object({
  ok: z.literal(true),
  removed: z.boolean(),
}).openapi('PushUnsubscribeResponse');

export const TestPushResponseSchema = z.object({
  ok: z.literal(true),
  sent: z.number(),
  failed: z.number(),
  removed: z.number(),
}).openapi('TestPushResponse');
