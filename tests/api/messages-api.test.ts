import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { GET as chatGet } from '@/app/api/v1/chats/[chatId]/route';
import { GET as messagesGet, POST as messagesPost } from '@/app/api/v1/chats/[chatId]/messages/route';
import { POST as messageCancelPost } from '@/app/api/v1/messages/[messageId]/cancel/route';
import { POST as messageChunksPost } from '@/app/api/v1/messages/[messageId]/chunks/route';
import { POST as messageCompletePost } from '@/app/api/v1/messages/[messageId]/complete/route';
import { POST as chatsPost } from '@/app/api/v1/chats/route';
import { resetWriteRateLimitForTests } from '@/src/api/write-controls';
import { resetEventSubscribersForTests, subscribeToEvents } from '@/src/services/events-service';
import { resetStreamingTimeoutSweeperForTests, sweepStaleStreamingMessages } from '@/src/services/messages-service';

type Context = {
  params: Promise<{ chatId: string }>;
};
type MessageContext = {
  params: Promise<{ messageId: string }>;
};

const repoRoot = join(import.meta.dirname, '..', '..');
const migrationSql = readFileSync(join(repoRoot, 'drizzle', '0000_initial.sql'), 'utf8');

let db: Database.Database;

function routeContext(chatId: string): Context {
  return { params: Promise.resolve({ chatId }) };
}

function messageRouteContext(messageId: string): MessageContext {
  return { params: Promise.resolve({ messageId }) };
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
  resetEventSubscribersForTests();
  resetStreamingTimeoutSweeperForTests();
});

afterEach(() => {
  db.close();
  delete process.env.DATABASE_URL;
  resetWriteRateLimitForTests();
  resetEventSubscribersForTests();
  resetStreamingTimeoutSweeperForTests();
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

    const event = db
      .prepare('SELECT type, payload FROM events ORDER BY created_at DESC LIMIT 1')
      .get() as { type: string; payload: string };
    expect(event.type).toBe('message.created');
    expect(JSON.parse(event.payload)).toMatchObject({
      chatId,
      messageId: body.id,
      role: 'agent',
      senderId: 'agent-default',
    });
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

  it('appends streaming chunks, bumps chat updated_at, and emits ephemeral chunk events', async () => {
    const createdChat = await createChat();
    const chatId = createdChat.json.id as string;
    const started = await messagesPost(
      createJsonRequest(`http://localhost/api/v1/chats/${chatId}/messages`, 'POST', {
        role: 'agent',
        senderId: 'agent-default',
        streaming: true,
      }),
      routeContext(chatId),
    );
    const startedMessage = await started.json();
    const messageId = startedMessage.id as string;

    const before = db
      .prepare('SELECT updated_at FROM chats WHERE id = ?')
      .get(chatId) as { updated_at: number };

    const seenEvents: Array<{ messageId: string; deltaText: string }> = [];
    const unsubscribe = subscribeToEvents(true, (event) => {
      if (event.type !== 'message.streaming.chunk') {
        return;
      }

      seenEvents.push({
        messageId: String(event.payload.messageId),
        deltaText: String(event.payload.deltaText),
      });
    });

    const firstChunk = await messageChunksPost(
      createJsonRequest(`http://localhost/api/v1/messages/${messageId}/chunks`, 'POST', {
        deltaText: 'hello ',
      }),
      messageRouteContext(messageId),
    );
    const secondChunk = await messageChunksPost(
      createJsonRequest(`http://localhost/api/v1/messages/${messageId}/chunks`, 'POST', {
        deltaText: 'world',
      }),
      messageRouteContext(messageId),
    );
    unsubscribe();

    expect(firstChunk.status).toBe(200);
    expect(secondChunk.status).toBe(200);
    await expect(secondChunk.json()).resolves.toMatchObject({
      id: messageId,
      content_partial: 'hello world',
      stream_state: 'streaming',
    });

    const row = db
      .prepare('SELECT content_partial FROM messages WHERE id = ?')
      .get(messageId) as { content_partial: string };
    expect(row.content_partial).toBe('hello world');

    const after = db
      .prepare('SELECT updated_at FROM chats WHERE id = ?')
      .get(chatId) as { updated_at: number };
    expect(after.updated_at).toBeGreaterThanOrEqual(before.updated_at);

    expect(seenEvents).toEqual([
      { messageId, deltaText: 'hello ' },
      { messageId, deltaText: 'world' },
    ]);

    const persistedChunkCount = (
      db.prepare('SELECT COUNT(*) as count FROM events WHERE type = ?').get('message.streaming.chunk') as { count: number }
    ).count;
    expect(persistedChunkCount).toBe(0);
  });

  it('completes a streaming message, updates chat timestamps, and indexes final text', async () => {
    const createdChat = await createChat();
    const chatId = createdChat.json.id as string;
    const started = await messagesPost(
      createJsonRequest(`http://localhost/api/v1/chats/${chatId}/messages`, 'POST', {
        role: 'agent',
        senderId: 'agent-default',
        streaming: true,
      }),
      routeContext(chatId),
    );
    const startedMessage = await started.json();
    const messageId = startedMessage.id as string;

    await messageChunksPost(
      createJsonRequest(`http://localhost/api/v1/messages/${messageId}/chunks`, 'POST', {
        deltaText: 'partial completion',
      }),
      messageRouteContext(messageId),
    );

    const beforeChat = db
      .prepare('SELECT updated_at, last_message_at FROM chats WHERE id = ?')
      .get(chatId) as { updated_at: number; last_message_at: number | null };

    const response = await messageCompletePost(
      createJsonRequest(`http://localhost/api/v1/messages/${messageId}/complete`, 'POST'),
      messageRouteContext(messageId),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      id: messageId,
      stream_state: 'complete',
      content_final: 'partial completion',
      content_partial: null,
    });

    const afterChat = db
      .prepare('SELECT updated_at, last_message_at, last_message_preview FROM chats WHERE id = ?')
      .get(chatId) as { updated_at: number; last_message_at: number; last_message_preview: string | null };
    expect(afterChat.updated_at).toBeGreaterThanOrEqual(beforeChat.updated_at);
    expect(afterChat.last_message_at).toBeGreaterThanOrEqual(beforeChat.last_message_at ?? 0);
    expect(afterChat.last_message_preview).toBe('partial completion');

    const fts = db
      .prepare('SELECT content_final FROM messages_fts WHERE message_id = ?')
      .get(messageId) as { content_final: string } | undefined;
    expect(fts?.content_final).toBe('partial completion');

    const event = db
      .prepare('SELECT type, payload FROM events WHERE type = ? ORDER BY rowid DESC LIMIT 1')
      .get('message.streaming.complete') as { type: string; payload: string };
    expect(event.type).toBe('message.streaming.complete');
    expect(JSON.parse(event.payload)).toMatchObject({
      chatId,
      messageId,
      streamState: 'complete',
      finalText: 'partial completion',
    });
  });

  it('cancels a streaming message and emits completion event with cancelled state', async () => {
    const createdChat = await createChat();
    const chatId = createdChat.json.id as string;
    const started = await messagesPost(
      createJsonRequest(`http://localhost/api/v1/chats/${chatId}/messages`, 'POST', {
        role: 'agent',
        senderId: 'agent-default',
        streaming: true,
      }),
      routeContext(chatId),
    );
    const startedMessage = await started.json();
    const messageId = startedMessage.id as string;

    await messageChunksPost(
      createJsonRequest(`http://localhost/api/v1/messages/${messageId}/chunks`, 'POST', {
        deltaText: 'cancel me',
      }),
      messageRouteContext(messageId),
    );

    const response = await messageCancelPost(
      createJsonRequest(`http://localhost/api/v1/messages/${messageId}/cancel`, 'POST'),
      messageRouteContext(messageId),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      id: messageId,
      stream_state: 'cancelled',
      content_partial: 'cancel me',
      content_final: null,
    });

    const event = db
      .prepare('SELECT type, payload FROM events WHERE type = ? ORDER BY rowid DESC LIMIT 1')
      .get('message.streaming.complete') as { type: string; payload: string };
    expect(event.type).toBe('message.streaming.complete');
    expect(JSON.parse(event.payload)).toMatchObject({
      chatId,
      messageId,
      streamState: 'cancelled',
      finalText: null,
    });
  });

  it('rejects stream lifecycle operations when message is not in streaming state', async () => {
    const createdChat = await createChat();
    const chatId = createdChat.json.id as string;
    const created = await messagesPost(
      createJsonRequest(`http://localhost/api/v1/chats/${chatId}/messages`, 'POST', {
        role: 'agent',
        senderId: 'agent-default',
        content: 'already complete',
      }),
      routeContext(chatId),
    );
    const createdMessage = await created.json();
    const messageId = createdMessage.id as string;

    const chunkResponse = await messageChunksPost(
      createJsonRequest(`http://localhost/api/v1/messages/${messageId}/chunks`, 'POST', {
        deltaText: 'late chunk',
      }),
      messageRouteContext(messageId),
    );

    expect(chunkResponse.status).toBe(409);
    await expect(chunkResponse.json()).resolves.toEqual({
      error: {
        code: 'CONFLICT',
        message: 'Message is not in streaming state.',
        details: {
          messageId,
          streamState: 'complete',
        },
      },
    });
  });

  it('auto-cancels stale streaming messages and emits completion events', async () => {
    const createdChat = await createChat();
    const chatId = createdChat.json.id as string;
    const started = await messagesPost(
      createJsonRequest(`http://localhost/api/v1/chats/${chatId}/messages`, 'POST', {
        role: 'agent',
        senderId: 'agent-default',
        streaming: true,
      }),
      routeContext(chatId),
    );
    const startedMessage = await started.json();
    const messageId = startedMessage.id as string;

    const staleUpdatedAt = Date.now() - 65_000;
    db.prepare('UPDATE messages SET updated_at = ? WHERE id = ?').run(staleUpdatedAt, messageId);

    const result = sweepStaleStreamingMessages(Date.now());
    expect(result.cancelledMessageIds).toContain(messageId);

    const message = db
      .prepare('SELECT stream_state FROM messages WHERE id = ?')
      .get(messageId) as { stream_state: string };
    expect(message.stream_state).toBe('cancelled');

    const event = db
      .prepare('SELECT type, payload FROM events WHERE type = ? ORDER BY rowid DESC LIMIT 1')
      .get('message.streaming.complete') as { type: string; payload: string };
    expect(event.type).toBe('message.streaming.complete');
    expect(JSON.parse(event.payload)).toMatchObject({
      chatId,
      messageId,
      streamState: 'cancelled',
    });
  });
});
