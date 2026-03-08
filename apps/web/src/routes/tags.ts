import { createRoute } from '@hono/zod-openapi';

import { TagSuggestionListSchema, TagSuggestionsQuerySchema } from '@/src/api/schemas/chats';
import { readErrorResponses, createRouter } from '@/src/api/schemas/common';
import { readMiddleware } from '@/src/api/write-controls';
import { listTagSuggestions } from '@/src/services/chats-service';

const tags = createRouter();

const listTagSuggestionsRoute = createRoute({
  operationId: 'listTagSuggestions',
  method: 'get',
  path: '/suggestions',
  tags: ['Tags'],
  summary: 'List tag suggestions',
  security: [{ bearerAuth: [] }],
  middleware: [readMiddleware] as const,
  request: { query: TagSuggestionsQuerySchema },
  responses: {
    200: {
      content: { 'application/json': { schema: TagSuggestionListSchema } },
      description: 'Tag suggestions',
    },
    ...readErrorResponses,
  },
});

tags.openapi(listTagSuggestionsRoute, (c) => {
  const { q, limit } = c.req.valid('query');
  const data = listTagSuggestions(q ?? '', limit ?? 10);
  return c.json({ data });
});

export default tags;
