import { loadOpengramConfig } from '@/src/config/opengram-config';

import { rateLimitedError, unauthorizedError } from '@/src/api/http';

const RATE_LIMIT_MAX_REQUESTS = 100;
const RATE_LIMIT_WINDOW_MS = 1_000;
const RATE_LIMIT_SWEEP_INTERVAL_MS = 10_000;
const UNKNOWN_CLIENT_IP = 'unknown';

type RateLimitBucket = {
  windowStartedAt: number;
  count: number;
};

const writeRateBuckets = new Map<string, RateLimitBucket>();
let lastSweepAt = 0;

type WriteRateLimitConfig = {
  maxRequests: number;
  windowMs: number;
};

export type WriteMiddleware = (request: Request) => void;

function normalizeIp(value: string | null): string | null {
  if (!value) {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed || trimmed.toLowerCase() === 'unknown') {
    return null;
  }

  return trimmed;
}

function parseForwardedFor(forwardedFor: string | null): string | null {
  if (!forwardedFor) {
    return null;
  }

  const first = forwardedFor.split(',')[0];
  return normalizeIp(first ?? null);
}

function getClientIp(request: Request) {
  return (
    parseForwardedFor(request.headers.get('x-forwarded-for'))
    ?? normalizeIp(request.headers.get('x-real-ip'))
    ?? normalizeIp(request.headers.get('cf-connecting-ip'))
    ?? UNKNOWN_CLIENT_IP
  );
}

function resolveRateLimitConfig(): WriteRateLimitConfig {
  const envMax = Number(process.env.OPENGRAM_WRITE_RATE_LIMIT_MAX);
  const envWindowMs = Number(process.env.OPENGRAM_WRITE_RATE_LIMIT_WINDOW_MS);
  const maxRequests = Number.isFinite(envMax) && envMax > 0 ? Math.floor(envMax) : RATE_LIMIT_MAX_REQUESTS;
  const windowMs = Number.isFinite(envWindowMs) && envWindowMs > 0 ? Math.floor(envWindowMs) : RATE_LIMIT_WINDOW_MS;
  return { maxRequests, windowMs };
}

function sweepExpiredBuckets(now: number, windowMs: number) {
  if (now - lastSweepAt < RATE_LIMIT_SWEEP_INTERVAL_MS) {
    return;
  }

  const staleAfter = now - windowMs;
  for (const [key, bucket] of writeRateBuckets.entries()) {
    if (bucket.windowStartedAt < staleAfter) {
      writeRateBuckets.delete(key);
    }
  }

  lastSweepAt = now;
}

export function requireWriteAuth(request: Request) {
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

export function enforceWriteRateLimit(request: Request) {
  const { maxRequests, windowMs } = resolveRateLimitConfig();
  const now = Date.now();
  sweepExpiredBuckets(now, windowMs);

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

export function applyWriteMiddlewares(
  request: Request,
  middlewares: WriteMiddleware[] = [requireWriteAuth, enforceWriteRateLimit],
) {
  for (const middleware of middlewares) {
    middleware(request);
  }
}

export function enforceWriteGuards(request: Request) {
  applyWriteMiddlewares(request);
}

export function resetWriteRateLimitForTests() {
  writeRateBuckets.clear();
  lastSweepAt = 0;
}
