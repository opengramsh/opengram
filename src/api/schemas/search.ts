import { z } from '@hono/zod-openapi';

const SearchChatResultSchema = z.object({
  id: z.string(),
  title: z.string(),
  snippet: z.string(),
  agent_ids: z.array(z.string()),
});

const SearchMessageResultSchema = z.object({
  id: z.string(),
  chat_id: z.string(),
  chat_title: z.string(),
  snippet: z.string(),
  agent_ids: z.array(z.string()),
});

export const SearchResponseSchema = z.object({
  chats: z.array(SearchChatResultSchema),
  messages: z.array(SearchMessageResultSchema),
  cursor: z.object({
    next: z.string().nullable(),
    hasMore: z.boolean(),
  }),
}).openapi('SearchResponse');

export const SearchQuerySchema = z.object({
  q: z.string().trim().min(1).openapi({ param: { name: 'q', in: 'query' } }),
  scope: z.enum(['all', 'titles', 'messages']).optional().openapi({ param: { name: 'scope', in: 'query' }, description: 'Search scope (default: titles)' }),
  cursor: z.string().optional().openapi({ param: { name: 'cursor', in: 'query' } }),
  limit: z.coerce.number().int().min(1).max(100).optional().openapi({ param: { name: 'limit', in: 'query' } }),
}).openapi('SearchQuery');
