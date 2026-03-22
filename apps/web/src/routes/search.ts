import { createRoute } from '@hono/zod-openapi';

import { readErrorResponses, createRouter } from '@/src/api/schemas/common';
import { SearchQuerySchema, SearchResponseSchema } from '@/src/api/schemas/search';
import { readMiddleware } from '@/src/api/write-controls';
import { search } from '@/src/services/search-service';

const searchRouter = createRouter();

const searchRoute = createRoute({
  operationId: 'search',
  method: 'get',
  path: '/',
  tags: ['Search'],
  summary: 'Search chats and messages',
  security: [{ bearerAuth: [] }],
  middleware: [readMiddleware] as const,
  request: { query: SearchQuerySchema },
  responses: {
    200: { content: { 'application/json': { schema: SearchResponseSchema } }, description: 'Search results' },
    ...readErrorResponses,
  },
});

searchRouter.openapi(searchRoute, (c) => {
  const query = c.req.valid('query');
  const result = search(query);
  return c.json({
    chats: result.chats,
    messages: result.messages,
    cursor: {
      next: result.nextCursor,
      hasMore: result.hasMore,
    },
  });
});

export default searchRouter;
