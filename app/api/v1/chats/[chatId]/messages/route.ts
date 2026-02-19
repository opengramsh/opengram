import { NextResponse } from 'next/server';

import { parseJsonBody, successCollection, toErrorResponse } from '@/src/api/http';
import { applyWriteMiddlewares } from '@/src/api/write-controls';
import { createMessage, listMessages } from '@/src/services/messages-service';

type CreateMessageRequest = {
  role: 'user' | 'agent' | 'system' | 'tool';
  senderId: string;
  content?: string;
  streaming?: boolean;
  modelId?: string;
  trace?: Record<string, unknown>;
};

type RouteContext = {
  params: Promise<{ chatId: string }> | { chatId: string };
};

async function resolveChatId(context: RouteContext) {
  const params = await context.params;
  return params.chatId;
}

export async function POST(request: Request, context: RouteContext) {
  try {
    applyWriteMiddlewares(request);
    const chatId = await resolveChatId(context);
    const body = await parseJsonBody<CreateMessageRequest>(request);
    const message = createMessage(chatId, body);
    return NextResponse.json(message, { status: 201 });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function GET(request: Request, context: RouteContext) {
  try {
    const chatId = await resolveChatId(context);
    const result = listMessages(chatId, new URL(request.url));
    return successCollection(result.data, result.nextCursor, result.hasMore);
  } catch (error) {
    return toErrorResponse(error);
  }
}
