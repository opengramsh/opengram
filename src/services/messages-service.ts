import type Database from 'better-sqlite3';
import { nanoid } from 'nanoid';

import { notFoundError, validationError } from '@/src/api/http';
import { encodeMessageCursor, parseMessagePagination } from '@/src/api/pagination';
import { loadOpengramConfig } from '@/src/config/opengram-config';
import { createSqliteConnection } from '@/src/db/client';
import { emitEvent } from '@/src/services/events-service';

const USER_SENDER_ID = 'user:primary';
const SYSTEM_SENDER_ID = 'system';
const TOOL_SENDER_ID = 'tool';

type MessageRole = 'user' | 'agent' | 'system' | 'tool';

type MessageRecord = {
  id: string;
  chat_id: string;
  role: MessageRole;
  sender_id: string;
  created_at: number;
  updated_at: number;
  content_final: string | null;
  content_partial: string | null;
  stream_state: 'none' | 'streaming' | 'complete' | 'cancelled';
  model_id: string | null;
  trace: string | null;
};

type ChatMessageMetadata = {
  id: string;
  model_id: string;
};

type CreateMessageInput = {
  role: MessageRole;
  senderId: string;
  content?: string;
  streaming?: boolean;
  modelId?: string;
  trace?: Record<string, unknown>;
};

type ListMessagesResult = {
  data: ReturnType<typeof serializeMessage>[];
  nextCursor: string | null;
  hasMore: boolean;
};

function toTimestamp(value: number | null) {
  return value === null ? null : new Date(value).toISOString();
}

function parseTrace(trace: string | null) {
  if (trace === null) {
    return null;
  }

  try {
    return JSON.parse(trace);
  } catch {
    throw validationError('stored trace is invalid JSON.');
  }
}

function serializeMessage(record: MessageRecord) {
  return {
    id: record.id,
    chat_id: record.chat_id,
    role: record.role,
    sender_id: record.sender_id,
    created_at: toTimestamp(record.created_at),
    updated_at: toTimestamp(record.updated_at),
    content_final: record.content_final,
    content_partial: record.content_partial,
    stream_state: record.stream_state,
    model_id: record.model_id,
    trace: parseTrace(record.trace),
  };
}

function withDb<T>(callback: (db: Database.Database) => T): T {
  const db = createSqliteConnection();
  try {
    return callback(db);
  } finally {
    db.close();
  }
}

function getChatMessageMetadata(db: Database.Database, chatId: string): ChatMessageMetadata {
  const row = db
    .prepare('SELECT id, model_id FROM chats WHERE id = ?')
    .get(chatId) as ChatMessageMetadata | undefined;

  if (!row) {
    throw notFoundError('Chat not found.', { chatId });
  }

  return row;
}

function requireRole(value: unknown): MessageRole {
  if (value !== 'user' && value !== 'agent' && value !== 'system' && value !== 'tool') {
    throw validationError('role must be one of user, agent, system, tool.', { field: 'role' });
  }

  return value;
}

function requireSenderId(value: unknown) {
  if (typeof value !== 'string' || !value) {
    throw validationError('senderId is required.', { field: 'senderId' });
  }

  return value;
}

function ensureTrace(value: unknown) {
  if (value === undefined) {
    return;
  }

  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw validationError('trace must be a JSON object.', { field: 'trace' });
  }
}

function ensureModelId(value: unknown) {
  if (value === undefined) {
    return;
  }

  if (typeof value !== 'string') {
    throw validationError('modelId must be a string.', { field: 'modelId' });
  }
}

function ensureSenderForRole(role: MessageRole, senderId: string, allowedAgentIds: Set<string>) {
  if (role === 'agent') {
    if (!allowedAgentIds.has(senderId)) {
      throw validationError('senderId must match a configured agent id for role agent.', {
        field: 'senderId',
      });
    }
    return;
  }

  if (role === 'user' && senderId !== USER_SENDER_ID) {
    throw validationError('senderId must be user:primary for role user.', { field: 'senderId' });
  }

  if (role === 'system' && senderId !== SYSTEM_SENDER_ID) {
    throw validationError('senderId must be system for role system.', { field: 'senderId' });
  }

  if (role === 'tool' && senderId !== TOOL_SENDER_ID) {
    throw validationError('senderId must be tool for role tool.', { field: 'senderId' });
  }
}

function normalizeCreateInput(input: CreateMessageInput) {
  const role = requireRole(input.role);
  const senderId = requireSenderId(input.senderId);
  const streaming = input.streaming ?? false;

  if (typeof streaming !== 'boolean') {
    throw validationError('streaming must be a boolean.', { field: 'streaming' });
  }

  ensureModelId(input.modelId);
  ensureTrace(input.trace);

  if (streaming) {
    if (role !== 'agent') {
      throw validationError('streaming start is only supported for role agent.', {
        field: 'streaming',
      });
    }

    if (input.content !== undefined) {
      throw validationError('content is not allowed when streaming=true.', { field: 'content' });
    }

    return {
      role,
      senderId,
      streaming,
      content: null,
      trace: input.trace ?? null,
    };
  }

  if (typeof input.content !== 'string') {
    throw validationError('content is required when streaming is false.', { field: 'content' });
  }

  if (!input.content.trim()) {
    throw validationError('content cannot be empty.', { field: 'content' });
  }

  return {
    role,
    senderId,
    streaming,
    content: input.content,
    trace: input.trace ?? null,
  };
}

export function createMessage(chatId: string, input: CreateMessageInput) {
  const normalized = normalizeCreateInput(input);
  const allowedAgentIds = new Set(loadOpengramConfig().agents.map((agent) => agent.id));
  ensureSenderForRole(normalized.role, normalized.senderId, allowedAgentIds);

  return withDb((db) => {
    const chat = getChatMessageMetadata(db, chatId);
    const messageId = nanoid();
    const now = Date.now();
    const streamState = normalized.streaming ? 'streaming' : 'complete';
    const contentFinal = normalized.streaming ? null : normalized.content;
    const preview = contentFinal?.trim() ? contentFinal.trim().slice(0, 180) : null;

    const tx = db.transaction(() => {
      db.prepare(
        [
          'INSERT INTO messages (',
          'id, chat_id, role, sender_id, created_at, updated_at, content_final, content_partial,',
          'stream_state, model_id, trace',
          ') VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        ].join(' '),
      ).run(
        messageId,
        chat.id,
        normalized.role,
        normalized.senderId,
        now,
        now,
        contentFinal,
        null,
        streamState,
        chat.model_id,
        normalized.trace ? JSON.stringify(normalized.trace) : null,
      );

      db.prepare(
        [
          'UPDATE chats',
          'SET last_message_preview = ?,',
          'last_message_role = ?,',
          'last_message_at = ?,',
          'unread_count = unread_count + ?,',
          'updated_at = ?',
          'WHERE id = ?',
        ].join(' '),
      ).run(
        preview,
        normalized.role,
        now,
        normalized.role === 'user' ? 0 : 1,
        now,
        chat.id,
      );
    });

    tx();

    const message = db.prepare('SELECT * FROM messages WHERE id = ?').get(messageId) as MessageRecord;
    const serialized = serializeMessage(message);
    emitEvent('message.created', {
      chatId,
      messageId: serialized.id,
      role: serialized.role,
      senderId: serialized.sender_id,
      streamState: serialized.stream_state,
    });
    return serialized;
  });
}

export function listMessages(chatId: string, url: URL): ListMessagesResult {
  const { limit, cursor } = parseMessagePagination(url.searchParams);

  return withDb((db) => {
    getChatMessageMetadata(db, chatId);

    const conditions = ['chat_id = ?'];
    const values: unknown[] = [chatId];

    if (cursor) {
      conditions.push('(created_at < ? OR (created_at = ? AND id < ?))');
      values.push(cursor.createdAt, cursor.createdAt, cursor.id);
    }

    const rows = db
      .prepare(
        [
          'SELECT * FROM messages',
          `WHERE ${conditions.join(' AND ')}`,
          'ORDER BY created_at DESC, id DESC',
          'LIMIT ?',
        ].join(' '),
      )
      .all(...values, limit + 1) as MessageRecord[];

    const hasMore = rows.length > limit;
    const slice = hasMore ? rows.slice(0, limit) : rows;
    const last = slice.at(-1);

    return {
      data: slice.map(serializeMessage),
      nextCursor: hasMore && last
        ? encodeMessageCursor({
            createdAt: last.created_at,
            id: last.id,
          })
        : null,
      hasMore,
    };
  });
}
