import type Database from 'better-sqlite3';
import { nanoid } from 'nanoid';

import { validationError } from '@/src/api/http';
import { getDb } from '@/src/db/client';

type EventRecord = {
  rowid: number;
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

export type PersistedEventEnvelope = EventEnvelope & {
  rowid: number;
};

type EventSubscriber = {
  includeEphemeral: boolean;
  onEvent: (event: EventEnvelope) => void;
};

type EmitEventOptions = {
  ephemeral?: boolean;
  id?: string;
  timestampMs?: number;
};

let nextSubscriberId = 1;
const subscribers = new Map<number, EventSubscriber>();

function serializeEvent(record: EventRecord): PersistedEventEnvelope {
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
    rowid: record.rowid,
    id: record.id,
    type: record.type,
    timestamp: new Date(record.created_at).toISOString(),
    payload,
  };
}

function fanOutEvent(event: EventEnvelope, ephemeral: boolean) {
  const failedSubscriberIds: number[] = [];

  for (const [subscriberId, subscriber] of subscribers.entries()) {
    if (ephemeral && !subscriber.includeEphemeral) {
      continue;
    }

    try {
      subscriber.onEvent(event);
    } catch {
      failedSubscriberIds.push(subscriberId);
    }
  }

  for (const subscriberId of failedSubscriberIds) {
    subscribers.delete(subscriberId);
  }
}

export function emitEvent(type: string, payload: Record<string, unknown>, options: EmitEventOptions = {}) {
  const now = options.timestampMs ?? Date.now();
  const id = options.id ?? nanoid();
  const ephemeral = options.ephemeral ?? false;

  if (!ephemeral) {
    const db = getDb();
    db.prepare(
      [
        'INSERT INTO events (id, type, payload, created_at)',
        'VALUES (?, ?, ?, ?)',
      ].join(' '),
    ).run(id, type, JSON.stringify(payload), now);
  }

  const envelope: EventEnvelope = {
    id,
    type,
    timestamp: new Date(now).toISOString(),
    payload,
  };

  fanOutEvent(envelope, ephemeral);
  return envelope;
}

export function subscribeToEvents(
  includeEphemeral: boolean,
  onEvent: (event: EventEnvelope) => void,
) {
  const subscriberId = nextSubscriberId;
  nextSubscriberId += 1;

  subscribers.set(subscriberId, {
    includeEphemeral,
    onEvent,
  });

  return () => {
    subscribers.delete(subscriberId);
  };
}

export function listEventsAfterCursor(cursor: string | null, limit: number) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 200) {
    throw validationError('limit must be an integer between 1 and 200.', { field: 'limit' });
  }

  const db = getDb();
  if (!cursor) {
    const rows = db
      .prepare('SELECT rowid, id, type, payload, created_at FROM events ORDER BY rowid ASC LIMIT ?')
      .all(limit) as EventRecord[];
    return rows.map((row) => {
      const event = serializeEvent(row);
      return {
        id: event.id,
        type: event.type,
        timestamp: event.timestamp,
        payload: event.payload,
      };
    });
  }

  const cursorRow = db
    .prepare('SELECT rowid FROM events WHERE id = ?')
    .get(cursor) as { rowid: number } | undefined;

  if (!cursorRow) {
    throw validationError('cursor event id was not found.', { field: 'cursor' });
  }

  const rows = db
    .prepare(
      [
        'SELECT rowid, id, type, payload, created_at FROM events',
        'WHERE rowid > ?',
        'ORDER BY rowid ASC',
        'LIMIT ?',
      ].join(' '),
    )
    .all(cursorRow.rowid, limit) as EventRecord[];

  return rows.map((row) => {
    const event = serializeEvent(row);
    return {
      id: event.id,
      type: event.type,
      timestamp: event.timestamp,
      payload: event.payload,
    };
  });
}

export function getEventRowidById(eventId: string) {
  const db = getDb();
  const row = db
    .prepare('SELECT rowid FROM events WHERE id = ?')
    .get(eventId) as { rowid: number } | undefined;

  return row?.rowid ?? null;
}

export function listEventsAfterRowid(cursorRowid: number, limit: number, maxRowid?: number) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 200) {
    throw validationError('limit must be an integer between 1 and 200.', { field: 'limit' });
  }

  const upperBoundRowid = maxRowid ?? Number.MAX_SAFE_INTEGER;

  const db = getDb();
  const rows = db
    .prepare(
      [
        'SELECT rowid, id, type, payload, created_at FROM events',
        'WHERE rowid > ? AND rowid <= ?',
        'ORDER BY rowid ASC',
        'LIMIT ?',
      ].join(' '),
    )
    .all(cursorRowid, upperBoundRowid, limit) as EventRecord[];

  return rows.map(serializeEvent);
}

export function getLatestEventRowid() {
  const db = getDb();
  const row = db
    .prepare('SELECT rowid FROM events ORDER BY rowid DESC LIMIT 1')
    .get() as { rowid: number } | undefined;
  return row?.rowid ?? 0;
}

export function getLatestEventCursor() {
  const db = getDb();
  const row = db
    .prepare('SELECT id FROM events ORDER BY rowid DESC LIMIT 1')
    .get() as { id: string } | undefined;
  return row?.id ?? null;
}

export function resetEventSubscribersForTests() {
  subscribers.clear();
  nextSubscriberId = 1;
}

export function getEventSubscriberCountForTests() {
  return subscribers.size;
}
