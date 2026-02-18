import type Database from 'better-sqlite3';
import { nanoid } from 'nanoid';

import { validationError } from '@/src/api/http';
import { createSqliteConnection } from '@/src/db/client';

type EventRecord = {
  id: string;
  type: string;
  payload: string;
  created_at: number;
};

export type EventEnvelope = {
  id: string;
  type: string;
  timestamp: string;
  payload: Record<string, unknown>;
};

function withDb<T>(callback: (db: Database.Database) => T): T {
  const db = createSqliteConnection();
  try {
    return callback(db);
  } finally {
    db.close();
  }
}

function serializeEvent(record: EventRecord): EventEnvelope {
  let payload: Record<string, unknown> = {};

  try {
    const parsed = JSON.parse(record.payload) as unknown;
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
      payload = parsed as Record<string, unknown>;
    }
  } catch {
    payload = {};
  }

  return {
    id: record.id,
    type: record.type,
    timestamp: new Date(record.created_at).toISOString(),
    payload,
  };
}

export function emitEvent(type: string, payload: Record<string, unknown>) {
  const now = Date.now();

  withDb((db) => {
    db.prepare(
      [
        'INSERT INTO events (id, type, payload, created_at)',
        'VALUES (?, ?, ?, ?)',
      ].join(' '),
    ).run(nanoid(), type, JSON.stringify(payload), now);
  });
}

export function listEventsAfterCursor(cursor: string | null, limit: number) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 200) {
    throw validationError('limit must be an integer between 1 and 200.', { field: 'limit' });
  }

  return withDb((db) => {
    if (!cursor) {
      const rows = db
        .prepare('SELECT id, type, payload, created_at FROM events ORDER BY created_at ASC, id ASC LIMIT ?')
        .all(limit) as EventRecord[];
      return rows.map(serializeEvent);
    }

    const cursorRow = db
      .prepare('SELECT created_at, id FROM events WHERE id = ?')
      .get(cursor) as { created_at: number; id: string } | undefined;

    if (!cursorRow) {
      throw validationError('cursor event id was not found.', { field: 'cursor' });
    }

    const rows = db
      .prepare(
        [
          'SELECT id, type, payload, created_at FROM events',
          'WHERE created_at > ? OR (created_at = ? AND id > ?)',
          'ORDER BY created_at ASC, id ASC',
          'LIMIT ?',
        ].join(' '),
      )
      .all(cursorRow.created_at, cursorRow.created_at, cursorRow.id, limit) as EventRecord[];

    return rows.map(serializeEvent);
  });
}
