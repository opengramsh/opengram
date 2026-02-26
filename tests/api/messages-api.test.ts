import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { app } from '@/src/server';
import { closeDb, resetDbForTests } from '@/src/db/client';
import { resetWriteRateLimitForTests } from '@/src/api/write-controls';
import { resetEventSubscribersForTests, subscribeToEvents } from '@/src/services/events-service';
import { resetStreamingTimeoutSweeperForTests, sweepStaleStreamingMessages } from '@/src/services/messages-service';
import { resetConfigCacheForTests } from '@/src/config/opengram-config';

const repoRoot = join(import.meta.dirname, '..', '..');
const migrationSql = readFileSync(join(repoRoot, 'migrations', '0000_initial.sql'), 'utf8');

let db: Database.Database;

async function createChat() {
  const response = await app.request('/api/v1/chats', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      title: 'messages-chat',
      agentIds: ['agent-default'],
      modelId: 'model-default',
    }),
  });

  const json = await response.json();
  return { response, json };
}

beforeEach(() => {
  const tempDir = mkdtempSync(join(tmpdir(), 'opengram-messages-api-'));
  const dbPath = join(tempDir, 'test.db');

  process.env.DATABASE_URL = dbPath;
  db = new Database(dbPath);
  db.exec(migrationSql);
  resetDbForTests();
  resetWriteRateLimitForTests();
  resetEventSubscribersForTests();
  resetStreamingTimeoutSweeperForTests();

  // Disable auth for tests — create a temp config with instanceSecretEnabled=false
  const baseConfig = JSON.parse(readFileSync(join(repoRoot, 'config', 'opengram.config.json'), 'utf8'));
  baseConfig.security = {
    ...baseConfig.security,
    instanceSecretEnabled: false,
    readEndpointsRequireInstanceSecret: false,
  };
  const configPath = join(tempDir, 'opengram.config.json');
  writeFileSync(configPath, JSON.stringify(baseConfig), 'utf8');
  process.env.OPENGRAM_CONFIG_PATH = configPath;
  resetConfigCacheForTests();
});

afterEach(() => {
  closeDb();
  db.close();
  delete process.env.DATABASE_URL;
  delete process.env.OPENGRAM_CONFIG_PATH;
  resetWriteRateLimitForTests();
  resetEventSubscribersForTests();
  resetStreamingTimeoutSweeperForTests();
  resetConfigCacheForTests();
});

describe('messages API', () => {
  it('creates a non-streaming message, snapshots chat model, updates chat metadata, and updates FTS', async () => {
    const createdChat = await createChat();
    const chatId = createdChat.json.id as string;

    const response = await app.request('/api/v1/chats/' + chatId + '/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        role: 'agent',
        senderId: 'agent-default',
        content: 'hello from the model snapshot path',
        modelId: 'ignored-by-snapshot',
        trace: { backend: 'test' },
      }),
    });
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.model_id).toBe('model-default');
    expect(body.stream_state).toBe('complete');
    expect(body.content_final).toBe('hello from the model snapshot path');
    expect(body.trace).toEqual({ backend: 'test' });

    const chatResponse = await app.request('/api/v1/chats/' + chatId, {
      method: 'GET',
    });
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

    const response = await app.request('/api/v1/chats/' + chatId + '/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        role: 'agent',
        senderId: 'agent-default',
        streaming: true,
      }),
    });

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

  it('creates a media-only voice note message and denormalizes preview to Voice note', async () => {
    const createdChat = await createChat();
    const chatId = createdChat.json.id as string;
    const now = Date.now();

    db.prepare(
      [
        'INSERT INTO media (',
        'id, chat_id, message_id, storage_path, thumbnail_path, filename, content_type, byte_size, kind, created_at',
        ') VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      ].join(' '),
    ).run(
      'VMEDIA000000000000001',
      chatId,
      null,
      `uploads/${chatId}/voice-media-001.webm`,
      null,
      'voice-note.webm',
      'audio/webm',
      1024,
      'audio',
      now,
    );

    const response = await app.request('/api/v1/chats/' + chatId + '/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        role: 'user',
        senderId: 'user:primary',
        trace: { mediaId: 'VMEDIA000000000000001', kind: 'audio' },
      }),
    });
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.content_final).toBeNull();
    expect(body.trace).toEqual({ mediaId: 'VMEDIA000000000000001', kind: 'audio' });

    const chatResponse = await app.request('/api/v1/chats/' + chatId, {
      method: 'GET',
    });
    const chat = await chatResponse.json();
    expect(chat.last_message_preview).toBe('Voice note');
    expect(chat.last_message_role).toBe('user');

    const linkedMedia = db
      .prepare('SELECT message_id FROM media WHERE id = ?')
      .get('VMEDIA000000000000001') as { message_id: string | null };
    expect(linkedMedia.message_id).toBe(body.id);
  });

  it('rejects invalid senderId for role agent', async () => {
    const createdChat = await createChat();
    const chatId = createdChat.json.id as string;

    const response = await app.request('/api/v1/chats/' + chatId + '/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        role: 'agent',
        senderId: 'agent-missing',
        content: 'bad sender',
      }),
    });

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

    const response = await app.request('/api/v1/chats/' + chatId + '/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        role: 'user',
        senderId: 'user:primary',
        streaming: true,
      }),
    });

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

    const page1Response = await app.request('/api/v1/chats/' + chatId + '/messages?limit=2', {
      method: 'GET',
    });
    const page1 = await page1Response.json();

    expect(page1Response.status).toBe(200);
    expect(page1.data).toHaveLength(2);
    expect(page1.data[0].id).toBe('333333333333333333333');
    expect(page1.data[1].id).toBe('222222222222222222222');
    expect(page1.cursor.hasMore).toBe(true);
    expect(page1.cursor.next).toBeTypeOf('string');

    const page2Response = await app.request(
      '/api/v1/chats/' + chatId + '/messages?limit=2&cursor=' + encodeURIComponent(page1.cursor.next),
      {
        method: 'GET',
      },
    );
    const page2 = await page2Response.json();

    expect(page2Response.status).toBe(200);
    expect(page2.data).toHaveLength(1);
    expect(page2.data[0].id).toBe('111111111111111111111');
    expect(page2.cursor.hasMore).toBe(false);
    expect(page2.cursor.next).toBeNull();
  });

  it('accepts limit=200 for message listing', async () => {
    const createdChat = await createChat();
    const chatId = createdChat.json.id as string;

    const response = await app.request('/api/v1/chats/' + chatId + '/messages?limit=200', {
      method: 'GET',
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toEqual([]);
    expect(body.cursor).toEqual({
      next: null,
      hasMore: false,
    });
  });

  it('returns not found for unknown chat', async () => {
    const response = await app.request('/api/v1/chats/missing/messages', {
      method: 'GET',
    });

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
    const started = await app.request('/api/v1/chats/' + chatId + '/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        role: 'agent',
        senderId: 'agent-default',
        streaming: true,
      }),
    });
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

    const firstChunk = await app.request('/api/v1/messages/' + messageId + '/chunks', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        deltaText: 'hello ',
      }),
    });
    const secondChunk = await app.request('/api/v1/messages/' + messageId + '/chunks', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        deltaText: 'world',
      }),
    });
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
    const started = await app.request('/api/v1/chats/' + chatId + '/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        role: 'agent',
        senderId: 'agent-default',
        streaming: true,
      }),
    });
    const startedMessage = await started.json();
    const messageId = startedMessage.id as string;

    await app.request('/api/v1/messages/' + messageId + '/chunks', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        deltaText: 'partial completion',
      }),
    });

    const beforeChat = db
      .prepare('SELECT updated_at, last_message_at FROM chats WHERE id = ?')
      .get(chatId) as { updated_at: number; last_message_at: number | null };

    const response = await app.request('/api/v1/messages/' + messageId + '/complete', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
    });

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
    const started = await app.request('/api/v1/chats/' + chatId + '/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        role: 'agent',
        senderId: 'agent-default',
        streaming: true,
      }),
    });
    const startedMessage = await started.json();
    const messageId = startedMessage.id as string;

    await app.request('/api/v1/messages/' + messageId + '/chunks', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        deltaText: 'cancel me',
      }),
    });

    const beforeChat = db
      .prepare('SELECT updated_at, last_message_at FROM chats WHERE id = ?')
      .get(chatId) as { updated_at: number; last_message_at: number | null };

    const response = await app.request('/api/v1/messages/' + messageId + '/cancel', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      id: messageId,
      stream_state: 'cancelled',
      content_partial: 'cancel me',
      content_final: null,
    });

    const afterChat = db
      .prepare('SELECT updated_at, last_message_at FROM chats WHERE id = ?')
      .get(chatId) as { updated_at: number; last_message_at: number | null };
    expect(afterChat.updated_at).toBeGreaterThanOrEqual(beforeChat.updated_at);
    expect(afterChat.last_message_at).toBe(beforeChat.last_message_at);

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

  it('rejects chunk and finalize writes after stream state has transitioned', async () => {
    const createdChat = await createChat();
    const chatId = createdChat.json.id as string;
    const started = await app.request('/api/v1/chats/' + chatId + '/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        role: 'agent',
        senderId: 'agent-default',
        streaming: true,
      }),
    });
    const startedMessage = await started.json();
    const messageId = startedMessage.id as string;

    await app.request('/api/v1/messages/' + messageId + '/chunks', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        deltaText: 'locked',
      }),
    });

    const completeResponse = await app.request('/api/v1/messages/' + messageId + '/complete', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
    });
    expect(completeResponse.status).toBe(200);

    const lateChunk = await app.request('/api/v1/messages/' + messageId + '/chunks', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        deltaText: ' should-not-append',
      }),
    });
    expect(lateChunk.status).toBe(409);
    await expect(lateChunk.json()).resolves.toEqual({
      error: {
        code: 'CONFLICT',
        message: 'Message is not in streaming state.',
        details: {
          messageId,
          streamState: 'complete',
        },
      },
    });

    const lateCancel = await app.request('/api/v1/messages/' + messageId + '/cancel', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
    });
    expect(lateCancel.status).toBe(409);

    const message = db
      .prepare('SELECT content_final, content_partial, stream_state FROM messages WHERE id = ?')
      .get(messageId) as { content_final: string | null; content_partial: string | null; stream_state: string };
    expect(message).toEqual({
      content_final: 'locked',
      content_partial: null,
      stream_state: 'complete',
    });
  });

  it('rejects stream lifecycle operations when message is not in streaming state', async () => {
    const createdChat = await createChat();
    const chatId = createdChat.json.id as string;
    const created = await app.request('/api/v1/chats/' + chatId + '/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        role: 'agent',
        senderId: 'agent-default',
        content: 'already complete',
      }),
    });
    const createdMessage = await created.json();
    const messageId = createdMessage.id as string;

    const chunkResponse = await app.request('/api/v1/messages/' + messageId + '/chunks', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        deltaText: 'late chunk',
      }),
    });

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

  it('excludes cancelled messages with no content from listing (KAI-216)', async () => {
    // Create chat and messages directly via SQL to avoid API auth dependency
    const chatId = 'kai216test00000000001'; // exactly 21 chars (nanoid format)
    const now = Date.now();
    db.prepare(
      [
        'INSERT INTO chats (id, title, agent_ids, model_id, created_at, updated_at)',
        'VALUES (?, ?, ?, ?, ?, ?)',
      ].join(' '),
    ).run(chatId, 'KAI-216 test chat', '["agent-default"]', 'model-default', now, now);

    // Insert a normal complete message
    db.prepare(
      [
        'INSERT INTO messages (id, chat_id, role, sender_id, created_at, updated_at, content_final, content_partial, stream_state, model_id)',
        'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      ].join(' '),
    ).run('VISIBLE_MSG_000000001', chatId, 'agent', 'agent-default', now - 1000, now - 1000, 'visible message', null, 'complete', 'model-default');

    // Insert a cancelled message with no content (simulates sweeper auto-cancel
    // of an eagerly-created streaming message that never received content)
    db.prepare(
      [
        'INSERT INTO messages (id, chat_id, role, sender_id, created_at, updated_at, content_final, content_partial, stream_state, model_id)',
        'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      ].join(' '),
    ).run('CANCELLED_EMPTY_00001', chatId, 'agent', 'agent-default', now, now, null, null, 'cancelled', 'model-default');

    const response = await app.request('/api/v1/chats/' + chatId + '/messages', {
      method: 'GET',
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    // The cancelled empty message should NOT appear in the listing
    const messageIds = body.data.map((m: { id: string }) => m.id);
    expect(messageIds).not.toContain('CANCELLED_EMPTY_00001');
    expect(body.data).toHaveLength(1);
    expect(body.data[0].content_final).toBe('visible message');
  });

  it('auto-cancels stale streaming messages and emits completion events', async () => {
    const createdChat = await createChat();
    const chatId = createdChat.json.id as string;
    const started = await app.request('/api/v1/chats/' + chatId + '/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        role: 'agent',
        senderId: 'agent-default',
        streaming: true,
      }),
    });
    const startedMessage = await started.json();
    const messageId = startedMessage.id as string;

    const staleUpdatedAt = Date.now() - 65_000;
    db.prepare('UPDATE messages SET updated_at = ? WHERE id = ?').run(staleUpdatedAt, messageId);
    const beforeChat = db
      .prepare('SELECT updated_at FROM chats WHERE id = ?')
      .get(chatId) as { updated_at: number };

    const result = sweepStaleStreamingMessages(Date.now());
    expect(result.cancelledMessageIds).toContain(messageId);

    const message = db
      .prepare('SELECT stream_state FROM messages WHERE id = ?')
      .get(messageId) as { stream_state: string };
    expect(message.stream_state).toBe('cancelled');

    const afterChat = db
      .prepare('SELECT updated_at FROM chats WHERE id = ?')
      .get(chatId) as { updated_at: number };
    expect(afterChat.updated_at).toBeGreaterThanOrEqual(beforeChat.updated_at);

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

  it('POST /cancel-streaming bulk-cancels all streaming messages for a chat', async () => {
    const chatId = 'cstrmBulkChat00000A00';
    const now = Date.now();

    db.prepare(
      "INSERT INTO chats (id, title, agent_ids, model_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
    ).run(chatId, 'cancel-streaming test', '["agent-default"]', 'model-default', now, now);

    db.prepare(
      'INSERT INTO messages (id, chat_id, role, sender_id, created_at, updated_at, content_final, content_partial, stream_state, model_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    ).run('cstrmStreamMsg0000A10', chatId, 'agent', 'agent-default', now, now, null, null, 'streaming', 'model-default');

    db.prepare(
      'INSERT INTO messages (id, chat_id, role, sender_id, created_at, updated_at, content_final, content_partial, stream_state, model_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    ).run('cstrmStreamMsg0000A20', chatId, 'agent', 'agent-default', now, now, null, null, 'streaming', 'model-default');

    db.prepare(
      'INSERT INTO messages (id, chat_id, role, sender_id, created_at, updated_at, content_final, content_partial, stream_state, model_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    ).run('cstrmNormalMsg0000A30', chatId, 'agent', 'agent-default', now, now, 'Normal message', null, 'complete', 'model-default');

    const response = await app.request('/api/v1/chats/' + chatId + '/messages/cancel-streaming', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.cancelledMessageIds).toHaveLength(2);
    expect(body.cancelledMessageIds).toContain('cstrmStreamMsg0000A10');
    expect(body.cancelledMessageIds).toContain('cstrmStreamMsg0000A20');

    const row1 = db.prepare('SELECT stream_state FROM messages WHERE id = ?').get('cstrmStreamMsg0000A10') as { stream_state: string };
    expect(row1.stream_state).toBe('cancelled');

    const row2 = db.prepare('SELECT stream_state FROM messages WHERE id = ?').get('cstrmStreamMsg0000A20') as { stream_state: string };
    expect(row2.stream_state).toBe('cancelled');

    const rowNormal = db.prepare('SELECT stream_state FROM messages WHERE id = ?').get('cstrmNormalMsg0000A30') as { stream_state: string };
    expect(rowNormal.stream_state).toBe('complete');
  });

  it('POST /cancel-streaming returns empty array when no streaming messages', async () => {
    const chatId = 'cstrmEmptyChat00000B0';
    const now = Date.now();

    db.prepare(
      "INSERT INTO chats (id, title, agent_ids, model_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
    ).run(chatId, 'empty cancel test', '["agent-default"]', 'model-default', now, now);

    const response = await app.request('/api/v1/chats/' + chatId + '/messages/cancel-streaming', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.cancelledMessageIds).toEqual([]);
  });

  it('POST /cancel-streaming returns 404 for unknown chat', async () => {
    const response = await app.request('/api/v1/chats/nonexistentChatId0XX0/messages/cancel-streaming', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
    });

    expect(response.status).toBe(404);
  });

  it('POST /cancel-streaming emits streaming.complete events', async () => {
    const chatId = 'cstrmEventChat00000C0';
    const now = Date.now();

    db.prepare(
      "INSERT INTO chats (id, title, agent_ids, model_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
    ).run(chatId, 'events cancel test', '["agent-default"]', 'model-default', now, now);

    db.prepare(
      'INSERT INTO messages (id, chat_id, role, sender_id, created_at, updated_at, content_final, content_partial, stream_state, model_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    ).run('cstrmEventMsg0000C100', chatId, 'agent', 'agent-default', now, now, null, null, 'streaming', 'model-default');

    const seenEvents: Array<{ messageId: string; streamState: string }> = [];
    const unsubscribe = subscribeToEvents(false, (event) => {
      if (event.type === 'message.streaming.complete') {
        seenEvents.push({
          messageId: String(event.payload.messageId),
          streamState: String(event.payload.streamState),
        });
      }
    });

    await app.request('/api/v1/chats/' + chatId + '/messages/cancel-streaming', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
    });
    unsubscribe();

    expect(seenEvents).toEqual([
      { messageId: 'cstrmEventMsg0000C100', streamState: 'cancelled' },
    ]);
  });
});
