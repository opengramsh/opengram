import { NextResponse } from 'next/server';

import { toErrorResponse } from '@/src/api/http';
import { listTagSuggestions } from '@/src/services/chats-service';

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const query = url.searchParams.get('q') ?? '';
    const limitParam = url.searchParams.get('limit');
    const limit = limitParam ? Number.parseInt(limitParam, 10) : 10;

    const data = listTagSuggestions(query, Number.isNaN(limit) ? 10 : limit);
    return NextResponse.json({ data });
  } catch (error) {
    return toErrorResponse(error);
  }
}
