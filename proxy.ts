import type { NextRequest } from 'next/server';

import { handleApiCors } from '@/src/api/cors';

export function proxy(request: NextRequest) {
  return handleApiCors(request);
}

export const config = {
  matcher: ['/api/v1/:path*'],
};
