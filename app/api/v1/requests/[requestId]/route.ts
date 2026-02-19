import { NextResponse } from 'next/server';

import { parseJsonBody, toErrorResponse } from '@/src/api/http';
import { enforceWriteGuards } from '@/src/api/write-controls';
import { updateRequest } from '@/src/services/requests-service';

type RouteContext = {
  params: Promise<{ requestId: string }> | { requestId: string };
};

type UpdateRequestBody = {
  title?: unknown;
  body?: unknown;
  config?: unknown;
  trace?: unknown;
};

async function resolveRequestId(context: RouteContext) {
  const params = await context.params;
  return params.requestId;
}

export async function PATCH(request: Request, context: RouteContext) {
  try {
    enforceWriteGuards(request);
    const requestId = await resolveRequestId(context);
    const body = await parseJsonBody<UpdateRequestBody>(request);
    const updated = updateRequest(requestId, body);
    return NextResponse.json(updated);
  } catch (error) {
    return toErrorResponse(error);
  }
}
