import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { GET as searchGet } from '@/app/api/v1/search/route';

const repoRoot = join(import.meta.dirname, '..', '..');
const migrationSql = readFileSync(join(repoRoot, 'drizzle', '0000_initial.sql'), 'utf8');

let db: Database.Database;

function createRequest(url: string) {
  return new Request(url, { method: 'GET' });
}

beforeEach(() => {
  const tempDir = mkdtempSync(join(tmpdir(), 'opengram-search-api-'));
  const dbPath = join(tempDir, 'test.db');

  process.env.DATABASE_URL = dbPath;
  db = new Database(dbPath);
  db.exec(migrationSql);
});

afterEach(() => {
  db.close();
  delete process.env.DATABASE_URL;
});

describe('search API', () => {
  it('searches chat titles by default scope with pagination', async () => {
    const now = Date.now();
    db.prepare(
      [
        'INSERT INTO chats (id, title, model_id, created_at, updated_at, last_message_at)',
        'VALUES (?, ?, ?, ?, ?, ?)',
      ].join(' '),
    ).run('111111111111111111111', 'Alpha oldest', 'model-default', now - 10_000, now - 10_000, now - 10_000);
    db.prepare(
      [
        'INSERT INTO chats (id, title, model_id, created_at, updated_at, last_message_at)',
        'VALUES (?, ?, ?, ?, ?, ?)',
      ].join(' '),
    ).run('222222222222222222222', 'Alpha middle', 'model-default', now - 5_000, now - 5_000, now - 5_000);
    db.prepare(
      [
        'INSERT INTO chats (id, title, model_id, created_at, updated_at, last_message_at)',
        'VALUES (?, ?, ?, ?, ?, ?)',
      ].join(' '),
    ).run('333333333333333333333', 'Alpha newest', 'model-default', now - 1_000, now - 1_000, now - 1_000);

    const page1Response = await searchGet(createRequest('http://localhost/api/v1/search?q=alpha&limit=2'));
    const page1 = await page1Response.json();

    expect(page1Response.status).toBe(200);
    expect(page1.chats).toHaveLength(2);
    expect(page1.chats[0].id).toBe('333333333333333333333');
    expect(page1.chats[1].id).toBe('222222222222222222222');
    expect(page1.messages).toEqual([]);
    expect(page1.cursor.hasMore).toBe(true);
    expect(page1.cursor.next).toBeTypeOf('string');

    const page2Response = await searchGet(
      createRequest(
        `http://localhost/api/v1/search?q=alpha&limit=2&cursor=${encodeURIComponent(page1.cursor.next)}`,
      ),
    );
    const page2 = await page2Response.json();

    expect(page2Response.status).toBe(200);
    expect(page2.chats).toHaveLength(1);
    expect(page2.chats[0].id).toBe('111111111111111111111');
    expect(page2.cursor.hasMore).toBe(false);
    expect(page2.cursor.next).toBeNull();
  });

  it('searches messages via fts5 and returns highlighted snippets', async () => {
    const now = Date.now();
    const chatId = '444444444444444444444';
    db.prepare(
      'INSERT INTO chats (id, title, model_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
    ).run(chatId, 'FTS chat', 'model-default', now, now);
    db.prepare(
      [
        'INSERT INTO messages (id, chat_id, role, sender_id, created_at, updated_at, content_final, stream_state)',
        'VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      ].join(' '),
    ).run('555555555555555555555', chatId, 'agent', 'agent-default', now, now, 'hello planet search', 'complete');
    db.prepare(
      [
        'INSERT INTO messages (id, chat_id, role, sender_id, created_at, updated_at, content_final, stream_state)',
        'VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      ].join(' '),
    ).run('666666666666666666666', chatId, 'agent', 'agent-default', now + 1, now + 1, 'no match here', 'complete');

    const response = await searchGet(
      createRequest('http://localhost/api/v1/search?q=planet&scope=messages&limit=10'),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.chats).toEqual([]);
    expect(body.messages).toHaveLength(1);
    expect(body.messages[0].id).toBe('555555555555555555555');
    expect(body.messages[0].snippet).toContain('<mark>planet</mark>');
    expect(body.messages[0].chat_id).toBe(chatId);
  });

  it('returns unified all-scope results with stable pagination', async () => {
    const now = Date.now();
    db.prepare(
      [
        'INSERT INTO chats (id, title, model_id, created_at, updated_at, last_message_at)',
        'VALUES (?, ?, ?, ?, ?, ?)',
      ].join(' '),
    ).run('777777777777777777777', 'Alpha older title hit', 'model-default', now - 10_000, now - 10_000, now - 10_000);
    db.prepare(
      [
        'INSERT INTO chats (id, title, model_id, created_at, updated_at, last_message_at)',
        'VALUES (?, ?, ?, ?, ?, ?)',
      ].join(' '),
    ).run('888888888888888888888', 'Alpha newer title hit', 'model-default', now - 3_000, now - 3_000, now - 3_000);
    db.prepare(
      'INSERT INTO chats (id, title, model_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
    ).run('999999999999999999999', 'Neutral container', 'model-default', now, now);

    db.prepare(
      [
        'INSERT INTO messages (id, chat_id, role, sender_id, created_at, updated_at, content_final, stream_state)',
        'VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      ].join(' '),
    ).run(
      'aaaaaaaaaaaaaaaaaaaaa',
      '999999999999999999999',
      'agent',
      'agent-default',
      now - 1_000,
      now - 1_000,
      'alpha newest message hit',
      'complete',
    );
    db.prepare(
      [
        'INSERT INTO messages (id, chat_id, role, sender_id, created_at, updated_at, content_final, stream_state)',
        'VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      ].join(' '),
    ).run(
      'bbbbbbbbbbbbbbbbbbbbb',
      '999999999999999999999',
      'agent',
      'agent-default',
      now - 3_000,
      now - 3_000,
      'alpha tied message hit',
      'complete',
    );

    const page1Response = await searchGet(
      createRequest('http://localhost/api/v1/search?q=alpha&scope=all&limit=2'),
    );
    const page1 = await page1Response.json();

    expect(page1Response.status).toBe(200);
    expect(page1.messages.map((m: { id: string }) => m.id)).toEqual([
      'aaaaaaaaaaaaaaaaaaaaa',
      'bbbbbbbbbbbbbbbbbbbbb',
    ]);
    expect(page1.chats).toEqual([]);
    expect(page1.cursor.hasMore).toBe(true);

    const page2Response = await searchGet(
      createRequest(
        `http://localhost/api/v1/search?q=alpha&scope=all&limit=2&cursor=${encodeURIComponent(page1.cursor.next)}`,
      ),
    );
    const page2 = await page2Response.json();

    expect(page2Response.status).toBe(200);
    expect(page2.messages).toEqual([]);
    expect(page2.chats.map((c: { id: string }) => c.id)).toEqual([
      '888888888888888888888',
      '777777777777777777777',
    ]);
    expect(page2.cursor.hasMore).toBe(false);
    expect(page2.cursor.next).toBeNull();
  });

  it('indexes content when content_final is set after streaming start', async () => {
    const now = Date.now();
    const chatId = 'ccccccccccccccccccccc';
    const messageId = 'ddddddddddddddddddddd';

    db.prepare(
      'INSERT INTO chats (id, title, model_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
    ).run(chatId, 'Streaming search', 'model-default', now, now);
    db.prepare(
      [
        'INSERT INTO messages (id, chat_id, role, sender_id, created_at, updated_at, content_final, stream_state)',
        'VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      ].join(' '),
    ).run(messageId, chatId, 'agent', 'agent-default', now, now, null, 'streaming');

    const beforeResponse = await searchGet(
      createRequest('http://localhost/api/v1/search?q=complete&scope=messages'),
    );
    const beforeBody = await beforeResponse.json();
    expect(beforeBody.messages).toEqual([]);

    db.prepare('UPDATE messages SET content_final = ?, stream_state = ? WHERE id = ?').run(
      'streaming complete text',
      'complete',
      messageId,
    );

    const afterResponse = await searchGet(
      createRequest('http://localhost/api/v1/search?q=complete&scope=messages'),
    );
    const afterBody = await afterResponse.json();

    expect(afterResponse.status).toBe(200);
    expect(afterBody.messages).toHaveLength(1);
    expect(afterBody.messages[0].id).toBe(messageId);
  });

  it('returns validation errors for missing q and invalid scope', async () => {
    const missingQuery = await searchGet(createRequest('http://localhost/api/v1/search?scope=titles'));
    expect(missingQuery.status).toBe(400);
    await expect(missingQuery.json()).resolves.toEqual({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'q is required.',
        details: { field: 'q' },
      },
    });

    const invalidScope = await searchGet(createRequest('http://localhost/api/v1/search?q=hello&scope=bad'));
    expect(invalidScope.status).toBe(400);
    await expect(invalidScope.json()).resolves.toEqual({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'scope must be one of all, titles, messages.',
        details: { field: 'scope' },
      },
    });
  });

  it('returns validation error for malformed fts query syntax', async () => {
    const now = Date.now();
    db.prepare(
      'INSERT INTO chats (id, title, model_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
    ).run('eeeeeeeeeeeeeeeeeeeee', 'Malformed fts test', 'model-default', now, now);
    db.prepare(
      [
        'INSERT INTO messages (id, chat_id, role, sender_id, created_at, updated_at, content_final, stream_state)',
        'VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      ].join(' '),
    ).run(
      'fffffffffffffffffffff',
      'eeeeeeeeeeeeeeeeeeeee',
      'agent',
      'agent-default',
      now,
      now,
      'seed text',
      'complete',
    );

    const response = await searchGet(
      createRequest('http://localhost/api/v1/search?q=foo%20AND&scope=messages'),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Invalid full-text search query.',
        details: { field: 'q' },
      },
    });
  });
});
