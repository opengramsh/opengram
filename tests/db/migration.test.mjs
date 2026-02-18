import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';

const repoRoot = join(import.meta.dirname, '..', '..');
const migrationPath = join(repoRoot, 'drizzle', '0000_initial.sql');
const migrationSql = readFileSync(migrationPath, 'utf8');

function createDatabase() {
  const tempDir = mkdtempSync(join(tmpdir(), 'opengram-db-'));
  const dbPath = join(tempDir, 'test.db');
  const db = new DatabaseSync(dbPath);
  db.exec(migrationSql);
  return db;
}

function listObjects(db, type) {
  return db
    .prepare("SELECT name FROM sqlite_master WHERE type = ? ORDER BY name")
    .all(type)
    .map((row) => row.name);
}

test('migration creates all required tables and FTS virtual table', () => {
  const db = createDatabase();

  const tables = listObjects(db, 'table');
  const requiredTables = [
    'chats',
    'events',
    'idempotency_keys',
    'media',
    'messages',
    'messages_fts',
    'push_subscriptions',
    'requests',
    'tags_catalog',
    'webhook_deliveries',
  ];

  for (const table of requiredTables) {
    assert.ok(tables.includes(table), `missing table: ${table}`);
  }
});

test('migration creates all required indexes from spec section 10', () => {
  const db = createDatabase();
  const indexes = listObjects(db, 'index');
  const requiredIndexes = [
    'chats_inbox_idx',
    'messages_chat_created_idx',
    'media_chat_created_idx',
    'requests_chat_status_idx',
    'tags_catalog_name_idx',
    'events_created_at_idx',
    'webhook_deliveries_event_id_idx',
    'idempotency_keys_created_at_idx',
    'push_subscriptions_endpoint_idx',
  ];

  for (const idx of requiredIndexes) {
    assert.ok(indexes.includes(idx), `missing index: ${idx}`);
  }
});

test('id constraints enforce 21-char NanoID length', () => {
  const db = createDatabase();
  const now = Date.now();

  assert.throws(() => {
    db.prepare(
      'INSERT INTO chats (id, title, model_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
    ).run('short_id', 'Chat', 'model-a', now, now);
  });

  assert.doesNotThrow(() => {
    db.prepare(
      'INSERT INTO chats (id, title, model_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
    ).run('123456789012345678901', 'Chat', 'model-a', now, now);
  });
});

test('messages_fts stores and searches content_final through triggers', () => {
  const db = createDatabase();
  const now = Date.now();
  const chatId = '123456789012345678901';
  const messageId = '123456789012345678902';

  db.prepare(
    'INSERT INTO chats (id, title, model_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
  ).run(chatId, 'FTS Chat', 'model-a', now, now);

  db.prepare(
    [
      'INSERT INTO messages (id, chat_id, role, sender_id, created_at, updated_at, content_final, stream_state)',
      'VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    ].join(' '),
  ).run(messageId, chatId, 'agent', 'agent:one', now, now, 'hello full text search', 'complete');

  const row = db
    .prepare("SELECT message_id FROM messages_fts WHERE messages_fts MATCH 'hello'")
    .get();
  assert.equal(row.message_id, messageId);
});

test('better-sqlite3 client enables WAL mode', () => {
  const clientSource = readFileSync(join(repoRoot, 'src', 'db', 'client.ts'), 'utf8');
  assert.match(clientSource, /journal_mode\s*=\s*WAL/);
});
