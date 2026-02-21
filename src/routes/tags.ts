import { Hono } from 'hono';

import { toErrorResponse } from '@/src/api/http';
import { applyReadMiddlewares } from '@/src/api/write-controls';
import { listTagSuggestions } from '@/src/services/chats-service';

const tags = new Hono();

tags.get('/suggestions', (c) => {
  try {
    applyReadMiddlewares(c.req.raw);
    const url = new URL(c.req.url);
    const query = url.searchParams.get('q') ?? '';
    const limitParam = url.searchParams.get('limit');
    const limit = limitParam ? Number.parseInt(limitParam, 10) : 10;

    const data = listTagSuggestions(query, Number.isNaN(limit) ? 10 : limit);
    return c.json({ data });
  } catch (error) {
    return toErrorResponse(error);
  }
});

export default tags;
