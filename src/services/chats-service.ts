import type Database from 'better-sqlite3';
import { nanoid } from 'nanoid';

import { loadOpengramConfig } from '@/src/config/opengram-config';
import { getDb } from '@/src/db/client';

import { encodeCursor, parsePagination } from '@/src/api/pagination';
import { notFoundError, validationError } from '@/src/api/http';
import { emitEvent } from '@/src/services/events-service';

const TITLE_FALLBACK = 'New Chat';
const PREVIEW_MAX_CHARS = 180;
const USER_SENDER_ID = 'user:primary';
type MediaKind = 'image' | 'audio' | 'file';

type ChatRecord = {
  id: string;
  is_archived: number;
  title: string;
  title_source: string;
  tags: string;
  pinned: number;
  agent_ids: string;
  model_id: string;
  last_message_preview: string | null;
  last_message_role: string | null;
  pending_requests_count: number;
  last_read_at: number | null;
  unread_count: number;
  notifications_muted: number;
  created_at: number;
  updated_at: number;
  last_message_at: number | null;
};

type CreateChatInput = {
  agentIds: string[];
  modelId: string;
  title?: string;
  tags?: string[];
  firstMessage?: string;
};

type UpdateChatInput = {
  title?: string;
  titleAutoRenamed?: boolean;
  tags?: string[];
  pinned?: boolean;
  modelId?: string;
  notificationsMuted?: boolean;
};

type ListChatsResult = {
  data: ReturnType<typeof serializeChat>[];
  nextCursor: string | null;
  hasMore: boolean;
};

type PendingSummaryResult = {
  pendingRequestsTotal: number;
};

type UnreadSummaryResult = {
  totalUnread: number;
  unreadByAgent: Record<string, number>;
};

type TagSuggestion = {
  name: string;
  usage_count: number;
};

function assertStringArray(value: unknown, fieldName: string) {
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) {
    throw validationError(`${fieldName} must be an array of strings.`, { field: fieldName });
  }
}

function normalizeTags(tags: string[]) {
  const seen = new Set<string>();
  const normalized: string[] = [];

  for (const rawTag of tags) {
    const tag = rawTag.trim();
    if (!tag || seen.has(tag)) {
      continue;
    }

    seen.add(tag);
    normalized.push(tag);
  }

  return normalized;
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

function normalizeFirstMessageContent(firstMessage: string | undefined) {
  if (firstMessage === undefined) {
    return null;
  }

  const normalized = firstMessage.trim();
  return normalized || null;
}

function parseJsonArray(value: string, fieldName: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    assertStringArray(parsed, fieldName);
    return parsed as string[];
  } catch {
    throw validationError(`stored ${fieldName} is invalid JSON.`, { field: fieldName });
  }
}

function mediaIdFromTrace(trace: string | null) {
  if (!trace) {
    return null;
  }

  try {
    const parsed = JSON.parse(trace) as Record<string, unknown>;
    return typeof parsed.mediaId === 'string' ? parsed.mediaId : null;
  } catch {
    return null;
  }
}

function deriveMediaPreview(
  db: Database.Database,
  chatId: string,
  messageId: string,
  trace: string | null,
) {
  const kinds = new Set<MediaKind>();
  const linkedRows = db
    .prepare('SELECT kind FROM media WHERE chat_id = ? AND message_id = ?')
    .all(chatId, messageId) as Array<{ kind: MediaKind }>;
  for (const row of linkedRows) {
    kinds.add(row.kind);
  }

  const traceMediaId = mediaIdFromTrace(trace);
  if (traceMediaId) {
    const traced = db
      .prepare('SELECT kind FROM media WHERE chat_id = ? AND id = ?')
      .get(chatId, traceMediaId) as { kind: MediaKind } | undefined;
    if (traced) {
      kinds.add(traced.kind);
    }
  }

  if (kinds.size === 0) {
    return null;
  }

  if (kinds.size === 1 && kinds.has('audio')) {
    return 'Voice note';
  }

  return 'Attachment';
}

function serializeChat(record: ChatRecord) {
  return {
    id: record.id,
    is_archived: Boolean(record.is_archived),
    title: record.title,
    title_source: record.title_source as 'default' | 'auto' | 'manual',
    tags: parseJsonArray(record.tags, 'tags'),
    pinned: Boolean(record.pinned),
    agent_ids: parseJsonArray(record.agent_ids, 'agentIds'),
    model_id: record.model_id,
    last_message_preview: record.last_message_preview,
    last_message_role: record.last_message_role,
    pending_requests_count: record.pending_requests_count,
    last_read_at: toTimestamp(record.last_read_at),
    unread_count: record.unread_count,
    notifications_muted: Boolean(record.notifications_muted),
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

function escapeLikePattern(value: string) {
  return value.replace(/[\\%_]/g, '\\$&');
}

function syncTagsCatalogUsage(db: Database.Database, previousTags: string[], nextTags: string[]) {
  const previous = new Set(previousTags);
  const next = new Set(nextTags);

  const added = nextTags.filter((tag) => !previous.has(tag));
  const removed = previousTags.filter((tag) => !next.has(tag));

  for (const tag of added) {
    db.prepare(
      [
        'INSERT INTO tags_catalog (id, name, usage_count, created_at)',
        'VALUES (?, ?, 1, ?)',
        'ON CONFLICT(name) DO UPDATE SET usage_count = usage_count + 1',
      ].join(' '),
    ).run(nanoid(), tag, Date.now());
  }

  for (const tag of removed) {
    db.prepare(
      [
        'UPDATE tags_catalog',
        'SET usage_count = CASE WHEN usage_count > 0 THEN usage_count - 1 ELSE 0 END',
        'WHERE name = ?',
      ].join(' '),
    ).run(tag);
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
        'SELECT id, role, created_at, content_final, content_partial, trace',
        'FROM messages',
        'WHERE chat_id = ?',
        'ORDER BY created_at DESC, id DESC',
        'LIMIT 1',
      ].join(' '),
    )
    .get(chatId) as
    | {
        id: string;
        role: string;
        created_at: number;
        content_final: string | null;
        content_partial: string | null;
        trace: string | null;
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
  const preview = previewRaw
    ? previewRaw.slice(0, PREVIEW_MAX_CHARS)
    : (lastMessage ? deriveMediaPreview(db, chatId, lastMessage.id, lastMessage.trace) : null);

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

  if (input.firstMessage !== undefined && typeof input.firstMessage !== 'string') {
    throw validationError('firstMessage must be a string.', { field: 'firstMessage' });
  }

  if (input.title !== undefined && typeof input.title !== 'string') {
    throw validationError('title must be a string.', { field: 'title' });
  }

  const allowedModelIds = new Set(config.models.map((model) => model.id));
  const allowedAgentIds = new Set(config.agents.map((agent) => agent.id));

  ensureModelExists(input.modelId, allowedModelIds);
  ensureAgentIds(input.agentIds, allowedAgentIds);

  const now = Date.now();
  const chatId = nanoid();
  const title = normalizeTitle(input.title, input.firstMessage, config.titleMaxChars);
  const firstMessageContent = normalizeFirstMessageContent(input.firstMessage);
  const tags = normalizeTags(input.tags ?? []);

  const db = getDb();
  let firstMessageId: string | null = null;

  db.prepare(
    [
      'INSERT INTO chats (',
      'id, is_archived, title, tags, pinned, agent_ids, model_id,',
      'pending_requests_count, last_read_at, unread_count, created_at, updated_at',
      ') VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    ].join(' '),
  ).run(
    chatId,
    0,
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

  if (firstMessageContent !== null) {
    firstMessageId = nanoid();
    db.prepare(
      [
        'INSERT INTO messages (',
        'id, chat_id, role, sender_id, created_at, updated_at, content_final, content_partial,',
        'stream_state, model_id, trace',
        ') VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      ].join(' '),
    ).run(
      firstMessageId,
      chatId,
      'user',
      USER_SENDER_ID,
      now,
      now,
      firstMessageContent,
      null,
      'complete',
      input.modelId,
      null,
    );
  }

  syncTagsCatalogUsage(db, [], tags);
  updateDenormalizedFields(db, chatId);
  const result = {
    chat: serializeChat(getChatRecord(db, chatId)),
    firstMessageId,
  };

  emitEvent('chat.created', {
    chatId: result.chat.id,
  });

  if (result.firstMessageId) {
    emitEvent('message.created', {
      chatId: result.chat.id,
      messageId: result.firstMessageId,
      role: 'user',
      senderId: USER_SENDER_ID,
      streamState: 'complete',
      contentFinal: firstMessageContent,
      createdAt: new Date(now).toISOString(),
    });
  }

  return result.chat;
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
  const db = getDb();
  const rows = db
    .prepare(
      [
        'SELECT * FROM chats',
        where,
        'ORDER BY pinned DESC, COALESCE(last_message_at, 0) DESC, id DESC',
        'LIMIT ?',
      ].join(' '),
    )
    .all(...queryParams, limit + 1) as ChatRecord[];

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

export function getPendingSummary(url: URL): PendingSummaryResult {
  const params = url.searchParams;
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

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const db = getDb();
  const row = db
    .prepare(`SELECT COALESCE(SUM(pending_requests_count), 0) as total FROM chats ${where}`)
    .get(...queryParams) as { total: number | null };
  const total = row.total ?? 0;

  return { pendingRequestsTotal: Math.max(0, total) };
}

export function getUnreadSummary(url: URL): UnreadSummaryResult {
  const params = url.searchParams;
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

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const db = getDb();

  const totalRow = db
    .prepare(`SELECT COALESCE(SUM(unread_count), 0) as total FROM chats ${where}`)
    .get(...queryParams) as { total: number | null };
  const totalUnread = Math.max(0, totalRow.total ?? 0);

  const agentRows = db
    .prepare(
      [
        'SELECT json_each.value as agent_id, COALESCE(SUM(chats.unread_count), 0) as total',
        `FROM chats, json_each(chats.agent_ids) ${where}`,
        'GROUP BY json_each.value',
      ].join(' '),
    )
    .all(...queryParams) as Array<{ agent_id: string; total: number }>;

  const unreadByAgent: Record<string, number> = {};
  for (const row of agentRows) {
    if (row.total > 0) {
      unreadByAgent[row.agent_id] = row.total;
    }
  }

  return { totalUnread, unreadByAgent };
}

export function getChat(chatId: string) {
  const db = getDb();
  return serializeChat(getChatRecord(db, chatId));
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
    updates.push('title_source = ?');
    values.push(input.titleAutoRenamed ? 'auto' : 'manual');
  }

  if (input.tags !== undefined) {
    assertStringArray(input.tags, 'tags');
    const normalizedTags = normalizeTags(input.tags);
    updates.push('tags = ?');
    values.push(JSON.stringify(normalizedTags));
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

  if (input.notificationsMuted !== undefined) {
    if (typeof input.notificationsMuted !== 'boolean') {
      throw validationError('notificationsMuted must be a boolean.', { field: 'notificationsMuted' });
    }

    updates.push('notifications_muted = ?');
    values.push(input.notificationsMuted ? 1 : 0);
  }

  if (!updates.length) {
    throw validationError('At least one updatable field is required.');
  }

  const now = Date.now();
  updates.push('updated_at = ?');
  values.push(now);

  const db = getDb();
  const current = getChatRecord(db, chatId);
  const previousTags = parseJsonArray(current.tags, 'tags');
  db.prepare(`UPDATE chats SET ${updates.join(', ')} WHERE id = ?`).run(...values, chatId);
  const updatedRecord = getChatRecord(db, chatId);
  const nextTags = parseJsonArray(updatedRecord.tags, 'tags');
  syncTagsCatalogUsage(db, previousTags, nextTags);
  updateDenormalizedFields(db, chatId);
  const updated = serializeChat(getChatRecord(db, chatId));

  emitEvent('chat.updated', {
    chatId: updated.id,
  });

  return updated;
}

function setArchiveState(chatId: string, archived: boolean) {
  const db = getDb();
  getChatRecord(db, chatId);
  db.prepare('UPDATE chats SET is_archived = ?, updated_at = ? WHERE id = ?').run(
    archived ? 1 : 0,
    Date.now(),
    chatId,
  );

  emitEvent(archived ? 'chat.archived' : 'chat.unarchived', {
    chatId,
  });
}

export function archiveChat(chatId: string) {
  setArchiveState(chatId, true);
}

export function unarchiveChat(chatId: string) {
  setArchiveState(chatId, false);
}

export function markChatRead(chatId: string) {
  const db = getDb();
  getChatRecord(db, chatId);
  db.prepare('UPDATE chats SET last_read_at = ?, updated_at = ? WHERE id = ?').run(
    Date.now(),
    Date.now(),
    chatId,
  );
  updateDenormalizedFields(db, chatId);

  emitEvent('chat.read', {
    chatId,
  });
}

export function markChatUnread(chatId: string) {
  const db = getDb();
  getChatRecord(db, chatId);
  db.prepare('UPDATE chats SET last_read_at = NULL, updated_at = ? WHERE id = ?').run(
    Date.now(),
    chatId,
  );
  updateDenormalizedFields(db, chatId);

  emitEvent('chat.unread', {
    chatId,
  });
}

export function recalculateChatDenormalized(chatId: string) {
  const db = getDb();
  getChatRecord(db, chatId);
  updateDenormalizedFields(db, chatId);
  return serializeChat(getChatRecord(db, chatId));
}

export function listTagSuggestions(query: string, limit = 10) {
  const normalizedQuery = query.trim();
  if (!normalizedQuery) {
    return [];
  }

  const cappedLimit = Math.max(1, Math.min(50, Math.trunc(limit)));
  const pattern = `${escapeLikePattern(normalizedQuery)}%`;

  const db = getDb();
  const rows = db
    .prepare(
      [
        'SELECT name, usage_count',
        'FROM tags_catalog',
        "WHERE name LIKE ? ESCAPE '\\'",
        'ORDER BY usage_count DESC, name ASC',
        'LIMIT ?',
      ].join(' '),
    )
    .all(pattern, cappedLimit) as TagSuggestion[];

  return rows;
}
