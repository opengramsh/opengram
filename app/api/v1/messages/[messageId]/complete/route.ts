import { NextResponse } from 'next/server';

import { toErrorResponse, validationError } from '@/src/api/http';
import { applyWriteMiddlewares } from '@/src/api/write-controls';
import { completeStreamingMessage, ensureStreamingTimeoutSweeperStarted } from '@/src/services/messages-service';

type CompleteRequest = {
  finalText?: string;
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
    applyWriteMiddlewares(request);
    ensureStreamingTimeoutSweeperStarted();
    const messageId = await resolveMessageId(context);
    const raw = await request.text();
    let body: CompleteRequest = {};
    if (raw.trim()) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw) as unknown;
      } catch {
        throw validationError('Invalid JSON body.');
      }

      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw validationError('JSON body must be an object.');
      }

      body = parsed as CompleteRequest;
    }
    const message = completeStreamingMessage(messageId, body);
    return NextResponse.json(message);
  } catch (error) {
    return toErrorResponse(error);
  }
}
