import { NextResponse } from 'next/server';

import { parseJsonBody, successCollection, toErrorResponse } from '@/src/api/http';
import {
  getIdempotencyKey,
  replayIdempotentResponse,
  storeIdempotentResponse,
} from '@/src/api/idempotency';
import { enforceWriteGuards } from '@/src/api/write-controls';
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
    enforceWriteGuards(request);
    const body = await parseJsonBody<CreateChatRequest>(request);
    const idempotencyKey = getIdempotencyKey(request);
    const replay = replayIdempotentResponse(idempotencyKey, body);
    if (replay) {
      return replay;
    }

    const chat = createChat(body);
    const replayFromInsert = storeIdempotentResponse(idempotencyKey, body, 201, chat);
    if (replayFromInsert) {
      return replayFromInsert;
    }

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
