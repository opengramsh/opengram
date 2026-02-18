import { NextResponse } from 'next/server';

import { parseJsonBody, successCollection, toErrorResponse } from '@/src/api/http';
import { createChat, listChats } from '@/src/services/chats-service';

type CreateChatRequest = {
  agentIds: string[];
  modelId: string;
  title?: string;
  tags?: string[];
  customState?: string;
  firstMessage?: string;
};

export async function POST(request: Request) {
  try {
    const body = await parseJsonBody<CreateChatRequest>(request);
    const chat = createChat(body);
    return NextResponse.json(chat, { status: 201 });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function GET(request: Request) {
  try {
    const result = listChats(new URL(request.url));
    return successCollection(result.data, result.nextCursor, result.hasMore);
  } catch (error) {
    return toErrorResponse(error);
  }
}
