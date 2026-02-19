import { NextResponse } from 'next/server';

import { executeWithIdempotency, getIdempotencyKey } from '@/src/api/idempotency';
import { parseJsonBody, toErrorResponse, validationError } from '@/src/api/http';
import { applyWriteMiddlewares } from '@/src/api/write-controls';
import { createRequest, listChatRequests } from '@/src/services/requests-service';

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

type CreateRequestBody = {
  type: unknown;
  title: unknown;
  body?: unknown;
  config: unknown;
  trace?: unknown;
};

export async function POST(request: Request, context: RouteContext) {
  try {
    applyWriteMiddlewares(request);
    const chatId = await resolveChatId(context);
    const body = await parseJsonBody<CreateRequestBody>(request);
    const idempotencyKey = getIdempotencyKey(request);
    return await executeWithIdempotency(idempotencyKey, { chatId, body }, 201, () => createRequest(chatId, body));
  } catch (error) {
    return toErrorResponse(error);
  }
}
