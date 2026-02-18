import { NextResponse } from 'next/server';

import { toErrorResponse } from '@/src/api/http';
import { getPendingSummary } from '@/src/services/chats-service';

export async function GET(request: Request) {
  try {
    const result = getPendingSummary(new URL(request.url));
    return NextResponse.json({ pending_requests_total: result.pendingRequestsTotal });
  } catch (error) {
    return toErrorResponse(error);
  }
}
