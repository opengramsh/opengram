import type Database from 'better-sqlite3';
import { nanoid } from 'nanoid';

import { conflictError, notFoundError, validationError } from '@/src/api/http';
import { encodeMessageCursor, parseMessagePagination } from '@/src/api/pagination';
import { loadOpengramConfig } from '@/src/config/opengram-config';
import { getDb } from '@/src/db/client';
import { emitEvent } from '@/src/services/events-service';
import { notifyAgentMessageCreated } from '@/src/services/push-service';

const USER_SENDER_ID = 'user:primary';
const SYSTEM_SENDER_ID = 'system';
const TOOL_SENDER_ID = 'tool';

type MessageRole = 'user' | 'agent' | 'system' | 'tool';
type MediaKind = 'image' | 'audio' | 'file';

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

type StreamState = MessageRecord['stream_state'];

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

type MediaReference = {
  mediaId: string;
  declaredKind?: MediaKind;
};

type MediaRecord = {
  id: string;
  chat_id: string;
  message_id: string | null;
  kind: MediaKind;
};

type ListMessagesResult = {
  data: ReturnType<typeof serializeMessage>[];
  nextCursor: string | null;
  hasMore: boolean;
};

type SweepResult = {
  cancelledMessageIds: string[];
};

const STREAM_SWEEPER_INTERVAL_MS = 30_000;
const STREAM_SWEEPER_GLOBAL_KEY = '__opengramStreamSweeperInterval';

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

function getMessageMetadata(db: Database.Database, messageId: string): MessageRecord {
  const row = db.prepare('SELECT * FROM messages WHERE id = ?').get(messageId) as MessageRecord | undefined;

  if (!row) {
    throw notFoundError('Message not found.', { messageId });
  }

  return row;
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

function throwStreamingStateConflict(db: Database.Database, messageId: string): never {
  const row = db
    .prepare('SELECT id, stream_state FROM messages WHERE id = ?')
    .get(messageId) as Pick<MessageRecord, 'id' | 'stream_state'> | undefined;

  if (!row) {
    throw notFoundError('Message not found.', { messageId });
  }

  throw conflictError('Message is not in streaming state.', {
    messageId: row.id,
    streamState: row.stream_state,
  });
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

function extractMediaReferences(trace: Record<string, unknown> | null): MediaReference[] {
  if (!trace) {
    return [];
  }

  // New array format: trace.mediaIds
  if (trace.mediaIds !== undefined) {
    if (!Array.isArray(trace.mediaIds)) {
      throw validationError('trace.mediaIds must be an array when provided.', { field: 'trace.mediaIds' });
    }

    return trace.mediaIds.map((id, index) => {
      if (typeof id !== 'string' || !id.trim()) {
        throw validationError(`trace.mediaIds[${index}] must be a non-empty string.`, { field: 'trace.mediaIds' });
      }

      return { mediaId: id };
    });
  }

  // Legacy single-ID format: trace.mediaId
  if (trace.mediaId !== undefined) {
    if (typeof trace.mediaId !== 'string' || !trace.mediaId.trim()) {
      throw validationError('trace.mediaId must be a non-empty string when provided.', { field: 'trace.mediaId' });
    }

    const declaredKind = trace.kind;
    if (declaredKind !== undefined && declaredKind !== 'image' && declaredKind !== 'audio' && declaredKind !== 'file') {
      throw validationError('trace.kind must be image, audio, or file when provided.', { field: 'trace.kind' });
    }

    return [{ mediaId: trace.mediaId, declaredKind: declaredKind as MediaKind | undefined }];
  }

  return [];
}

function derivePreview(content: string | null, mediaKind: MediaKind | null) {
  const previewRaw = content?.trim() ?? '';
  if (previewRaw) {
    return previewRaw.slice(0, 180);
  }

  if (mediaKind === 'audio') {
    return 'Voice note';
  }

  if (mediaKind) {
    return 'Attachment';
  }

  return null;
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
  const mediaReferences = extractMediaReferences(input.trace ?? null);

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
      mediaReferences: [],
    };
  }

  if (input.content !== undefined && typeof input.content !== 'string') {
    throw validationError('content must be a string.', { field: 'content' });
  }

  const trimmedContent = input.content?.trim() ?? null;
  if (!trimmedContent && mediaReferences.length === 0) {
    throw validationError('content is required when streaming is false unless trace.mediaId or trace.mediaIds is provided.', {
      field: 'content',
    });
  }

  return {
    role,
    senderId,
    streaming,
    content: trimmedContent,
    trace: input.trace ?? null,
    mediaReferences,
  };
}

export function createMessage(chatId: string, input: CreateMessageInput) {
  const normalized = normalizeCreateInput(input);
  const allowedAgentIds = new Set(loadOpengramConfig().agents.map((agent) => agent.id));
  ensureSenderForRole(normalized.role, normalized.senderId, allowedAgentIds);

  const db = getDb();
  const chat = getChatMessageMetadata(db, chatId);
  const messageId = nanoid();
  const now = Date.now();
  const streamState = normalized.streaming ? 'streaming' : 'complete';
  const contentFinal = normalized.streaming ? null : normalized.content;

  const tx = db.transaction((): MediaRecord[] => {
    const linkedMediaList: MediaRecord[] = [];

    for (const ref of normalized.mediaReferences) {
      const linkedMedia = (db
        .prepare('SELECT id, chat_id, message_id, kind FROM media WHERE id = ? AND chat_id = ?')
        .get(ref.mediaId, chat.id) as MediaRecord | undefined) ?? null;

      if (!linkedMedia) {
        throw validationError('A media ID in trace does not belong to this chat.', {
          field: 'trace.mediaIds',
        });
      }

      if (linkedMedia.message_id && linkedMedia.message_id !== messageId) {
        throw validationError('A media ID in trace is already linked to another message.', {
          field: 'trace.mediaIds',
        });
      }

      if (ref.declaredKind && ref.declaredKind !== linkedMedia.kind) {
        throw validationError('trace.kind does not match linked media kind.', {
          field: 'trace.kind',
        });
      }

      linkedMediaList.push(linkedMedia);
    }

    const preview = derivePreview(contentFinal, linkedMediaList[0]?.kind ?? null);

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

    for (const linkedMedia of linkedMediaList) {
      db.prepare('UPDATE media SET message_id = ? WHERE id = ?').run(messageId, linkedMedia.id);
    }

    if (preview !== null) {
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
    } else {
      db.prepare(
        [
          'UPDATE chats',
          'SET last_message_at = ?,',
          'unread_count = unread_count + ?,',
          'updated_at = ?',
          'WHERE id = ?',
        ].join(' '),
      ).run(
        now,
        normalized.role === 'user' ? 0 : 1,
        now,
        chat.id,
      );
    }

    return linkedMediaList;
  });

  const linkedMediaList = tx();

  const message = db.prepare('SELECT * FROM messages WHERE id = ?').get(messageId) as MessageRecord;
  const serialized = serializeMessage(message);

  for (const linkedMedia of linkedMediaList) {
    emitEvent('media.attached', {
      chatId,
      mediaId: linkedMedia.id,
      messageId,
      kind: linkedMedia.kind,
    });
  }

  emitEvent('message.created', {
    chatId,
    messageId: serialized.id,
    role: serialized.role,
    senderId: serialized.sender_id,
    streamState: serialized.stream_state,
    contentFinal: serialized.content_final,
    createdAt: serialized.created_at,
    trace: serialized.trace,
  });

  if (serialized.role === 'agent' && serialized.stream_state !== 'streaming') {
    void notifyAgentMessageCreated({
      chatId: serialized.chat_id,
      messageId: serialized.id,
      senderId: serialized.sender_id,
      preview: serialized.content_final,
    }).catch((error) => {
      console.error('Failed to send message.created push notification.', error);
    });
  }

  if (normalized.streaming) {
    ensureStreamingTimeoutSweeperStarted();
  }

  return serialized;
}

export function listMessages(chatId: string, url: URL): ListMessagesResult {
  const { limit, cursor } = parseMessagePagination(url.searchParams);

  const db = getDb();
  getChatMessageMetadata(db, chatId);

  const conditions = ['chat_id = ?'];
  const values: unknown[] = [chatId];

  // Exclude cancelled messages with no content and no linked media (KAI-216)
  conditions.push(
    "NOT (stream_state = 'cancelled' AND content_final IS NULL AND content_partial IS NULL AND NOT EXISTS (SELECT 1 FROM media WHERE media.message_id = messages.id))",
  );

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
}

function requireDeltaText(value: unknown) {
  if (typeof value !== 'string' || value.length === 0) {
    throw validationError('deltaText must be a non-empty string.', { field: 'deltaText' });
  }

  return value;
}

function requireOptionalFinalText(value: unknown) {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== 'string') {
    throw validationError('finalText must be a string.', { field: 'finalText' });
  }

  return value;
}

export function appendStreamingChunk(messageId: string, deltaText: unknown) {
  const normalizedDeltaText = requireDeltaText(deltaText);

  const db = getDb();
  const now = Date.now();
  const tx = db.transaction(() => {
    const message = getMessageMetadata(db, messageId);
    const updatedChunk = db.prepare(
      [
        'UPDATE messages',
        "SET content_partial = COALESCE(content_partial, '') || ?, updated_at = ?",
        'WHERE id = ? AND stream_state = ?',
      ].join(' '),
    ).run(normalizedDeltaText, now, messageId, 'streaming');

    if (updatedChunk.changes === 0) {
      throwStreamingStateConflict(db, messageId);
    }

    db.prepare(
      'UPDATE chats SET updated_at = ? WHERE id = ?',
    ).run(now, message.chat_id);

    const updated = getMessageMetadata(db, messageId);
    return { updated, deltaText: normalizedDeltaText };
  });

  const { updated, deltaText: emittedDeltaText } = tx();
  const serialized = serializeMessage(updated);
  emitEvent(
    'message.streaming.chunk',
    {
      chatId: serialized.chat_id,
      messageId: serialized.id,
      deltaText: emittedDeltaText,
    },
    { ephemeral: true, timestampMs: now },
  );
  return serialized;
}

type CompleteStreamingInput = {
  finalText?: unknown;
};

function completeOrCancelStreamingMessage(
  messageId: string,
  targetState: Extract<StreamState, 'complete' | 'cancelled'>,
  input?: CompleteStreamingInput,
) {
  const normalizedFinalText = requireOptionalFinalText(input?.finalText);

  const db = getDb();
  const now = Date.now();
  const tx = db.transaction(() => {
    if (targetState === 'complete') {
      const result = normalizedFinalText === undefined
        ? db.prepare(
          [
            'UPDATE messages',
            "SET content_final = COALESCE(content_partial, ''), content_partial = NULL,",
            'stream_state = ?, updated_at = ?',
            'WHERE id = ? AND stream_state = ?',
          ].join(' '),
        ).run('complete', now, messageId, 'streaming')
        : db.prepare(
          [
            'UPDATE messages',
            'SET content_final = ?, content_partial = NULL, stream_state = ?, updated_at = ?',
            'WHERE id = ? AND stream_state = ?',
          ].join(' '),
        ).run(normalizedFinalText, 'complete', now, messageId, 'streaming');

      if (result.changes === 0) {
        throwStreamingStateConflict(db, messageId);
      }

      const message = getMessageMetadata(db, messageId);
      const preview = message.content_final?.trim() ? message.content_final.trim().slice(0, 180) : null;

      db.prepare(
        [
          'UPDATE chats',
          'SET last_message_preview = ?,',
          'last_message_role = ?,',
          'last_message_at = ?,',
          'updated_at = ?',
          'WHERE id = ?',
        ].join(' '),
      ).run(preview, message.role, now, now, message.chat_id);
    } else {
      const result = db.prepare(
        [
          'UPDATE messages',
          'SET stream_state = ?, updated_at = ?',
          'WHERE id = ? AND stream_state = ?',
        ].join(' '),
      ).run('cancelled', now, messageId, 'streaming');

      if (result.changes === 0) {
        throwStreamingStateConflict(db, messageId);
      }

      const message = getMessageMetadata(db, messageId);
      db.prepare('UPDATE chats SET updated_at = ? WHERE id = ?').run(now, message.chat_id);
    }

    return getMessageMetadata(db, messageId);
  });

  const updated = tx();
  const serialized = serializeMessage(updated);
  emitEvent('message.streaming.complete', {
    chatId: serialized.chat_id,
    messageId: serialized.id,
    streamState: serialized.stream_state,
    finalText: serialized.content_final,
  }, { timestampMs: now });

  if (targetState === 'complete') {
    const preview = serialized.content_final?.trim()
      ? serialized.content_final.trim().slice(0, 180)
      : null;
    void notifyAgentMessageCreated({
      chatId: serialized.chat_id,
      messageId: serialized.id,
      senderId: serialized.sender_id,
      preview,
    }).catch((error) => {
      console.error('Failed to send message.created push notification.', error);
    });
  }

  return serialized;
}

export function completeStreamingMessage(messageId: string, input: CompleteStreamingInput = {}) {
  return completeOrCancelStreamingMessage(messageId, 'complete', input);
}

export function cancelStreamingMessage(messageId: string) {
  return completeOrCancelStreamingMessage(messageId, 'cancelled');
}

/**
 * Bulk-cancel all streaming messages for a given chat.
 * Used as a safety net when a new inbound message supersedes an in-progress
 * agent response — ensures no orphaned typing bubbles remain.
 *
 * @returns The IDs of messages that were cancelled.
 */
export function cancelStreamingMessagesForChat(chatId: string): { cancelledMessageIds: string[] } {
  const db = getDb();
  getChatMessageMetadata(db, chatId); // Validates chat exists

  const now = Date.now();
  const streamingMessages = db
    .prepare("SELECT id FROM messages WHERE chat_id = ? AND stream_state = 'streaming'")
    .all(chatId) as { id: string }[];

  if (streamingMessages.length === 0) {
    return { cancelledMessageIds: [] };
  }

  const cancelled: MessageRecord[] = [];
  const tx = db.transaction(() => {
    for (const msg of streamingMessages) {
      const result = db.prepare(
        "UPDATE messages SET stream_state = 'cancelled', updated_at = ? WHERE id = ? AND stream_state = 'streaming'",
      ).run(now, msg.id);
      if (result.changes > 0) {
        const updated = getMessageMetadata(db, msg.id);
        db.prepare('UPDATE chats SET updated_at = ? WHERE id = ?').run(now, updated.chat_id);
        cancelled.push(updated);
      }
    }
  });
  tx();

  for (const message of cancelled) {
    const serialized = serializeMessage(message);
    emitEvent('message.streaming.complete', {
      chatId: serialized.chat_id,
      messageId: serialized.id,
      streamState: serialized.stream_state,
      finalText: serialized.content_final,
    }, { timestampMs: now });
  }

  return { cancelledMessageIds: cancelled.map((m) => m.id) };
}

function autoCancelStreamingMessageIfStale(
  db: Database.Database,
  messageId: string,
  now: number,
) {
  const updated = db.prepare(
    [
      'UPDATE messages',
      'SET stream_state = ?, updated_at = ?',
      'WHERE id = ? AND stream_state = ?',
    ].join(' '),
  ).run('cancelled', now, messageId, 'streaming');

  if (updated.changes === 0) {
    return null;
  }

  const message = getMessageMetadata(db, messageId);
  db.prepare('UPDATE chats SET updated_at = ? WHERE id = ?').run(now, message.chat_id);
  return message;
}

export function sweepStaleStreamingMessages(nowMs = Date.now()): SweepResult {
  const timeoutMs = loadOpengramConfig().server.streamTimeoutSeconds * 1_000;
  const staleBefore = nowMs - timeoutMs;

  const db = getDb();
  const staleIds = db
    .prepare(
      [
        'SELECT id FROM messages',
        'WHERE stream_state = ? AND updated_at < ?',
      ].join(' '),
    )
    .all('streaming', staleBefore) as { id: string }[];

  const cancelled: MessageRecord[] = [];
  const tx = db.transaction(() => {
    for (const stale of staleIds) {
      const updated = autoCancelStreamingMessageIfStale(db, stale.id, nowMs);
      if (updated) {
        cancelled.push(updated);
      }
    }
  });
  tx();

  for (const message of cancelled) {
    const serialized = serializeMessage(message);
    emitEvent('message.streaming.complete', {
      chatId: serialized.chat_id,
      messageId: serialized.id,
      streamState: serialized.stream_state,
      finalText: serialized.content_final,
    }, { timestampMs: nowMs });
  }

  return { cancelledMessageIds: cancelled.map((message) => message.id) };
}

export function ensureStreamingTimeoutSweeperStarted() {
  if (process.env.NODE_ENV === 'test') {
    return false;
  }

  const scopedGlobal = globalThis as typeof globalThis & {
    [STREAM_SWEEPER_GLOBAL_KEY]?: ReturnType<typeof setInterval>;
  };
  if (scopedGlobal[STREAM_SWEEPER_GLOBAL_KEY]) {
    return false;
  }

  const interval = setInterval(() => {
    try {
      sweepStaleStreamingMessages();
    } catch {
      // Keep the interval alive even if one sweep iteration fails.
    }
  }, STREAM_SWEEPER_INTERVAL_MS);

  if (typeof interval.unref === 'function') {
    interval.unref();
  }

  scopedGlobal[STREAM_SWEEPER_GLOBAL_KEY] = interval;
  return true;
}

export function resetStreamingTimeoutSweeperForTests() {
  const scopedGlobal = globalThis as typeof globalThis & {
    [STREAM_SWEEPER_GLOBAL_KEY]?: ReturnType<typeof setInterval>;
  };

  const interval = scopedGlobal[STREAM_SWEEPER_GLOBAL_KEY];
  if (interval) {
    clearInterval(interval);
    delete scopedGlobal[STREAM_SWEEPER_GLOBAL_KEY];
  }
}

export function isStreamingTimeoutSweeperRunningForTests() {
  const scopedGlobal = globalThis as typeof globalThis & {
    [STREAM_SWEEPER_GLOBAL_KEY]?: ReturnType<typeof setInterval>;
  };

  return Boolean(scopedGlobal[STREAM_SWEEPER_GLOBAL_KEY]);
}
