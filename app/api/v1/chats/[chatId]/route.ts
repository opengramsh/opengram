import { NextResponse } from 'next/server';

import { parseJsonBody, toErrorResponse } from '@/src/api/http';
import { applyReadMiddlewares, applyWriteMiddlewares } from '@/src/api/write-controls';
import { getChat, updateChat } from '@/src/services/chats-service';

type UpdateChatRequest = {
  title?: string;
  tags?: string[];
  customState?: string;
  pinned?: boolean;
  modelId?: string;
};

type RouteContext = {
  params: Promise<{ chatId: string }> | { chatId: string };
};

async function resolveChatId(context: RouteContext) {
  const params = await context.params;
  return params.chatId;
}

export async function GET(request: Request, context: RouteContext) {
  try {
    applyReadMiddlewares(request);
    const chatId = await resolveChatId(context);
    const chat = getChat(chatId);
    return NextResponse.json(chat);
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  try {
    applyWriteMiddlewares(request);
    const chatId = await resolveChatId(context);
    const body = await parseJsonBody<UpdateChatRequest>(request);
    const updated = updateChat(chatId, body);
    return NextResponse.json(updated);
  } catch (error) {
    return toErrorResponse(error);
  }
}
