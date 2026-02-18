import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { GET as chatGet } from '@/app/api/v1/chats/[chatId]/route';
import { GET as chatRequestsGet } from '@/app/api/v1/chats/[chatId]/requests/route';
import { POST as chatsPost } from '@/app/api/v1/chats/route';
import { POST as resolveRequestPost } from '@/app/api/v1/requests/[requestId]/resolve/route';
import { resetWriteRateLimitForTests } from '@/src/api/write-controls';

type ChatContext = {
  params: Promise<{ chatId: string }>;
};

type RequestContext = {
  params: Promise<{ requestId: string }>;
};

const repoRoot = join(import.meta.dirname, '..', '..');
const migrationSql = readFileSync(join(repoRoot, 'drizzle', '0000_initial.sql'), 'utf8');

let db: Database.Database;

function chatContext(chatId: string): ChatContext {
  return { params: Promise.resolve({ chatId }) };
}

function requestContext(requestId: string): RequestContext {
  return { params: Promise.resolve({ requestId }) };
}

function createJsonRequest(url: string, method: string, body?: unknown) {
  return new Request(url, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

beforeEach(() => {
  const tempDir = mkdtempSync(join(tmpdir(), 'opengram-requests-api-'));
  const dbPath = join(tempDir, 'test.db');

  process.env.DATABASE_URL = dbPath;
  db = new Database(dbPath);
  db.exec(migrationSql);
  resetWriteRateLimitForTests();
});

afterEach(() => {
  db.close();
  delete process.env.DATABASE_URL;
  resetWriteRateLimitForTests();
});

describe('requests API', () => {
  it('lists pending requests for a chat', async () => {
    const chatResponse = await chatsPost(
      createJsonRequest('http://localhost/api/v1/chats', 'POST', {
        title: 'requests-chat',
        agentIds: ['agent-default'],
        modelId: 'model-default',
      }),
    );

    const chat = await chatResponse.json();
    const now = Date.now();

    db.prepare(
      [
        'INSERT INTO requests (id, chat_id, type, status, title, body, config, created_at)',
        'VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      ].join(' '),
    ).run('111111111111111111111', chat.id, 'choice', 'pending', 'Approve?', 'Pick one', JSON.stringify({ options: [{ id: 'yes', label: 'Yes' }] }), now);

    const response = await chatRequestsGet(
      createJsonRequest(`http://localhost/api/v1/chats/${chat.id}/requests?status=pending`, 'GET'),
      chatContext(chat.id),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toHaveLength(1);
    expect(body.data[0]).toMatchObject({
      id: '111111111111111111111',
      type: 'choice',
      status: 'pending',
      title: 'Approve?',
    });
  });

  it('resolves text_input requests and updates chat pending count', async () => {
    const chatResponse = await chatsPost(
      createJsonRequest('http://localhost/api/v1/chats', 'POST', {
        title: 'requests-chat',
        agentIds: ['agent-default'],
        modelId: 'model-default',
      }),
    );

    const chat = await chatResponse.json();
    const now = Date.now();

    db.prepare('UPDATE chats SET pending_requests_count = ? WHERE id = ?').run(1, chat.id);
    db.prepare(
      [
        'INSERT INTO requests (id, chat_id, type, status, title, config, created_at)',
        'VALUES (?, ?, ?, ?, ?, ?, ?)',
      ].join(' '),
    ).run('222222222222222222222', chat.id, 'text_input', 'pending', 'Need details', '{}', now);

    const resolveResponse = await resolveRequestPost(
      createJsonRequest('http://localhost/api/v1/requests/222222222222222222222/resolve', 'POST', { text: 'all set' }),
      requestContext('222222222222222222222'),
    );
    const resolveBody = await resolveResponse.json();

    expect(resolveResponse.status).toBe(200);
    expect(resolveBody.status).toBe('resolved');
    expect(resolveBody.resolution_payload).toEqual({ text: 'all set' });

    const chatAfterResponse = await chatGet(
      createJsonRequest(`http://localhost/api/v1/chats/${chat.id}`, 'GET'),
      chatContext(chat.id),
    );
    const chatAfter = await chatAfterResponse.json();

    expect(chatAfter.pending_requests_count).toBe(0);

    const event = db
      .prepare('SELECT type, payload FROM events ORDER BY created_at DESC LIMIT 1')
      .get() as { type: string; payload: string };
    expect(event.type).toBe('request.resolved');
    expect(JSON.parse(event.payload)).toMatchObject({
      chatId: chat.id,
      requestId: '222222222222222222222',
      type: 'text_input',
    });
  });

  it('returns not found when listing requests for an unknown chat', async () => {
    const response = await chatRequestsGet(
      createJsonRequest('http://localhost/api/v1/chats/missing-chat/requests?status=pending', 'GET'),
      chatContext('missing-chat'),
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: 'NOT_FOUND',
        message: 'Chat not found.',
        details: {
          chatId: 'missing-chat',
        },
      },
    });
  });
});
