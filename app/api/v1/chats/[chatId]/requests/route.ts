import { NextResponse } from 'next/server';

import { toErrorResponse, validationError } from '@/src/api/http';
import { listChatRequests } from '@/src/services/requests-service';

type RouteContext = {
  params: Promise<{ chatId: string }> | { chatId: string };
};

async function resolveChatId(context: RouteContext) {
  const params = await context.params;
  return params.chatId;
}

export async function GET(request: Request, context: RouteContext) {
  try {
    const chatId = await resolveChatId(context);
    const statusParam = new URL(request.url).searchParams.get('status') ?? 'pending';

    if (statusParam !== 'pending' && statusParam !== 'resolved' && statusParam !== 'cancelled' && statusParam !== 'all') {
      throw validationError('status must be one of pending, resolved, cancelled, all.', {
        field: 'status',
      });
    }

    const status = statusParam as 'pending' | 'resolved' | 'cancelled' | 'all';
    const requests = listChatRequests(chatId, status);
    return NextResponse.json({ data: requests });
  } catch (error) {
    return toErrorResponse(error);
  }
}
