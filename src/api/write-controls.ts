import { loadOpengramConfig } from '@/src/config/opengram-config';

import { rateLimitedError, unauthorizedError } from '@/src/api/http';

const RATE_LIMIT_MAX_REQUESTS = 100;
const RATE_LIMIT_WINDOW_MS = 1_000;

type RateLimitBucket = {
  windowStartedAt: number;
  count: number;
};

const writeRateBuckets = new Map<string, RateLimitBucket>();

function getClientIp(request: Request) {
  const forwardedFor = request.headers.get('x-forwarded-for');
  if (!forwardedFor) {
    return 'local';
  }

  return forwardedFor.split(',')[0]?.trim() || 'local';
}

function requireWriteAuth(request: Request) {
  const config = loadOpengramConfig();
  if (!config.security.instanceSecretEnabled) {
    return;
  }

  const authHeader = request.headers.get('authorization');
  const expected = `Bearer ${config.security.instanceSecret}`;
  if (authHeader !== expected) {
    throw unauthorizedError('Missing or invalid instance secret.');
  }
}

function enforceWriteRateLimit(request: Request) {
  const now = Date.now();
  const ip = getClientIp(request);
  const existing = writeRateBuckets.get(ip);

  if (!existing || now - existing.windowStartedAt >= RATE_LIMIT_WINDOW_MS) {
    writeRateBuckets.set(ip, {
      windowStartedAt: now,
      count: 1,
    });
    return;
  }

  if (existing.count >= RATE_LIMIT_MAX_REQUESTS) {
    const retryAfterSeconds = Math.max(
      1,
      Math.ceil((RATE_LIMIT_WINDOW_MS - (now - existing.windowStartedAt)) / 1_000),
    );
    throw rateLimitedError('Write rate limit exceeded.', retryAfterSeconds);
  }

  existing.count += 1;
}

export function enforceWriteGuards(request: Request) {
  requireWriteAuth(request);
  enforceWriteRateLimit(request);
}

export function resetWriteRateLimitForTests() {
  writeRateBuckets.clear();
}
