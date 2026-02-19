import { NextResponse } from 'next/server';

import { toErrorResponse } from '@/src/api/http';
import { enforceWriteGuards } from '@/src/api/write-controls';
import { cancelRequest } from '@/src/services/requests-service';

type RouteContext = {
  params: Promise<{ requestId: string }> | { requestId: string };
};

async function resolveRequestId(context: RouteContext) {
  const params = await context.params;
  return params.requestId;
}

export async function POST(request: Request, context: RouteContext) {
  try {
    enforceWriteGuards(request);
    const requestId = await resolveRequestId(context);
    const cancelled = cancelRequest(requestId);
    return NextResponse.json(cancelled);
  } catch (error) {
    return toErrorResponse(error);
  }
}
