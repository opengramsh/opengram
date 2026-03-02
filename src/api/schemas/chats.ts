import { z } from '@hono/zod-openapi';

export const ChatSchema = z.object({
  id: z.string(),
  is_archived: z.boolean(),
  title: z.string(),
  title_source: z.enum(['default', 'auto', 'manual']),
  tags: z.array(z.string()),
  pinned: z.boolean(),
  agent_ids: z.array(z.string()),
  model_id: z.string(),
  last_message_preview: z.string().nullable(),
  last_message_role: z.string().nullable(),
  pending_requests_count: z.number(),
  last_read_at: z.string().nullable().openapi({ format: 'date-time' }),
  unread_count: z.number(),
  notifications_muted: z.boolean(),
  created_at: z.string().nullable().openapi({ format: 'date-time' }),
  updated_at: z.string().nullable().openapi({ format: 'date-time' }),
  last_message_at: z.string().nullable().openapi({ format: 'date-time' }),
}).openapi('Chat');

export const CreateChatBodySchema = z.object({
  agentIds: z.array(z.string()).min(1),
  modelId: z.string(),
  title: z.string().optional(),
  tags: z.array(z.string()).optional(),
  firstMessage: z.string().optional(),
}).openapi('CreateChatInput');

export const UpdateChatBodySchema = z.object({
  title: z.string().optional(),
  titleAutoRenamed: z.boolean().optional(),
  tags: z.array(z.string()).optional(),
  pinned: z.boolean().optional(),
  modelId: z.string().optional(),
  notificationsMuted: z.boolean().optional(),
}).openapi('UpdateChatInput');

export const PendingSummarySchema = z.object({
  pending_requests_total: z.number(),
}).openapi('PendingSummary');

export const UnreadSummarySchema = z.object({
  total_unread: z.number(),
  unread_by_agent: z.record(z.string(), z.number()),
}).openapi('UnreadSummary');

export const TypingBodySchema = z.object({
  agentId: z.string(),
}).openapi('TypingInput');

export const TagSuggestionSchema = z.object({
  name: z.string(),
  usage_count: z.number(),
}).openapi('TagSuggestion');

export const TagSuggestionListSchema = z.object({
  data: z.array(TagSuggestionSchema),
}).openapi('TagSuggestionList');

export const ChatRequestStatusSchema = z.enum(['pending', 'resolved', 'cancelled', 'all']).openapi('ChatRequestStatus');

export const ListChatsQuerySchema = z.object({
  cursor: z.string().optional().openapi({ param: { name: 'cursor', in: 'query' } }),
  limit: z.coerce.number().int().min(1).max(100).optional().openapi({ param: { name: 'limit', in: 'query' } }),
  archived: z.enum(['true', 'false']).optional().openapi({ param: { name: 'archived', in: 'query' }, description: 'Filter by archive status' }),
  tag: z.string().optional().openapi({ param: { name: 'tag', in: 'query' }, description: 'Filter by tag' }),
  agentId: z.string().optional().openapi({ param: { name: 'agentId', in: 'query' }, description: 'Filter by agent ID' }),
  query: z.string().optional().openapi({ param: { name: 'query', in: 'query' }, description: 'Filter by title substring' }),
}).openapi('ListChatsQuery');

export const SummaryFilterQuerySchema = z.object({
  archived: z.enum(['true', 'false']).optional().openapi({ param: { name: 'archived', in: 'query' }, description: 'Filter by archive status' }),
}).openapi('SummaryFilterQuery');

export const TagSuggestionsQuerySchema = z.object({
  q: z.string().optional().openapi({ param: { name: 'q', in: 'query' }, description: 'Prefix to filter tag names' }),
  limit: z.coerce.number().int().min(1).max(100).optional().openapi({ param: { name: 'limit', in: 'query' }, description: 'Max results to return (default 10)' }),
});
