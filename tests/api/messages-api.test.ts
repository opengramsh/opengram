import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { GET as chatGet } from '@/app/api/v1/chats/[chatId]/route';
import { GET as messagesGet, POST as messagesPost } from '@/app/api/v1/chats/[chatId]/messages/route';
import { POST as chatsPost } from '@/app/api/v1/chats/route';
import { resetWriteRateLimitForTests } from '@/src/api/write-controls';

type Context = {
  params: Promise<{ chatId: string }>;
};

const repoRoot = join(import.meta.dirname, '..', '..');
const migrationSql = readFileSync(join(repoRoot, 'drizzle', '0000_initial.sql'), 'utf8');

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

async function createChat() {
  const response = await chatsPost(
    createJsonRequest('http://localhost/api/v1/chats', 'POST', {
      title: 'messages-chat',
      agentIds: ['agent-default'],
      modelId: 'model-default',
    }),
  );

  const json = await response.json();
  return { response, json };
}

beforeEach(() => {
  const tempDir = mkdtempSync(join(tmpdir(), 'opengram-messages-api-'));
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

describe('messages API', () => {
  it('creates a non-streaming message, snapshots chat model, updates chat metadata, and updates FTS', async () => {
    const createdChat = await createChat();
    const chatId = createdChat.json.id as string;

    const response = await messagesPost(
      createJsonRequest(`http://localhost/api/v1/chats/${chatId}/messages`, 'POST', {
        role: 'agent',
        senderId: 'agent-default',
        content: 'hello from the model snapshot path',
        modelId: 'ignored-by-snapshot',
        trace: { backend: 'test' },
      }),
      routeContext(chatId),
    );
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.model_id).toBe('model-default');
    expect(body.stream_state).toBe('complete');
    expect(body.content_final).toBe('hello from the model snapshot path');
    expect(body.trace).toEqual({ backend: 'test' });

    const chatResponse = await chatGet(
      createJsonRequest(`http://localhost/api/v1/chats/${chatId}`, 'GET'),
      routeContext(chatId),
    );
    const chat = await chatResponse.json();

    expect(chat.last_message_preview).toBe('hello from the model snapshot path');
    expect(chat.last_message_role).toBe('agent');
    expect(chat.last_message_at).toBeTypeOf('string');
    expect(chat.unread_count).toBe(1);

    const fts = db
      .prepare('SELECT content_final FROM messages_fts WHERE message_id = ?')
      .get(body.id) as { content_final: string } | undefined;

    expect(fts?.content_final).toBe('hello from the model snapshot path');
  });

  it('creates a streaming-start message', async () => {
    const createdChat = await createChat();
    const chatId = createdChat.json.id as string;

    const response = await messagesPost(
      createJsonRequest(`http://localhost/api/v1/chats/${chatId}/messages`, 'POST', {
        role: 'agent',
        senderId: 'agent-default',
        streaming: true,
      }),
      routeContext(chatId),
    );

    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.stream_state).toBe('streaming');
    expect(body.content_final).toBeNull();
    expect(body.content_partial).toBeNull();
    expect(body.model_id).toBe('model-default');

    const fts = db.prepare('SELECT message_id FROM messages_fts WHERE message_id = ?').get(body.id) as
      | { message_id: string }
      | undefined;

    expect(fts).toBeUndefined();
  });

  it('rejects invalid senderId for role agent', async () => {
    const createdChat = await createChat();
    const chatId = createdChat.json.id as string;

    const response = await messagesPost(
      createJsonRequest(`http://localhost/api/v1/chats/${chatId}/messages`, 'POST', {
        role: 'agent',
        senderId: 'agent-missing',
        content: 'bad sender',
      }),
      routeContext(chatId),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'senderId must match a configured agent id for role agent.',
        details: {
          field: 'senderId',
        },
      },
    });
  });

  it('rejects streaming requests when role is not agent', async () => {
    const createdChat = await createChat();
    const chatId = createdChat.json.id as string;

    const response = await messagesPost(
      createJsonRequest(`http://localhost/api/v1/chats/${chatId}/messages`, 'POST', {
        role: 'user',
        senderId: 'user:primary',
        streaming: true,
      }),
      routeContext(chatId),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'streaming start is only supported for role agent.',
        details: {
          field: 'streaming',
        },
      },
    });
  });

  it('lists messages with cursor pagination ordered by created_at desc and id desc', async () => {
    const createdChat = await createChat();
    const chatId = createdChat.json.id as string;

    db.prepare(
      [
        'INSERT INTO messages (id, chat_id, role, sender_id, created_at, updated_at, content_final, stream_state, model_id)',
        'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      ].join(' '),
    ).run('111111111111111111111', chatId, 'agent', 'agent-default', 1000, 1000, 'm1', 'complete', 'model-default');
    db.prepare(
      [
        'INSERT INTO messages (id, chat_id, role, sender_id, created_at, updated_at, content_final, stream_state, model_id)',
        'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      ].join(' '),
    ).run('222222222222222222222', chatId, 'agent', 'agent-default', 2000, 2000, 'm2', 'complete', 'model-default');
    db.prepare(
      [
        'INSERT INTO messages (id, chat_id, role, sender_id, created_at, updated_at, content_final, stream_state, model_id)',
        'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      ].join(' '),
    ).run('333333333333333333333', chatId, 'agent', 'agent-default', 2000, 2000, 'm3', 'complete', 'model-default');

    const page1Response = await messagesGet(
      createJsonRequest(`http://localhost/api/v1/chats/${chatId}/messages?limit=2`, 'GET'),
      routeContext(chatId),
    );
    const page1 = await page1Response.json();

    expect(page1Response.status).toBe(200);
    expect(page1.data).toHaveLength(2);
    expect(page1.data[0].id).toBe('333333333333333333333');
    expect(page1.data[1].id).toBe('222222222222222222222');
    expect(page1.cursor.hasMore).toBe(true);
    expect(page1.cursor.next).toBeTypeOf('string');

    const page2Response = await messagesGet(
      createJsonRequest(
        `http://localhost/api/v1/chats/${chatId}/messages?limit=2&cursor=${encodeURIComponent(page1.cursor.next)}`,
        'GET',
      ),
      routeContext(chatId),
    );
    const page2 = await page2Response.json();

    expect(page2Response.status).toBe(200);
    expect(page2.data).toHaveLength(1);
    expect(page2.data[0].id).toBe('111111111111111111111');
    expect(page2.cursor.hasMore).toBe(false);
    expect(page2.cursor.next).toBeNull();
  });

  it('returns not found for unknown chat', async () => {
    const response = await messagesGet(
      createJsonRequest('http://localhost/api/v1/chats/missing/messages', 'GET'),
      routeContext('missing'),
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: 'NOT_FOUND',
        message: 'Chat not found.',
        details: {
          chatId: 'missing',
        },
      },
    });
  });
});
