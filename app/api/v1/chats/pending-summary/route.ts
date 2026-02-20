import { NextResponse } from 'next/server';

import { toErrorResponse } from '@/src/api/http';
import { applyReadMiddlewares } from '@/src/api/write-controls';
import { getPendingSummary } from '@/src/services/chats-service';

export async function GET(request: Request) {
  try {
    applyReadMiddlewares(request);
    const result = getPendingSummary(new URL(request.url));
    return NextResponse.json({ pending_requests_total: result.pendingRequestsTotal });
  } catch (error) {
    return toErrorResponse(error);
  }
}
