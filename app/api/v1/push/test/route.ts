import { NextResponse } from 'next/server';

import { parseJsonBody, toErrorResponse } from '@/src/api/http';
import { applyWriteMiddlewares } from '@/src/api/write-controls';
import { sendTestPushNotification } from '@/src/services/push-service';

type TestPushBody = {
  title?: unknown;
  body?: unknown;
  chatId?: unknown;
  url?: unknown;
};

export async function POST(request: Request) {
  try {
    applyWriteMiddlewares(request);
    const body = await parseJsonBody<TestPushBody>(request);
    const result = await sendTestPushNotification(body);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return toErrorResponse(error);
  }
}
