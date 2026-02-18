import { NextResponse } from 'next/server';

import { parseJsonBody, toErrorResponse } from '@/src/api/http';
import { enforceWriteGuards } from '@/src/api/write-controls';
import { appendStreamingChunk, ensureStreamingTimeoutSweeperStarted } from '@/src/services/messages-service';

type ChunkRequest = {
  deltaText: string;
};

type RouteContext = {
  params: Promise<{ messageId: string }> | { messageId: string };
};

async function resolveMessageId(context: RouteContext) {
  const params = await context.params;
  return params.messageId;
}

export async function POST(request: Request, context: RouteContext) {
  try {
    enforceWriteGuards(request);
    ensureStreamingTimeoutSweeperStarted();
    const messageId = await resolveMessageId(context);
    const body = await parseJsonBody<ChunkRequest>(request);
    const message = appendStreamingChunk(messageId, body.deltaText);
    return NextResponse.json(message);
  } catch (error) {
    return toErrorResponse(error);
  }
}
