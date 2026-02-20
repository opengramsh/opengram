import { NextResponse } from 'next/server';

import pkg from '@/package.json';
import { toErrorResponse } from '@/src/api/http';

const processStartedAt = Date.now();

export async function GET() {
  try {
    const uptime = Math.floor((Date.now() - processStartedAt) / 1000);
    return NextResponse.json({
      status: 'ok',
      version: pkg.version,
      uptime,
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
