import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { GET as configGet } from '@/app/api/v1/config/route';
import { GET as healthGet } from '@/app/api/v1/health/route';
import { GET as chatGet, PATCH as chatPatch } from '@/app/api/v1/chats/[chatId]/route';
import { POST as archivePost } from '@/app/api/v1/chats/[chatId]/archive/route';
import { POST as markReadPost } from '@/app/api/v1/chats/[chatId]/mark-read/route';
import { POST as markUnreadPost } from '@/app/api/v1/chats/[chatId]/mark-unread/route';
import { POST as unarchivePost } from '@/app/api/v1/chats/[chatId]/unarchive/route';
import { GET as chatsGet, POST as chatsPost } from '@/app/api/v1/chats/route';

const repoRoot = join(import.meta.dirname, '..', '..');
const migrationSql = readFileSync(join(repoRoot, 'drizzle', '0000_initial.sql'), 'utf8');

type Context = {
  params: Promise<{ chatId: string }>;
};

let db: Database.Database;

function routeContext(chatId: string): Context {
  return { params: Promise.resolve({ chatId }) };
}

function createJsonRequest(url: string, method: string, body?: unknown) {
  return new Request(url, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function createChat(body: Record<string, unknown> = {}) {
  const response = await chatsPost(
    createJsonRequest('http://localhost/api/v1/chats', 'POST', {
      agentIds: ['agent-default'],
      modelId: 'model-default',
      ...body,
    }),
  );

  const json = await response.json();
  return { response, json };
}

beforeEach(() => {
  const tempDir = mkdtempSync(join(tmpdir(), 'opengram-api-'));
  const dbPath = join(tempDir, 'test.db');

  process.env.DATABASE_URL = dbPath;
  db = new Database(dbPath);
  db.exec(migrationSql);
});

afterEach(() => {
  db.close();
  delete process.env.DATABASE_URL;
});

describe('chats API', () => {
  it('creates a chat and auto-generates title from first message', async () => {
    const { response, json } = await createChat({
      firstMessage: '   This is the first message title seed that should be trimmed and capped   ',
    });

    expect(response.status).toBe(201);
    expect(json.id).toBeTypeOf('string');
    expect(json.title.length).toBeLessThanOrEqual(48);
    expect(json.title).toContain('This is the first message');
    expect(json.unread_count).toBe(0);
  });

  it('returns validation error envelope for invalid create payload', async () => {
    const response = await chatsPost(
      createJsonRequest('http://localhost/api/v1/chats', 'POST', {
        agentIds: ['agent-default'],
        modelId: 'missing-model',
      }),
    );
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json).toEqual({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'modelId must match a configured model id.',
        details: { field: 'modelId' },
      },
    });
  });

  it('lists chats with cursor pagination', async () => {
    await createChat({ title: 'chat-1' });
    await createChat({ title: 'chat-2' });
    await createChat({ title: 'chat-3' });

    const page1Response = await chatsGet(
      createJsonRequest('http://localhost/api/v1/chats?limit=2', 'GET'),
    );
    const page1 = await page1Response.json();

    expect(page1Response.status).toBe(200);
    expect(page1.data).toHaveLength(2);
    expect(page1.cursor.hasMore).toBe(true);
    expect(page1.cursor.next).toBeTypeOf('string');

    const page2Response = await chatsGet(
      createJsonRequest(
        `http://localhost/api/v1/chats?limit=2&cursor=${encodeURIComponent(page1.cursor.next)}`,
        'GET',
      ),
    );
    const page2 = await page2Response.json();

    expect(page2Response.status).toBe(200);
    expect(page2.data).toHaveLength(1);
    expect(page2.cursor.hasMore).toBe(false);
    expect(page2.cursor.next).toBeNull();
  });

  it('gets and patches chat by id', async () => {
    const created = await createChat({ title: 'before', tags: ['alpha'] });
    const chatId = created.json.id as string;

    const getResponse = await chatGet(
      createJsonRequest(`http://localhost/api/v1/chats/${chatId}`, 'GET'),
      routeContext(chatId),
    );
    const getBody = await getResponse.json();

    expect(getResponse.status).toBe(200);
    expect(getBody.title).toBe('before');

    const patchResponse = await chatPatch(
      createJsonRequest(`http://localhost/api/v1/chats/${chatId}`, 'PATCH', {
        title: 'after',
        tags: ['beta'],
        pinned: true,
      }),
      routeContext(chatId),
    );
    const patched = await patchResponse.json();

    expect(patchResponse.status).toBe(200);
    expect(patched.title).toBe('after');
    expect(patched.tags).toEqual(['beta']);
    expect(patched.pinned).toBe(true);
  });

  it('supports archive, unarchive, mark-read and mark-unread actions', async () => {
    const created = await createChat({ title: 'actions' });
    const chatId = created.json.id as string;
    const now = Date.now();

    db.prepare(
      [
        'INSERT INTO messages (id, chat_id, role, sender_id, created_at, updated_at, content_final, stream_state)',
        'VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      ].join(' '),
    ).run('123456789012345678901', chatId, 'agent', 'agent-default', now, now, 'hello from agent', 'complete');

    db.prepare(
      [
        'INSERT INTO requests (id, chat_id, type, status, title, config, created_at)',
        'VALUES (?, ?, ?, ?, ?, ?, ?)',
      ].join(' '),
    ).run('123456789012345678902', chatId, 'text_input', 'pending', 'Need input', '{}', now);

    const archiveResponse = await archivePost(
      createJsonRequest(`http://localhost/api/v1/chats/${chatId}/archive`, 'POST'),
      routeContext(chatId),
    );
    expect(await archiveResponse.json()).toEqual({ ok: true });

    const unarchiveResponse = await unarchivePost(
      createJsonRequest(`http://localhost/api/v1/chats/${chatId}/unarchive`, 'POST'),
      routeContext(chatId),
    );
    expect(await unarchiveResponse.json()).toEqual({ ok: true });

    const unreadResponse = await markUnreadPost(
      createJsonRequest(`http://localhost/api/v1/chats/${chatId}/mark-unread`, 'POST'),
      routeContext(chatId),
    );
    expect(await unreadResponse.json()).toEqual({ ok: true });

    const readResponse = await markReadPost(
      createJsonRequest(`http://localhost/api/v1/chats/${chatId}/mark-read`, 'POST'),
      routeContext(chatId),
    );
    expect(await readResponse.json()).toEqual({ ok: true });

    const getResponse = await chatGet(
      createJsonRequest(`http://localhost/api/v1/chats/${chatId}`, 'GET'),
      routeContext(chatId),
    );
    const body = await getResponse.json();

    expect(body.is_archived).toBe(false);
    expect(body.last_message_preview).toBe('hello from agent');
    expect(body.last_message_role).toBe('agent');
    expect(body.pending_requests_count).toBe(1);
    expect(body.unread_count).toBe(0);
  });

  it('returns not found envelope for unknown chat', async () => {
    const response = await chatGet(
      createJsonRequest('http://localhost/api/v1/chats/missing', 'GET'),
      routeContext('missing'),
    );
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.error.code).toBe('NOT_FOUND');
  });
});

describe('system endpoints', () => {
  it('returns health payload', async () => {
    const response = await healthGet();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.status).toBe('ok');
    expect(body.version).toBeTypeOf('string');
    expect(body.uptime).toBeTypeOf('number');
  });

  it('returns safe config without secrets', async () => {
    const response = await configGet();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.security).toEqual({ instanceSecretEnabled: false });
    expect(body.push.vapidPrivateKey).toBeUndefined();
    expect(body.security.instanceSecret).toBeUndefined();
  });
});
