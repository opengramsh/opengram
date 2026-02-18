import { desc, sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';

const nanoIdLength = 21;

const nanoIdCheck = (columnName: string) =>
  check(`${columnName}_len_check`, sql`length(${sql.identifier(columnName)}) = ${nanoIdLength}`);

// FTS5 virtual tables cannot be expressed as sqliteTable() in Drizzle without
// generating an incorrect "CREATE TABLE" migration. Keep a typed descriptor so
// DB code can reference the virtual table safely.
export type MessagesFtsRow = {
  messageId: string | null;
  chatId: string | null;
  contentFinal: string | null;
};

export const messagesFts = {
  tableName: 'messages_fts',
  columns: {
    messageId: 'message_id',
    chatId: 'chat_id',
    contentFinal: 'content_final',
  },
} as const;

export const chats = sqliteTable(
  'chats',
  {
    id: text('id').primaryKey().notNull(),
    isArchived: integer('is_archived', { mode: 'boolean' }).notNull().default(false),
    customState: text('custom_state'),
    title: text('title').notNull(),
    tags: text('tags').notNull().default('[]'),
    pinned: integer('pinned', { mode: 'boolean' }).notNull().default(false),
    agentIds: text('agent_ids').notNull().default('[]'),
    modelId: text('model_id').notNull(),
    lastMessagePreview: text('last_message_preview'),
    lastMessageRole: text('last_message_role'),
    pendingRequestsCount: integer('pending_requests_count').notNull().default(0),
    lastReadAt: integer('last_read_at', { mode: 'timestamp_ms' }),
    unreadCount: integer('unread_count').notNull().default(0),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
    lastMessageAt: integer('last_message_at', { mode: 'timestamp_ms' }),
  },
  (table) => [
    nanoIdCheck('id'),
    index('chats_inbox_idx').on(table.isArchived, desc(table.pinned), desc(table.lastMessageAt)),
  ],
);

export const messages = sqliteTable(
  'messages',
  {
    id: text('id').primaryKey().notNull(),
    chatId: text('chat_id')
      .notNull()
      .references(() => chats.id, { onDelete: 'cascade' }),
    role: text('role').notNull(),
    senderId: text('sender_id').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
    contentFinal: text('content_final'),
    contentPartial: text('content_partial'),
    streamState: text('stream_state').notNull().default('none'),
    modelId: text('model_id'),
    trace: text('trace'),
  },
  (table) => [
    nanoIdCheck('id'),
    check(
      'messages_role_check',
      sql`${table.role} IN ('user', 'agent', 'system', 'tool')`,
    ),
    check(
      'messages_stream_state_check',
      sql`${table.streamState} IN ('none', 'streaming', 'complete', 'cancelled')`,
    ),
    index('messages_chat_created_idx').on(table.chatId, table.createdAt),
    index('messages_stream_updated_idx').on(table.streamState, table.updatedAt),
  ],
);

export const media = sqliteTable(
  'media',
  {
    id: text('id').primaryKey().notNull(),
    chatId: text('chat_id')
      .notNull()
      .references(() => chats.id, { onDelete: 'cascade' }),
    messageId: text('message_id').references(() => messages.id, { onDelete: 'set null' }),
    storagePath: text('storage_path').notNull(),
    thumbnailPath: text('thumbnail_path'),
    filename: text('filename').notNull(),
    contentType: text('content_type').notNull(),
    byteSize: integer('byte_size').notNull(),
    kind: text('kind').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [
    nanoIdCheck('id'),
    check('media_kind_check', sql`${table.kind} IN ('image', 'audio', 'file')`),
    index('media_chat_created_idx').on(table.chatId, table.createdAt),
  ],
);

export const requests = sqliteTable(
  'requests',
  {
    id: text('id').primaryKey().notNull(),
    chatId: text('chat_id')
      .notNull()
      .references(() => chats.id, { onDelete: 'cascade' }),
    type: text('type').notNull(),
    status: text('status').notNull().default('pending'),
    title: text('title').notNull(),
    body: text('body'),
    config: text('config').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    resolvedAt: integer('resolved_at', { mode: 'timestamp_ms' }),
    resolvedBy: text('resolved_by'),
    resolutionPayload: text('resolution_payload'),
    trace: text('trace'),
  },
  (table) => [
    nanoIdCheck('id'),
    check('requests_type_check', sql`${table.type} IN ('choice', 'text_input', 'form')`),
    check('requests_status_check', sql`${table.status} IN ('pending', 'resolved', 'cancelled')`),
    check('requests_resolved_by_check', sql`${table.resolvedBy} IN ('user', 'backend') OR ${table.resolvedBy} IS NULL`),
    index('requests_chat_status_idx').on(table.chatId, table.status),
  ],
);

export const tagsCatalog = sqliteTable(
  'tags_catalog',
  {
    id: text('id').primaryKey().notNull(),
    name: text('name').notNull(),
    usageCount: integer('usage_count').notNull().default(0),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [
    nanoIdCheck('id'),
    uniqueIndex('tags_catalog_name_idx').on(table.name),
  ],
);

export const events = sqliteTable(
  'events',
  {
    id: text('id').primaryKey().notNull(),
    type: text('type').notNull(),
    payload: text('payload').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [
    nanoIdCheck('id'),
    index('events_created_at_idx').on(table.createdAt),
  ],
);

export const webhookDeliveries = sqliteTable(
  'webhook_deliveries',
  {
    id: text('id').primaryKey().notNull(),
    eventId: text('event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'cascade' }),
    targetUrl: text('target_url').notNull(),
    statusCode: integer('status_code'),
    success: integer('success', { mode: 'boolean' }).notNull(),
    error: text('error'),
    attemptedAt: integer('attempted_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [
    nanoIdCheck('id'),
    index('webhook_deliveries_event_id_idx').on(table.eventId),
  ],
);

export const idempotencyKeys = sqliteTable(
  'idempotency_keys',
  {
    key: text('key').primaryKey().notNull(),
    response: text('response').notNull(),
    statusCode: integer('status_code').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [index('idempotency_keys_created_at_idx').on(table.createdAt)],
);

export const pushSubscriptions = sqliteTable(
  'push_subscriptions',
  {
    id: text('id').primaryKey().notNull(),
    endpoint: text('endpoint').notNull(),
    keysP256dh: text('keys_p256dh').notNull(),
    keysAuth: text('keys_auth').notNull(),
    userAgent: text('user_agent'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [
    nanoIdCheck('id'),
    uniqueIndex('push_subscriptions_endpoint_idx').on(table.endpoint),
  ],
);

export const schema = {
  chats,
  messages,
  media,
  requests,
  tagsCatalog,
  events,
  webhookDeliveries,
  idempotencyKeys,
  pushSubscriptions,
};
