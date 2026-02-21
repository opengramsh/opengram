import { Hono } from 'hono';

import { toErrorResponse } from '@/src/api/http';
import { applyReadMiddlewares } from '@/src/api/write-controls';
import { search } from '@/src/services/search-service';

const searchRouter = new Hono();

searchRouter.get('/', (c) => {
  try {
    applyReadMiddlewares(c.req.raw);
    const result = search(new URL(c.req.url));
    return c.json({
      chats: result.chats,
      messages: result.messages,
      cursor: {
        next: result.nextCursor,
        hasMore: result.hasMore,
      },
    });
  } catch (error) {
    return toErrorResponse(error);
  }
});

export default searchRouter;
