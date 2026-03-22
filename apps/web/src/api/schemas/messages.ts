import { z } from '@hono/zod-openapi';

export const MessageSchema = z.object({
  id: z.string(),
  chat_id: z.string(),
  role: z.enum(['user', 'agent', 'system', 'tool']),
  sender_id: z.string(),
  created_at: z.string().nullable().openapi({ format: 'date-time' }),
  updated_at: z.string().nullable().openapi({ format: 'date-time' }),
  content_final: z.string().nullable(),
  content_partial: z.string().nullable(),
  stream_state: z.enum(['none', 'streaming', 'complete', 'cancelled']),
  model_id: z.string().nullable(),
  trace: z.record(z.string(), z.unknown()).nullable(),
}).openapi('Message');

export const CreateMessageBodySchema = z.object({
  role: z.enum(['user', 'agent', 'system', 'tool']),
  senderId: z.string(),
  content: z.string().optional(),
  streaming: z.boolean().optional(),
  modelId: z.string().optional(),
  trace: z.record(z.string(), z.unknown()).optional(),
}).openapi('CreateMessageInput');

export const ChunkBodySchema = z.object({
  deltaText: z.string(),
}).openapi('ChunkInput');

export const CompleteBodySchema = z.object({
  finalText: z.string().optional(),
}).openapi('CompleteInput');

export const CancelStreamingResultSchema = z.object({
  cancelledMessageIds: z.array(z.string()),
}).openapi('CancelStreamingResult');
