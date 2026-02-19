import { NextResponse } from 'next/server';

import { toErrorResponse } from '@/src/api/http';
import { applyReadMiddlewares } from '@/src/api/write-controls';
import { search } from '@/src/services/search-service';

export async function GET(request: Request) {
  try {
    applyReadMiddlewares(request);
    const result = search(new URL(request.url));
    return NextResponse.json({
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
}
