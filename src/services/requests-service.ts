import type Database from 'better-sqlite3';

import { notFoundError, validationError } from '@/src/api/http';
import { createSqliteConnection } from '@/src/db/client';
import { emitEvent } from '@/src/services/events-service';

type RequestType = 'choice' | 'text_input' | 'form';
type RequestStatus = 'pending' | 'resolved' | 'cancelled';

type RequestRecord = {
  id: string;
  chat_id: string;
  type: RequestType;
  status: RequestStatus;
  title: string;
  body: string | null;
  config: string;
  created_at: number;
  resolved_at: number | null;
  resolved_by: string | null;
  resolution_payload: string | null;
  trace: string | null;
};

function withDb<T>(callback: (db: Database.Database) => T): T {
  const db = createSqliteConnection();
  try {
    return callback(db);
  } finally {
    db.close();
  }
}

function parseJsonObject(value: string | null): Record<string, unknown> | null {
  if (value === null) {
    return null;
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    return null;
  }

  return null;
}

function serializeRequest(record: RequestRecord) {
  return {
    id: record.id,
    chat_id: record.chat_id,
    type: record.type,
    status: record.status,
    title: record.title,
    body: record.body,
    config: parseJsonObject(record.config) ?? {},
    created_at: new Date(record.created_at).toISOString(),
    resolved_at: record.resolved_at ? new Date(record.resolved_at).toISOString() : null,
    resolved_by: record.resolved_by,
    resolution_payload: parseJsonObject(record.resolution_payload),
    trace: parseJsonObject(record.trace),
  };
}

function getRequestRecord(db: Database.Database, requestId: string) {
  const record = db.prepare('SELECT * FROM requests WHERE id = ?').get(requestId) as RequestRecord | undefined;
  if (!record) {
    throw notFoundError('Request not found.', { requestId });
  }

  return record;
}

function updateChatPendingCount(db: Database.Database, chatId: string) {
  const pendingRow = db
    .prepare('SELECT COUNT(*) as count FROM requests WHERE chat_id = ? AND status = ?')
    .get(chatId, 'pending') as { count: number };

  db.prepare('UPDATE chats SET pending_requests_count = ?, updated_at = ? WHERE id = ?').run(
    pendingRow.count,
    Date.now(),
    chatId,
  );
}

function ensureChatExists(db: Database.Database, chatId: string) {
  const chat = db.prepare('SELECT id FROM chats WHERE id = ?').get(chatId) as { id: string } | undefined;
  if (!chat) {
    throw notFoundError('Chat not found.', { chatId });
  }
}

function normalizeResolutionPayload(type: RequestType, payload: unknown, config: Record<string, unknown>) {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
    throw validationError('resolution payload must be an object.');
  }

  if (type === 'choice') {
    const selectedOptionIds = (payload as { selectedOptionIds?: unknown }).selectedOptionIds;
    if (!Array.isArray(selectedOptionIds) || selectedOptionIds.some((item) => typeof item !== 'string')) {
      throw validationError('choice resolution requires selectedOptionIds string array.', {
        field: 'selectedOptionIds',
      });
    }

    const optionIds = new Set(
      Array.isArray(config.options)
        ? config.options
            .map((option) => (option && typeof option === 'object' ? (option as { id?: unknown }).id : undefined))
            .filter((id): id is string => typeof id === 'string')
        : [],
    );

    for (const optionId of selectedOptionIds) {
      if (optionIds.size > 0 && !optionIds.has(optionId)) {
        throw validationError('selectedOptionIds contains unknown option.', { field: 'selectedOptionIds', optionId });
      }
    }

    return { selectedOptionIds };
  }

  if (type === 'text_input') {
    const text = (payload as { text?: unknown }).text;
    if (typeof text !== 'string' || !text.trim()) {
      throw validationError('text_input resolution requires non-empty text.', { field: 'text' });
    }
    return { text: text.trim() };
  }

  const values = (payload as { values?: unknown }).values;
  if (values === null || typeof values !== 'object' || Array.isArray(values)) {
    throw validationError('form resolution requires values object.', { field: 'values' });
  }

  return { values: values as Record<string, unknown> };
}

export function listChatRequests(chatId: string, status: RequestStatus | 'all' = 'pending') {
  return withDb((db) => {
    ensureChatExists(db, chatId);

    const rows = (
      status === 'all'
        ? db
            .prepare('SELECT * FROM requests WHERE chat_id = ? ORDER BY created_at ASC, id ASC')
            .all(chatId)
        : db
            .prepare('SELECT * FROM requests WHERE chat_id = ? AND status = ? ORDER BY created_at ASC, id ASC')
            .all(chatId, status)
    ) as RequestRecord[];

    return rows.map(serializeRequest);
  });
}

export function resolveRequest(requestId: string, payload: unknown) {
  return withDb((db) => {
    const current = getRequestRecord(db, requestId);
    if (current.status !== 'pending') {
      throw validationError('Only pending requests can be resolved.', { requestId, status: current.status });
    }

    const config = parseJsonObject(current.config) ?? {};
    const resolutionPayload = normalizeResolutionPayload(current.type, payload, config);
    const now = Date.now();

    db.prepare(
      [
        'UPDATE requests',
        'SET status = ?, resolved_at = ?, resolved_by = ?, resolution_payload = ?',
        'WHERE id = ?',
      ].join(' '),
    ).run('resolved', now, 'user', JSON.stringify(resolutionPayload), requestId);

    updateChatPendingCount(db, current.chat_id);

    emitEvent('request.resolved', {
      chatId: current.chat_id,
      requestId: current.id,
      type: current.type,
    });

    const updated = getRequestRecord(db, requestId);
    return serializeRequest(updated);
  });
}
