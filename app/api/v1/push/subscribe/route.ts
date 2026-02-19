import { NextResponse } from 'next/server';

import { parseJsonBody, toErrorResponse } from '@/src/api/http';
import { enforceWriteGuards } from '@/src/api/write-controls';
import { deletePushSubscription, upsertPushSubscription } from '@/src/services/push-service';

type SubscribeBody = {
  endpoint: unknown;
  keys: unknown;
};

type UnsubscribeBody = {
  endpoint: unknown;
};

export async function POST(request: Request) {
  try {
    enforceWriteGuards(request);
    const body = await parseJsonBody<SubscribeBody>(request);
    const result = upsertPushSubscription(body, request.headers.get('user-agent'));
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function DELETE(request: Request) {
  try {
    enforceWriteGuards(request);
    const body = await parseJsonBody<UnsubscribeBody>(request);
    const removed = deletePushSubscription(body.endpoint);
    return NextResponse.json({ ok: true, removed });
  } catch (error) {
    return toErrorResponse(error);
  }
}
