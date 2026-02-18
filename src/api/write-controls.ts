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
  const configuredMax = Number(process.env.OPENGRAM_WRITE_RATE_LIMIT_MAX ?? RATE_LIMIT_MAX_REQUESTS);
  const configuredWindowMs = Number(process.env.OPENGRAM_WRITE_RATE_LIMIT_WINDOW_MS ?? RATE_LIMIT_WINDOW_MS);
  const maxRequests = Number.isFinite(configuredMax) && configuredMax > 0
    ? Math.floor(configuredMax)
    : RATE_LIMIT_MAX_REQUESTS;
  const windowMs = Number.isFinite(configuredWindowMs) && configuredWindowMs > 0
    ? Math.floor(configuredWindowMs)
    : RATE_LIMIT_WINDOW_MS;

  const now = Date.now();
  const ip = getClientIp(request);
  const existing = writeRateBuckets.get(ip);

  if (!existing || now - existing.windowStartedAt >= windowMs) {
    writeRateBuckets.set(ip, {
      windowStartedAt: now,
      count: 1,
    });
    return;
  }

  if (existing.count >= maxRequests) {
    const retryAfterSeconds = Math.max(
      1,
      Math.ceil((windowMs - (now - existing.windowStartedAt)) / 1_000),
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
