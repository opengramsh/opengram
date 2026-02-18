import { createHash } from 'node:crypto';

import { NextResponse } from 'next/server';

import { conflictError, validationError } from '@/src/api/http';
import { createSqliteConnection } from '@/src/db/client';

const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1_000;

type IdempotencyRow = {
  response: string;
  status_code: number;
};

type StoredIdempotencyResponse = {
  requestHash: string;
  responseBody: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function canonicalizeJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalizeJson(item)).join(',')}]`;
  }

  const objectValue = value as Record<string, unknown>;
  const keys = Object.keys(objectValue).sort();
  const entries = keys.map((key) => `${JSON.stringify(key)}:${canonicalizeJson(objectValue[key])}`);
  return `{${entries.join(',')}}`;
}

function requestHashFromBody(requestBody: unknown) {
  return createHash('sha256').update(canonicalizeJson(requestBody)).digest('hex');
}

function parseStoredResponse(
  stored: string,
): StoredIdempotencyResponse | { requestHash: null; responseBody: unknown } {
  const parsed = JSON.parse(stored) as unknown;
  if (
    isRecord(parsed)
    && typeof parsed.requestHash === 'string'
    && Object.hasOwn(parsed, 'responseBody')
  ) {
    return {
      requestHash: parsed.requestHash,
      responseBody: parsed.responseBody,
    };
  }

  return {
    requestHash: null,
    responseBody: parsed,
  };
}

function assertCompatibleIdempotencyPayload(
  key: string,
  expectedRequestHash: string,
  storedResponse: string,
) {
  const parsed = parseStoredResponse(storedResponse);
  if (parsed.requestHash !== null && parsed.requestHash !== expectedRequestHash) {
    throw conflictError('Idempotency-Key already used with a different request payload.', {
      field: 'Idempotency-Key',
      key,
    });
  }

  return parsed.responseBody;
}

function loadIdempotentReplay(
  key: string,
  expectedRequestHash: string,
): NextResponse<unknown> | null {
  const db = createSqliteConnection();

  try {
    db.prepare('DELETE FROM idempotency_keys WHERE created_at < ?').run(Date.now() - IDEMPOTENCY_TTL_MS);

    const row = db
      .prepare('SELECT response, status_code FROM idempotency_keys WHERE key = ?')
      .get(key) as IdempotencyRow | undefined;
    if (!row) {
      return null;
    }

    const responseBody = assertCompatibleIdempotencyPayload(key, expectedRequestHash, row.response);
    return NextResponse.json(responseBody, { status: row.status_code });
  } finally {
    db.close();
  }
}

function isUniqueConstraintError(error: unknown) {
  return error instanceof Error && error.message.includes('UNIQUE constraint failed: idempotency_keys.key');
}

export function getIdempotencyKey(request: Request): string | null {
  const raw = request.headers.get('idempotency-key');
  if (raw === null) {
    return null;
  }

  const key = raw.trim();
  if (!key) {
    throw validationError('Idempotency-Key cannot be empty.', { field: 'Idempotency-Key' });
  }

  return key;
}

export function replayIdempotentResponse(
  key: string | null,
  requestBody: unknown,
): NextResponse<unknown> | null {
  if (!key) {
    return null;
  }

  return loadIdempotentReplay(key, requestHashFromBody(requestBody));
}

export function storeIdempotentResponse(
  key: string | null,
  requestBody: unknown,
  statusCode: number,
  responseBody: unknown,
): NextResponse<unknown> | null {
  if (!key) {
    return null;
  }

  const requestHash = requestHashFromBody(requestBody);
  const db = createSqliteConnection();

  try {
    db.prepare('DELETE FROM idempotency_keys WHERE created_at < ?').run(Date.now() - IDEMPOTENCY_TTL_MS);

    const serialized = JSON.stringify({
      requestHash,
      responseBody,
    });

    try {
      db.prepare(
        'INSERT INTO idempotency_keys (key, response, status_code, created_at) VALUES (?, ?, ?, ?)',
      ).run(key, serialized, statusCode, Date.now());
      return null;
    } catch (error) {
      if (!isUniqueConstraintError(error)) {
        throw error;
      }

      const row = db
        .prepare('SELECT response, status_code FROM idempotency_keys WHERE key = ?')
        .get(key) as IdempotencyRow | undefined;

      if (!row) {
        throw error;
      }

      const replayBody = assertCompatibleIdempotencyPayload(key, requestHash, row.response);
      return NextResponse.json(replayBody, { status: row.status_code });
    }
  } finally {
    db.close();
  }
}
