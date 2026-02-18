import type Database from 'better-sqlite3';
import { nanoid } from 'nanoid';

import { loadOpengramConfig } from '@/src/config/opengram-config';
import { createSqliteConnection } from '@/src/db/client';

import { encodeCursor, parsePagination } from '@/src/api/pagination';
import { notFoundError, validationError } from '@/src/api/http';

const TITLE_FALLBACK = 'New Chat';
const PREVIEW_MAX_CHARS = 180;

type ChatRecord = {
  id: string;
  is_archived: number;
  custom_state: string | null;
  title: string;
  tags: string;
  pinned: number;
  agent_ids: string;
  model_id: string;
  last_message_preview: string | null;
  last_message_role: string | null;
  pending_requests_count: number;
  last_read_at: number | null;
  unread_count: number;
  created_at: number;
  updated_at: number;
  last_message_at: number | null;
};

type CreateChatInput = {
  agentIds: string[];
  modelId: string;
  title?: string;
  tags?: string[];
  customState?: string;
  firstMessage?: string;
};

type UpdateChatInput = {
  title?: string;
  tags?: string[];
  customState?: string;
  pinned?: boolean;
  modelId?: string;
};

type ListChatsResult = {
  data: ReturnType<typeof serializeChat>[];
  nextCursor: string | null;
  hasMore: boolean;
};

function assertStringArray(value: unknown, fieldName: string) {
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) {
    throw validationError(`${fieldName} must be an array of strings.`, { field: fieldName });
  }
}

function toTimestamp(value: number | null) {
  return value === null ? null : new Date(value).toISOString();
}

function titleFromFirstMessage(firstMessage: string | undefined, maxChars: number) {
  if (!firstMessage) {
    return TITLE_FALLBACK;
  }

  const compact = firstMessage.replace(/\s+/g, ' ').trim();
  if (!compact) {
    return TITLE_FALLBACK;
  }

  return compact.slice(0, maxChars);
}

function normalizeTitle(title: string | undefined, firstMessage: string | undefined, maxChars: number) {
  if (title === undefined) {
    return titleFromFirstMessage(firstMessage, maxChars);
  }

  const normalized = title.trim();
  if (!normalized) {
    throw validationError('title cannot be empty.', { field: 'title' });
  }

  return normalized.slice(0, maxChars);
}

function parseJsonArray(value: string, fieldName: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    assertStringArray(parsed, fieldName);
    return parsed;
  } catch {
    throw validationError(`stored ${fieldName} is invalid JSON.`, { field: fieldName });
  }
}

function serializeChat(record: ChatRecord) {
  return {
    id: record.id,
    is_archived: Boolean(record.is_archived),
    custom_state: record.custom_state,
    title: record.title,
    tags: parseJsonArray(record.tags, 'tags'),
    pinned: Boolean(record.pinned),
    agent_ids: parseJsonArray(record.agent_ids, 'agentIds'),
    model_id: record.model_id,
    last_message_preview: record.last_message_preview,
    last_message_role: record.last_message_role,
    pending_requests_count: record.pending_requests_count,
    last_read_at: toTimestamp(record.last_read_at),
    unread_count: record.unread_count,
    created_at: toTimestamp(record.created_at),
    updated_at: toTimestamp(record.updated_at),
    last_message_at: toTimestamp(record.last_message_at),
  };
}

function ensureModelExists(modelId: string, allowedModelIds: Set<string>) {
  if (!allowedModelIds.has(modelId)) {
    throw validationError('modelId must match a configured model id.', { field: 'modelId' });
  }
}

function ensureAgentIds(agentIds: string[], allowedAgentIds: Set<string>) {
  if (!agentIds.length) {
    throw validationError('agentIds must contain at least one agent id.', { field: 'agentIds' });
  }

  for (const agentId of agentIds) {
    if (!allowedAgentIds.has(agentId)) {
      throw validationError('agentIds contains unknown id.', { field: 'agentIds', agentId });
    }
  }
}

function ensureCustomState(customState: string | undefined, allowedStates: Set<string>) {
  if (customState === undefined) {
    return;
  }

  if (!allowedStates.has(customState)) {
    throw validationError('customState must match configured customStates.', {
      field: 'customState',
    });
  }
}

function getChatRecord(db: Database.Database, chatId: string): ChatRecord {
  const row = db.prepare('SELECT * FROM chats WHERE id = ?').get(chatId) as ChatRecord | undefined;
  if (!row) {
    throw notFoundError('Chat not found.', { chatId });
  }

  return row;
}

function updateDenormalizedFields(db: Database.Database, chatId: string) {
  const chat = getChatRecord(db, chatId);

  const lastMessage = db
    .prepare(
      [
        'SELECT role, created_at, content_final, content_partial',
        'FROM messages',
        'WHERE chat_id = ?',
        'ORDER BY created_at DESC, id DESC',
        'LIMIT 1',
      ].join(' '),
    )
    .get(chatId) as
    | {
        role: string;
        created_at: number;
        content_final: string | null;
        content_partial: string | null;
      }
    | undefined;

  const pendingRequestsRow = db
    .prepare('SELECT COUNT(*) as count FROM requests WHERE chat_id = ? AND status = ?')
    .get(chatId, 'pending') as { count: number };

  let unreadCount = 0;
  if (chat.last_read_at === null) {
    unreadCount = (
      db
        .prepare("SELECT COUNT(*) as count FROM messages WHERE chat_id = ? AND role != 'user'")
        .get(chatId) as { count: number }
    ).count;
  } else {
    unreadCount = (
      db
        .prepare(
          [
            'SELECT COUNT(*) as count FROM messages',
            "WHERE chat_id = ? AND role != 'user' AND created_at > ?",
          ].join(' '),
        )
        .get(chatId, chat.last_read_at) as { count: number }
    ).count;
  }

  const previewRaw = (lastMessage?.content_final ?? lastMessage?.content_partial ?? null)?.trim() ?? null;
  const preview = previewRaw ? previewRaw.slice(0, PREVIEW_MAX_CHARS) : null;

  db.prepare(
    [
      'UPDATE chats',
      'SET last_message_preview = ?,',
      'last_message_role = ?,',
      'last_message_at = ?,',
      'pending_requests_count = ?,',
      'unread_count = ?',
      'WHERE id = ?',
    ].join(' '),
  ).run(
    preview,
    lastMessage?.role ?? null,
    lastMessage?.created_at ?? null,
    pendingRequestsRow.count,
    unreadCount,
    chatId,
  );
}

function withDb<T>(callback: (db: Database.Database) => T): T {
  const db = createSqliteConnection();
  try {
    return callback(db);
  } finally {
    db.close();
  }
}

export function createChat(input: CreateChatInput) {
  const config = loadOpengramConfig();

  if (!Array.isArray(input.agentIds)) {
    throw validationError('agentIds is required.', { field: 'agentIds' });
  }
  assertStringArray(input.agentIds, 'agentIds');

  if (typeof input.modelId !== 'string') {
    throw validationError('modelId is required.', { field: 'modelId' });
  }

  if (input.tags !== undefined) {
    assertStringArray(input.tags, 'tags');
  }

  if (input.customState !== undefined && typeof input.customState !== 'string') {
    throw validationError('customState must be a string.', { field: 'customState' });
  }

  if (input.firstMessage !== undefined && typeof input.firstMessage !== 'string') {
    throw validationError('firstMessage must be a string.', { field: 'firstMessage' });
  }

  if (input.title !== undefined && typeof input.title !== 'string') {
    throw validationError('title must be a string.', { field: 'title' });
  }

  const allowedModelIds = new Set(config.models.map((model) => model.id));
  const allowedAgentIds = new Set(config.agents.map((agent) => agent.id));
  const allowedStates = new Set(config.customStates);

  ensureModelExists(input.modelId, allowedModelIds);
  ensureAgentIds(input.agentIds, allowedAgentIds);
  ensureCustomState(input.customState, allowedStates);

  const now = Date.now();
  const chatId = nanoid();
  const title = normalizeTitle(input.title, input.firstMessage, config.titleMaxChars);
  const tags = input.tags ?? [];
  const customState = input.customState ?? config.defaultCustomState;

  return withDb((db) => {
    db.prepare(
      [
        'INSERT INTO chats (',
        'id, is_archived, custom_state, title, tags, pinned, agent_ids, model_id,',
        'pending_requests_count, last_read_at, unread_count, created_at, updated_at',
        ') VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      ].join(' '),
    ).run(
      chatId,
      0,
      customState,
      title,
      JSON.stringify(tags),
      0,
      JSON.stringify(input.agentIds),
      input.modelId,
      0,
      now,
      0,
      now,
      now,
    );

    updateDenormalizedFields(db, chatId);
    return serializeChat(getChatRecord(db, chatId));
  });
}

export function listChats(url: URL): ListChatsResult {
  const params = url.searchParams;
  const { limit, cursor } = parsePagination(params);

  const conditions: string[] = [];
  const queryParams: unknown[] = [];

  const archived = params.get('archived');
  if (archived !== null) {
    if (archived !== 'true' && archived !== 'false') {
      throw validationError('archived must be true or false.', { field: 'archived' });
    }

    conditions.push('is_archived = ?');
    queryParams.push(archived === 'true' ? 1 : 0);
  }

  const state = params.get('state');
  if (state) {
    conditions.push('custom_state = ?');
    queryParams.push(state);
  }

  const tag = params.get('tag');
  if (tag) {
    conditions.push('EXISTS (SELECT 1 FROM json_each(chats.tags) WHERE json_each.value = ?)');
    queryParams.push(tag);
  }

  const agentId = params.get('agentId');
  if (agentId) {
    conditions.push('EXISTS (SELECT 1 FROM json_each(chats.agent_ids) WHERE json_each.value = ?)');
    queryParams.push(agentId);
  }

  const query = params.get('query');
  if (query) {
    conditions.push('LOWER(title) LIKE ?');
    queryParams.push(`%${query.toLowerCase()}%`);
  }

  if (cursor) {
    conditions.push(
      [
        '(',
        'pinned < ? OR',
        '(pinned = ? AND COALESCE(last_message_at, 0) < ?) OR',
        '(pinned = ? AND COALESCE(last_message_at, 0) = ? AND id < ?)',
        ')',
      ].join(' '),
    );
    queryParams.push(
      cursor.pinned,
      cursor.pinned,
      cursor.lastMessageAt,
      cursor.pinned,
      cursor.lastMessageAt,
      cursor.id,
    );
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const rows = withDb((db) => {
    return db
      .prepare(
        [
          'SELECT * FROM chats',
          where,
          'ORDER BY pinned DESC, COALESCE(last_message_at, 0) DESC, id DESC',
          'LIMIT ?',
        ].join(' '),
      )
      .all(...queryParams, limit + 1) as ChatRecord[];
  });

  const hasMore = rows.length > limit;
  const slice = hasMore ? rows.slice(0, limit) : rows;
  const last = slice.at(-1);
  const nextCursor = last
    ? encodeCursor({
        pinned: last.pinned,
        lastMessageAt: last.last_message_at ?? 0,
        id: last.id,
      })
    : null;

  return {
    data: slice.map(serializeChat),
    nextCursor: hasMore ? nextCursor : null,
    hasMore,
  };
}

export function getChat(chatId: string) {
  return withDb((db) => serializeChat(getChatRecord(db, chatId)));
}

export function updateChat(chatId: string, input: UpdateChatInput) {
  const config = loadOpengramConfig();
  const updates: string[] = [];
  const values: unknown[] = [];

  if (input.title !== undefined) {
    if (typeof input.title !== 'string') {
      throw validationError('title must be a string.', { field: 'title' });
    }

    const normalized = input.title.trim();
    if (!normalized) {
      throw validationError('title cannot be empty.', { field: 'title' });
    }

    updates.push('title = ?');
    values.push(normalized.slice(0, config.titleMaxChars));
  }

  if (input.tags !== undefined) {
    assertStringArray(input.tags, 'tags');
    updates.push('tags = ?');
    values.push(JSON.stringify(input.tags));
  }

  if (input.customState !== undefined) {
    if (typeof input.customState !== 'string') {
      throw validationError('customState must be a string.', { field: 'customState' });
    }

    ensureCustomState(input.customState, new Set(config.customStates));
    updates.push('custom_state = ?');
    values.push(input.customState);
  }

  if (input.pinned !== undefined) {
    if (typeof input.pinned !== 'boolean') {
      throw validationError('pinned must be a boolean.', { field: 'pinned' });
    }

    updates.push('pinned = ?');
    values.push(input.pinned ? 1 : 0);
  }

  if (input.modelId !== undefined) {
    if (typeof input.modelId !== 'string') {
      throw validationError('modelId must be a string.', { field: 'modelId' });
    }

    ensureModelExists(input.modelId, new Set(config.models.map((model) => model.id)));
    updates.push('model_id = ?');
    values.push(input.modelId);
  }

  if (!updates.length) {
    throw validationError('At least one updatable field is required.');
  }

  const now = Date.now();
  updates.push('updated_at = ?');
  values.push(now);

  return withDb((db) => {
    getChatRecord(db, chatId);
    db.prepare(`UPDATE chats SET ${updates.join(', ')} WHERE id = ?`).run(...values, chatId);
    updateDenormalizedFields(db, chatId);
    return serializeChat(getChatRecord(db, chatId));
  });
}

function setArchiveState(chatId: string, archived: boolean) {
  return withDb((db) => {
    getChatRecord(db, chatId);
    db.prepare('UPDATE chats SET is_archived = ?, updated_at = ? WHERE id = ?').run(
      archived ? 1 : 0,
      Date.now(),
      chatId,
    );
  });
}

export function archiveChat(chatId: string) {
  setArchiveState(chatId, true);
}

export function unarchiveChat(chatId: string) {
  setArchiveState(chatId, false);
}

export function markChatRead(chatId: string) {
  return withDb((db) => {
    getChatRecord(db, chatId);
    db.prepare('UPDATE chats SET last_read_at = ?, updated_at = ? WHERE id = ?').run(
      Date.now(),
      Date.now(),
      chatId,
    );
    updateDenormalizedFields(db, chatId);
  });
}

export function markChatUnread(chatId: string) {
  return withDb((db) => {
    getChatRecord(db, chatId);
    db.prepare('UPDATE chats SET last_read_at = NULL, updated_at = ? WHERE id = ?').run(
      Date.now(),
      chatId,
    );
    updateDenormalizedFields(db, chatId);
  });
}

export function recalculateChatDenormalized(chatId: string) {
  return withDb((db) => {
    getChatRecord(db, chatId);
    updateDenormalizedFields(db, chatId);
    return serializeChat(getChatRecord(db, chatId));
  });
}
