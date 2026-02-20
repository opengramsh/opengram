import { createHash } from 'node:crypto';

import { NextResponse } from 'next/server';

import { conflictError, validationError } from '@/src/api/http';
import { loadOpengramConfig } from '@/src/config/opengram-config';
import { createSqliteConnection } from '@/src/db/client';

const DEFAULT_IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1_000;
const IDEMPOTENCY_IN_PROGRESS_STATUS_CODE = 0;
const IDEMPOTENCY_POLL_INTERVAL_MS = 25;
const IDEMPOTENCY_POLL_TIMEOUT_MS = 2_000;

type IdempotencyRow = {
  response: string;
  status_code: number;
};

type StoredIdempotencyResponse = {
  requestHash: string;
  responseBody: unknown;
};

type InProgressIdempotencyResponse = {
  requestHash: string;
};

type ParsedStoredResponse =
  | { state: 'completed'; payload: StoredIdempotencyResponse | { requestHash: null; responseBody: unknown } }
  | { state: 'in_progress'; payload: InProgressIdempotencyResponse };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

function getIdempotencyTtlMs() {
  const config = loadOpengramConfig();
  const ttlMs = config.server.idempotencyTtlSeconds * 1_000;
  return Number.isFinite(ttlMs) && ttlMs > 0 ? ttlMs : DEFAULT_IDEMPOTENCY_TTL_MS;
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
): ParsedStoredResponse {
  const parsed = JSON.parse(stored) as unknown;
  if (
    isRecord(parsed)
    && parsed.state === 'in_progress'
    && typeof parsed.requestHash === 'string'
  ) {
    return {
      state: 'in_progress',
      payload: {
        requestHash: parsed.requestHash,
      },
    };
  }

  if (
    isRecord(parsed)
    && parsed.state === 'completed'
    && typeof parsed.requestHash === 'string'
    && Object.hasOwn(parsed, 'responseBody')
  ) {
    return {
      state: 'completed',
      payload: {
        requestHash: parsed.requestHash,
        responseBody: parsed.responseBody,
      },
    };
  }

  return {
    state: 'completed',
    payload: {
      requestHash: null,
      responseBody: parsed,
    },
  };
}

function assertCompatibleIdempotencyPayload(
  key: string,
  expectedRequestHash: string,
  parsedStoredResponse: ParsedStoredResponse,
) {
  const requestHash = parsedStoredResponse.payload.requestHash;
  if (requestHash !== null && requestHash !== expectedRequestHash) {
    throw conflictError('Idempotency-Key already used with a different request payload.', {
      field: 'Idempotency-Key',
      key,
    });
  }

  if (parsedStoredResponse.state === 'in_progress') {
    return null;
  }

  return parsedStoredResponse.payload.responseBody;
}

function loadIdempotencyRow(key: string): IdempotencyRow | undefined {
  const db = createSqliteConnection();

  try {
    return db
      .prepare('SELECT response, status_code FROM idempotency_keys WHERE key = ?')
      .get(key) as IdempotencyRow | undefined;
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

  const requestHash = requestHashFromBody(requestBody);
  const row = loadIdempotencyRow(key);
  if (!row) {
    return null;
  }

  const parsedStoredResponse = parseStoredResponse(row.response);
  const replayBody = assertCompatibleIdempotencyPayload(key, requestHash, parsedStoredResponse);
  if (parsedStoredResponse.state === 'in_progress') {
    return null;
  }

  return NextResponse.json(replayBody, { status: row.status_code });
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

  const ttlMs = getIdempotencyTtlMs();
  const requestHash = requestHashFromBody(requestBody);
  const db = createSqliteConnection();

  try {
    db.prepare('DELETE FROM idempotency_keys WHERE created_at < ?').run(Date.now() - ttlMs);

    const serialized = JSON.stringify({
      state: 'completed',
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

      const parsedStoredResponse = parseStoredResponse(row.response);
      const replayBody = assertCompatibleIdempotencyPayload(key, requestHash, parsedStoredResponse);
      if (parsedStoredResponse.state === 'in_progress') {
        return null;
      }

      return NextResponse.json(replayBody, { status: row.status_code });
    }
  } finally {
    db.close();
  }
}

function reserveIdempotencyKey(
  key: string,
  requestHash: string,
): 'reserved' | { replay: NextResponse<unknown> } | 'wait' {
  const ttlMs = getIdempotencyTtlMs();
  const now = Date.now();
  const db = createSqliteConnection();

  try {
    db.prepare('DELETE FROM idempotency_keys WHERE created_at < ?').run(now - ttlMs);

    const reservationPayload = JSON.stringify({
      state: 'in_progress',
      requestHash,
    });

    try {
      db.prepare(
        'INSERT INTO idempotency_keys (key, response, status_code, created_at) VALUES (?, ?, ?, ?)',
      ).run(key, reservationPayload, IDEMPOTENCY_IN_PROGRESS_STATUS_CODE, now);
      return 'reserved';
    } catch (error) {
      if (!isUniqueConstraintError(error)) {
        throw error;
      }

      const existing = db
        .prepare('SELECT response, status_code FROM idempotency_keys WHERE key = ?')
        .get(key) as IdempotencyRow | undefined;

      if (!existing) {
        return 'wait';
      }

      const parsedStoredResponse = parseStoredResponse(existing.response);
      const replayBody = assertCompatibleIdempotencyPayload(key, requestHash, parsedStoredResponse);
      if (parsedStoredResponse.state === 'in_progress') {
        return 'wait';
      }

      return {
        replay: NextResponse.json(replayBody, { status: existing.status_code }),
      };
    }
  } finally {
    db.close();
  }
}

function commitIdempotencyResponse(
  key: string,
  requestHash: string,
  statusCode: number,
  responseBody: unknown,
) {
  const db = createSqliteConnection();

  try {
    const serialized = JSON.stringify({
      state: 'completed',
      requestHash,
      responseBody,
    });

    db.prepare('UPDATE idempotency_keys SET response = ?, status_code = ?, created_at = ? WHERE key = ?')
      .run(serialized, statusCode, Date.now(), key);
  } finally {
    db.close();
  }
}

function rollbackIdempotencyReservation(key: string) {
  const db = createSqliteConnection();

  try {
    db.prepare('DELETE FROM idempotency_keys WHERE key = ? AND status_code = ?')
      .run(key, IDEMPOTENCY_IN_PROGRESS_STATUS_CODE);
  } finally {
    db.close();
  }
}

export async function executeWithIdempotency<T>(
  key: string | null,
  requestBody: unknown,
  successStatusCode: number,
  execute: () => T | Promise<T>,
) {
  if (!key) {
    const responseBody = await execute();
    return NextResponse.json(responseBody, { status: successStatusCode });
  }

  const requestHash = requestHashFromBody(requestBody);
  const timeoutAt = Date.now() + IDEMPOTENCY_POLL_TIMEOUT_MS;

  while (Date.now() < timeoutAt) {
    const reservationResult = reserveIdempotencyKey(key, requestHash);
    if (reservationResult === 'reserved') {
      try {
        const responseBody = await execute();
        commitIdempotencyResponse(key, requestHash, successStatusCode, responseBody);
        return NextResponse.json(responseBody, { status: successStatusCode });
      } catch (error) {
        rollbackIdempotencyReservation(key);
        throw error;
      }
    }

    if (reservationResult !== 'wait') {
      return reservationResult.replay;
    }

    await sleep(IDEMPOTENCY_POLL_INTERVAL_MS);
  }

  throw conflictError('Idempotency request is already in progress. Retry shortly.', {
    field: 'Idempotency-Key',
    key,
  });
}
