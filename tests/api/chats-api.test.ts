import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
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
import { GET as messagesGet } from '@/app/api/v1/chats/[chatId]/messages/route';
import { POST as unarchivePost } from '@/app/api/v1/chats/[chatId]/unarchive/route';
import { GET as pendingSummaryGet } from '@/app/api/v1/chats/pending-summary/route';
import { GET as chatsGet, POST as chatsPost } from '@/app/api/v1/chats/route';
import { resetWriteRateLimitForTests } from '@/src/api/write-controls';

const repoRoot = join(import.meta.dirname, '..', '..');
const migrationSql = readFileSync(join(repoRoot, 'drizzle', '0000_initial.sql'), 'utf8');

type Context = {
  params: Promise<{ chatId: string }>;
};

let db: Database.Database;
let previousConfigPath: string | undefined;

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

function createJsonRequestWithHeaders(
  url: string,
  method: string,
  body: unknown | undefined,
  headers: Record<string, string>,
) {
  return new Request(url, {
    method,
    headers: {
      'content-type': 'application/json',
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

function setInstanceSecretConfig(secret: string) {
  setConfigOverrides({
    security: {
      instanceSecretEnabled: true,
      instanceSecret: secret,
    },
  });
}

function setConfigOverrides(overrides: { security?: Record<string, unknown>; server?: Record<string, unknown> }) {
  const baseConfig = JSON.parse(readFileSync(join(repoRoot, 'config', 'opengram.config.json'), 'utf8'));
  const tempDir = mkdtempSync(join(tmpdir(), 'opengram-config-'));
  const configPath = join(tempDir, 'opengram.config.json');

  if (overrides.security) {
    baseConfig.security = {
      ...baseConfig.security,
      ...overrides.security,
    };
  }

  if (overrides.server) {
    baseConfig.server = {
      ...baseConfig.server,
      ...overrides.server,
    };
  }

  writeFileSync(configPath, JSON.stringify(baseConfig), 'utf8');
  process.env.OPENGRAM_CONFIG_PATH = configPath;
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
  previousConfigPath = process.env.OPENGRAM_CONFIG_PATH;
  db = new Database(dbPath);
  db.exec(migrationSql);
  resetWriteRateLimitForTests();
});

afterEach(() => {
  db.close();
  delete process.env.DATABASE_URL;
  delete process.env.OPENGRAM_WRITE_RATE_LIMIT_MAX;
  delete process.env.OPENGRAM_WRITE_RATE_LIMIT_WINDOW_MS;
  delete process.env.OPENGRAM_TRUST_PROXY_HEADERS;
  if (previousConfigPath === undefined) {
    delete process.env.OPENGRAM_CONFIG_PATH;
  } else {
    process.env.OPENGRAM_CONFIG_PATH = previousConfigPath;
  }
  resetWriteRateLimitForTests();
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

  it('persists first message as an initial user message', async () => {
    const firstMessage = 'hello from the new chat form';
    const created = await createChat({ firstMessage });
    const chatId = created.json.id as string;

    const messagesResponse = await messagesGet(
      createJsonRequest(`http://localhost/api/v1/chats/${chatId}/messages?limit=10`, 'GET'),
      routeContext(chatId),
    );
    const messagesBody = await messagesResponse.json();

    expect(messagesResponse.status).toBe(200);
    expect(messagesBody.data).toHaveLength(1);
    expect(messagesBody.data[0].role).toBe('user');
    expect(messagesBody.data[0].sender_id).toBe('user:primary');
    expect(messagesBody.data[0].content_final).toBe(firstMessage);
  });

  it('trims first message content before persisting initial message', async () => {
    const created = await createChat({ firstMessage: '   hello from api client   ' });
    const chatId = created.json.id as string;

    const messagesResponse = await messagesGet(
      createJsonRequest(`http://localhost/api/v1/chats/${chatId}/messages?limit=10`, 'GET'),
      routeContext(chatId),
    );
    const messagesBody = await messagesResponse.json();

    expect(messagesResponse.status).toBe(200);
    expect(messagesBody.data).toHaveLength(1);
    expect(messagesBody.data[0].content_final).toBe('hello from api client');
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

  it('uses last_message_at ordering so metadata-only updates do not reorder inbox', async () => {
    const firstChat = await createChat({ title: 'first' });
    const secondChat = await createChat({ title: 'second' });
    const firstChatId = firstChat.json.id as string;
    const secondChatId = secondChat.json.id as string;
    const now = Date.now();

    db.prepare(
      [
        'INSERT INTO messages (id, chat_id, role, sender_id, created_at, updated_at, content_final, stream_state)',
        'VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      ].join(' '),
    ).run('123456789012345678903', firstChatId, 'agent', 'agent-default', now - 10_000, now - 10_000, 'older', 'complete');
    db.prepare(
      [
        'INSERT INTO messages (id, chat_id, role, sender_id, created_at, updated_at, content_final, stream_state)',
        'VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      ].join(' '),
    ).run('123456789012345678904', secondChatId, 'agent', 'agent-default', now - 1_000, now - 1_000, 'newer', 'complete');

    await markUnreadPost(
      createJsonRequest(`http://localhost/api/v1/chats/${firstChatId}/mark-unread`, 'POST'),
      routeContext(firstChatId),
    );
    await markUnreadPost(
      createJsonRequest(`http://localhost/api/v1/chats/${secondChatId}/mark-unread`, 'POST'),
      routeContext(secondChatId),
    );

    await markReadPost(
      createJsonRequest(`http://localhost/api/v1/chats/${firstChatId}/mark-read`, 'POST'),
      routeContext(firstChatId),
    );

    const listResponse = await chatsGet(createJsonRequest('http://localhost/api/v1/chats?limit=2', 'GET'));
    const listBody = await listResponse.json();
    expect(listBody.data.map((chat: { id: string }) => chat.id)).toEqual([secondChatId, firstChatId]);

    const page1Response = await chatsGet(createJsonRequest('http://localhost/api/v1/chats?limit=1', 'GET'));
    const page1 = await page1Response.json();
    const page2Response = await chatsGet(
      createJsonRequest(
        `http://localhost/api/v1/chats?limit=1&cursor=${encodeURIComponent(page1.cursor.next)}`,
        'GET',
      ),
    );
    const page2 = await page2Response.json();

    expect(page1.data[0].id).toBe(secondChatId);
    expect(page2.data[0].id).toBe(firstChatId);
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

  it('emits chat lifecycle events for create, update, archive, read, and unread actions', async () => {
    const created = await createChat({
      title: 'lifecycle',
      firstMessage: 'hello lifecycle',
    });
    const chatId = created.json.id as string;

    await chatPatch(
      createJsonRequest(`http://localhost/api/v1/chats/${chatId}`, 'PATCH', {
        title: 'lifecycle-updated',
      }),
      routeContext(chatId),
    );
    await archivePost(
      createJsonRequest(`http://localhost/api/v1/chats/${chatId}/archive`, 'POST'),
      routeContext(chatId),
    );
    await unarchivePost(
      createJsonRequest(`http://localhost/api/v1/chats/${chatId}/unarchive`, 'POST'),
      routeContext(chatId),
    );
    await markUnreadPost(
      createJsonRequest(`http://localhost/api/v1/chats/${chatId}/mark-unread`, 'POST'),
      routeContext(chatId),
    );
    await markReadPost(
      createJsonRequest(`http://localhost/api/v1/chats/${chatId}/mark-read`, 'POST'),
      routeContext(chatId),
    );

    const rows = db
      .prepare('SELECT type, payload FROM events ORDER BY rowid ASC')
      .all() as Array<{ type: string; payload: string }>;
    const chatTypes = rows
      .filter((row) => {
        const payload = JSON.parse(row.payload) as { chatId?: string };
        return payload.chatId === chatId;
      })
      .map((row) => row.type);

    expect(chatTypes).toContain('chat.created');
    expect(chatTypes).toContain('chat.updated');
    expect(chatTypes).toContain('chat.archived');
    expect(chatTypes).toContain('chat.unarchived');
    expect(chatTypes).toContain('chat.unread');
    expect(chatTypes).toContain('chat.read');
    expect(chatTypes).toContain('message.created');
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

  it('recalculates Voice note preview for audio-only last messages', async () => {
    const created = await createChat({ title: 'voice-preview' });
    const chatId = created.json.id as string;
    const now = Date.now();
    const messageId = 'VMSG00000000000000001';
    const mediaId = 'VMEDIA000000000000002';

    db.prepare(
      [
        'INSERT INTO messages (',
        'id, chat_id, role, sender_id, created_at, updated_at, content_final, content_partial, stream_state, model_id, trace',
        ') VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      ].join(' '),
    ).run(
      messageId,
      chatId,
      'user',
      'user:primary',
      now,
      now,
      null,
      null,
      'complete',
      'model-default',
      JSON.stringify({ mediaId, kind: 'audio' }),
    );

    db.prepare(
      [
        'INSERT INTO media (',
        'id, chat_id, message_id, storage_path, thumbnail_path, filename, content_type, byte_size, kind, created_at',
        ') VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      ].join(' '),
    ).run(
      mediaId,
      chatId,
      messageId,
      `uploads/${chatId}/${mediaId}.webm`,
      null,
      'voice-note.webm',
      'audio/webm',
      1024,
      'audio',
      now,
    );

    const patchResponse = await chatPatch(
      createJsonRequest(`http://localhost/api/v1/chats/${chatId}`, 'PATCH', {
        title: 'voice-preview-updated',
      }),
      routeContext(chatId),
    );
    const patched = await patchResponse.json();

    expect(patchResponse.status).toBe(200);
    expect(patched.last_message_preview).toBe('Voice note');
    expect(patched.last_message_role).toBe('user');
  });

  it('counts unread messages for all non-user roles', async () => {
    const created = await createChat({ title: 'non-user unread' });
    const chatId = created.json.id as string;
    const now = Date.now();

    db.prepare(
      [
        'INSERT INTO messages (id, chat_id, role, sender_id, created_at, updated_at, content_final, stream_state)',
        'VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      ].join(' '),
    ).run('123456789012345678905', chatId, 'system', 'system', now, now, 'system note', 'complete');

    await markUnreadPost(
      createJsonRequest(`http://localhost/api/v1/chats/${chatId}/mark-unread`, 'POST'),
      routeContext(chatId),
    );

    const getResponse = await chatGet(
      createJsonRequest(`http://localhost/api/v1/chats/${chatId}`, 'GET'),
      routeContext(chatId),
    );
    const body = await getResponse.json();

    expect(body.unread_count).toBe(1);
  });

  it('rejects non-object JSON bodies', async () => {
    const response = await chatsPost(createJsonRequest('http://localhost/api/v1/chats', 'POST', null));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.message).toBe('JSON body must be an object.');
  });

  it('rejects non-string firstMessage values', async () => {
    const response = await chatsPost(
      createJsonRequest('http://localhost/api/v1/chats', 'POST', {
        agentIds: ['agent-default'],
        modelId: 'model-default',
        firstMessage: 123,
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.details).toEqual({ field: 'firstMessage' });
  });

  it('replays idempotent creates and rejects key reuse with different payloads', async () => {
    const firstResponse = await chatsPost(
      new Request('http://localhost/api/v1/chats', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'idempotency-key': 'chat-create-key',
        },
        body: JSON.stringify({
          agentIds: ['agent-default'],
          modelId: 'model-default',
          title: 'same',
        }),
      }),
    );
    const firstBody = await firstResponse.json();

    const replayResponse = await chatsPost(
      new Request('http://localhost/api/v1/chats', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'idempotency-key': 'chat-create-key',
        },
        body: JSON.stringify({
          agentIds: ['agent-default'],
          modelId: 'model-default',
          title: 'same',
        }),
      }),
    );
    const replayBody = await replayResponse.json();

    expect(replayResponse.status).toBe(201);
    expect(replayBody.id).toBe(firstBody.id);

    const conflictResponse = await chatsPost(
      new Request('http://localhost/api/v1/chats', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'idempotency-key': 'chat-create-key',
        },
        body: JSON.stringify({
          agentIds: ['agent-default'],
          modelId: 'model-default',
          title: 'different',
        }),
      }),
    );
    const conflictBody = await conflictResponse.json();

    expect(conflictResponse.status).toBe(409);
    expect(conflictBody.error.code).toBe('CONFLICT');
  });

  it('replays idempotent creates for semantically identical payloads with different key order', async () => {
    const firstResponse = await chatsPost(
      new Request('http://localhost/api/v1/chats', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'idempotency-key': 'chat-canonical-key',
        },
        body: JSON.stringify({
          agentIds: ['agent-default'],
          modelId: 'model-default',
          tags: ['ops'],
          title: 'canonical',
        }),
      }),
    );
    const firstBody = await firstResponse.json();

    const replayResponse = await chatsPost(
      new Request('http://localhost/api/v1/chats', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'idempotency-key': 'chat-canonical-key',
        },
        body: JSON.stringify({
          title: 'canonical',
          tags: ['ops'],
          modelId: 'model-default',
          agentIds: ['agent-default'],
        }),
      }),
    );
    const replayBody = await replayResponse.json();

    expect(firstResponse.status).toBe(201);
    expect(replayResponse.status).toBe(201);
    expect(replayBody.id).toBe(firstBody.id);
  });

  it('returns validation error when Idempotency-Key header is empty', async () => {
    const response = await chatsPost(
      new Request('http://localhost/api/v1/chats', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'idempotency-key': '   ',
        },
        body: JSON.stringify({
          agentIds: ['agent-default'],
          modelId: 'model-default',
          title: 'invalid-key',
        }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toEqual({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Idempotency-Key cannot be empty.',
        details: {
          field: 'Idempotency-Key',
        },
      },
    });
  });

  it('handles concurrent idempotent create without duplicate side effects', async () => {
    const requestFactory = () => new Request('http://localhost/api/v1/chats', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'idempotency-key': 'chat-create-concurrent',
      },
      body: JSON.stringify({
        agentIds: ['agent-default'],
        modelId: 'model-default',
        title: 'same',
      }),
    });

    const [responseA, responseB] = await Promise.all([chatsPost(requestFactory()), chatsPost(requestFactory())]);
    const bodyA = await responseA.json();
    const bodyB = await responseB.json();

    expect(responseA.status).toBe(201);
    expect(responseB.status).toBe(201);
    expect(bodyA.id).toBe(bodyB.id);

    const countRow = db.prepare('SELECT COUNT(*) AS count FROM chats').get() as { count: number };
    expect(countRow.count).toBe(1);
  });

  it('prunes idempotency keys using configurable ttl from config', async () => {
    setConfigOverrides({
      server: {
        idempotencyTtlSeconds: 1,
      },
    });

    const staleResponse = JSON.stringify({
      state: 'completed',
      requestHash: 'stale-request-hash',
      responseBody: { id: 'stale-chat-id' },
    });

    db.prepare(
      'INSERT INTO idempotency_keys (key, response, status_code, created_at) VALUES (?, ?, ?, ?)',
    ).run('ttl-key', staleResponse, 201, Date.now() - 10_000);

    const response = await chatsPost(
      new Request('http://localhost/api/v1/chats', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'idempotency-key': 'ttl-key',
        },
        body: JSON.stringify({
          agentIds: ['agent-default'],
          modelId: 'model-default',
          title: 'fresh',
        }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.id).not.toBe('stale-chat-id');
  });

  it('enforces write bearer auth when instance secret is enabled', async () => {
    setInstanceSecretConfig('s3cret');

    const unauthorized = await chatsPost(
      createJsonRequest('http://localhost/api/v1/chats', 'POST', {
        agentIds: ['agent-default'],
        modelId: 'model-default',
      }),
    );
    const unauthorizedBody = await unauthorized.json();

    expect(unauthorized.status).toBe(401);
    expect(unauthorizedBody.error.code).toBe('UNAUTHORIZED');

    const authorized = await chatsPost(
      new Request('http://localhost/api/v1/chats', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: 'Bearer s3cret',
        },
        body: JSON.stringify({
          agentIds: ['agent-default'],
          modelId: 'model-default',
        }),
      }),
    );

    expect(authorized.status).toBe(201);
  });

  it('does not enforce read bearer auth when read toggle is disabled', async () => {
    setInstanceSecretConfig('s3cret');

    const response = await chatsGet(
      createJsonRequest('http://localhost/api/v1/chats?limit=5', 'GET'),
    );
    expect(response.status).toBe(200);
  });

  it('enforces read bearer auth when read toggle is enabled', async () => {
    setConfigOverrides({
      security: {
        instanceSecretEnabled: true,
        instanceSecret: 's3cret',
        readEndpointsRequireInstanceSecret: true,
      },
    });

    const unauthorized = await chatsGet(
      createJsonRequest('http://localhost/api/v1/chats?limit=5', 'GET'),
    );
    expect(unauthorized.status).toBe(401);
    await expect(unauthorized.json()).resolves.toEqual({
      error: {
        code: 'UNAUTHORIZED',
        message: 'Missing or invalid instance secret.',
        details: undefined,
      },
    });

    const invalidSecret = await chatsGet(
      createJsonRequestWithHeaders('http://localhost/api/v1/chats?limit=5', 'GET', undefined, {
        authorization: 'Bearer not-the-secret',
      }),
    );
    expect(invalidSecret.status).toBe(401);

    const authorized = await chatsGet(
      createJsonRequestWithHeaders('http://localhost/api/v1/chats?limit=5', 'GET', undefined, {
        authorization: 'Bearer s3cret',
      }),
    );
    expect(authorized.status).toBe(200);
  });

  it('does not enforce read bearer auth when instance secret auth is disabled', async () => {
    setConfigOverrides({
      security: {
        instanceSecretEnabled: false,
        instanceSecret: '',
        readEndpointsRequireInstanceSecret: true,
      },
    });

    const response = await chatsGet(
      createJsonRequest('http://localhost/api/v1/chats?limit=5', 'GET'),
    );
    expect(response.status).toBe(200);
  });

  it('rate limits write endpoints per IP and returns retry-after header', async () => {
    process.env.OPENGRAM_WRITE_RATE_LIMIT_MAX = '2';
    process.env.OPENGRAM_WRITE_RATE_LIMIT_WINDOW_MS = '1000';
    process.env.OPENGRAM_TRUST_PROXY_HEADERS = 'true';
    const created = await createChat({ title: 'rate-limit-target' });
    const chatId = created.json.id as string;

    let rateLimitedResponse: Response | null = null;
    for (let i = 0; i < 3; i += 1) {
      const response = await archivePost(
        createJsonRequestWithHeaders(
          `http://localhost/api/v1/chats/${chatId}/archive`,
          'POST',
          {},
          { 'x-forwarded-for': '192.168.0.1' },
        ),
        routeContext(chatId),
      );
      if (response.status === 429) {
        rateLimitedResponse = response;
        break;
      }
    }

    expect(rateLimitedResponse).not.toBeNull();
    expect(Number(rateLimitedResponse?.headers.get('Retry-After'))).toBeGreaterThanOrEqual(1);
    const body = await rateLimitedResponse!.json();
    expect(body.error.code).toBe('RATE_LIMITED');

    const differentIpResponse = await archivePost(
      createJsonRequestWithHeaders(
        `http://localhost/api/v1/chats/${chatId}/archive`,
        'POST',
        {},
        { 'x-forwarded-for': '192.168.0.2' },
      ),
      routeContext(chatId),
    );
    expect(differentIpResponse.status).toBe(200);
  });

  it('resets write rate limit after the configured window elapses', async () => {
    process.env.OPENGRAM_WRITE_RATE_LIMIT_MAX = '1';
    process.env.OPENGRAM_WRITE_RATE_LIMIT_WINDOW_MS = '50';
    process.env.OPENGRAM_TRUST_PROXY_HEADERS = 'true';
    const created = await createChat({ title: 'window-rollover-target' });
    const chatId = created.json.id as string;

    const first = await archivePost(
      createJsonRequestWithHeaders(
        `http://localhost/api/v1/chats/${chatId}/archive`,
        'POST',
        {},
        { 'x-forwarded-for': '198.51.100.10' },
      ),
      routeContext(chatId),
    );
    expect(first.status).toBe(200);

    const limited = await archivePost(
      createJsonRequestWithHeaders(
        `http://localhost/api/v1/chats/${chatId}/archive`,
        'POST',
        {},
        { 'x-forwarded-for': '198.51.100.10' },
      ),
      routeContext(chatId),
    );
    expect(limited.status).toBe(429);

    await sleep(80);

    const afterWindow = await archivePost(
      createJsonRequestWithHeaders(
        `http://localhost/api/v1/chats/${chatId}/archive`,
        'POST',
        {},
        { 'x-forwarded-for': '198.51.100.10' },
      ),
      routeContext(chatId),
    );
    expect(afterWindow.status).toBe(200);
  });

  it('does not apply write rate limits to read endpoints', async () => {
    process.env.OPENGRAM_WRITE_RATE_LIMIT_MAX = '1';
    process.env.OPENGRAM_WRITE_RATE_LIMIT_WINDOW_MS = '1000';
    process.env.OPENGRAM_TRUST_PROXY_HEADERS = 'true';

    for (let i = 0; i < 5; i += 1) {
      const response = await chatsGet(
        createJsonRequestWithHeaders('http://localhost/api/v1/chats?limit=2', 'GET', undefined, {
          'x-forwarded-for': '203.0.113.25',
        }),
      );
      expect(response.status).toBe(200);
      expect(response.headers.get('Retry-After')).toBeNull();
    }
  });

  it('falls back to default rate-limit config when decimal env values floor below one', async () => {
    process.env.OPENGRAM_WRITE_RATE_LIMIT_MAX = '0.5';
    process.env.OPENGRAM_WRITE_RATE_LIMIT_WINDOW_MS = '0.5';
    process.env.OPENGRAM_TRUST_PROXY_HEADERS = 'true';
    const created = await createChat({ title: 'decimal-rate-limit-env-fallback' });
    const chatId = created.json.id as string;

    let rateLimited = false;
    for (let i = 0; i < 3; i += 1) {
      const response = await archivePost(
        createJsonRequestWithHeaders(
          `http://localhost/api/v1/chats/${chatId}/archive`,
          'POST',
          {},
          { 'x-forwarded-for': '203.0.113.99' },
        ),
        routeContext(chatId),
      );
      if (response.status === 429) {
        rateLimited = true;
        break;
      }
    }

    expect(rateLimited).toBe(false);
  });

  it('uses instance fallback bucket when forwarded headers are untrusted', async () => {
    process.env.OPENGRAM_WRITE_RATE_LIMIT_MAX = '1';
    process.env.OPENGRAM_WRITE_RATE_LIMIT_WINDOW_MS = '1000';
    const created = await createChat({ title: 'untrusted-forwarded-header-target' });
    const chatId = created.json.id as string;
    resetWriteRateLimitForTests();

    const first = await archivePost(
      createJsonRequestWithHeaders(
        `http://localhost/api/v1/chats/${chatId}/archive`,
        'POST',
        {},
        { 'x-forwarded-for': '192.0.2.10' },
      ),
      routeContext(chatId),
    );
    const second = await archivePost(
      createJsonRequestWithHeaders(
        `http://localhost/api/v1/chats/${chatId}/archive`,
        'POST',
        {},
        { 'x-forwarded-for': '192.0.2.11' },
      ),
      routeContext(chatId),
    );

    expect(first.status).toBe(200);
    expect(second.status).toBe(429);
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

  it('returns global pending summary for inbox and excludes archived chats', async () => {
    const first = await createChat({ title: 'pending-open' });
    const second = await createChat({ title: 'pending-archived' });
    const firstChatId = first.json.id as string;
    const secondChatId = second.json.id as string;
    const now = Date.now();

    db.prepare(
      [
        'INSERT INTO requests (id, chat_id, type, status, title, config, created_at)',
        'VALUES (?, ?, ?, ?, ?, ?, ?)',
      ].join(' '),
    ).run('123456789012345678910', firstChatId, 'text_input', 'pending', 'Need decision', '{}', now);
    db.prepare(
      [
        'INSERT INTO requests (id, chat_id, type, status, title, config, created_at)',
        'VALUES (?, ?, ?, ?, ?, ?, ?)',
      ].join(' '),
    ).run('123456789012345678911', secondChatId, 'text_input', 'pending', 'Need archive decision', '{}', now);

    await markUnreadPost(
      createJsonRequest(`http://localhost/api/v1/chats/${firstChatId}/mark-unread`, 'POST'),
      routeContext(firstChatId),
    );
    await markUnreadPost(
      createJsonRequest(`http://localhost/api/v1/chats/${secondChatId}/mark-unread`, 'POST'),
      routeContext(secondChatId),
    );
    await archivePost(
      createJsonRequest(`http://localhost/api/v1/chats/${secondChatId}/archive`, 'POST'),
      routeContext(secondChatId),
    );

    const inboxSummaryResponse = await pendingSummaryGet(
      createJsonRequest('http://localhost/api/v1/chats/pending-summary?archived=false', 'GET'),
    );
    const inboxSummaryBody = await inboxSummaryResponse.json();
    expect(inboxSummaryResponse.status).toBe(200);
    expect(inboxSummaryBody.pending_requests_total).toBe(1);

    const allSummaryResponse = await pendingSummaryGet(
      createJsonRequest('http://localhost/api/v1/chats/pending-summary', 'GET'),
    );
    const allSummaryBody = await allSummaryResponse.json();
    expect(allSummaryBody.pending_requests_total).toBe(2);
  });
});

describe('system endpoints', () => {
  it('returns health payload', async () => {
    const response = await healthGet(new Request('http://localhost/api/v1/health'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.status).toBe('ok');
    expect(body.version).toBeTypeOf('string');
    expect(body.uptime).toBeTypeOf('number');
  });

  it('returns safe config without secrets', async () => {
    const response = await configGet(new Request('http://localhost/api/v1/config'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.security).toEqual({
      instanceSecretEnabled: false,
      readEndpointsRequireInstanceSecret: false,
    });
    expect(body.push.vapidPrivateKey).toBeUndefined();
    expect(body.security.instanceSecret).toBeUndefined();
  });

  it('keeps health public while enforcing read bearer auth for config when read toggle is enabled', async () => {
    setConfigOverrides({
      security: {
        instanceSecretEnabled: true,
        instanceSecret: 'system-secret',
        readEndpointsRequireInstanceSecret: true,
      },
    });

    const publicHealth = await healthGet(new Request('http://localhost/api/v1/health'));
    expect(publicHealth.status).toBe(200);

    const unauthorizedConfig = await configGet(new Request('http://localhost/api/v1/config'));
    expect(unauthorizedConfig.status).toBe(401);

    const authorizedConfig = await configGet(
      new Request('http://localhost/api/v1/config', {
        headers: { authorization: 'Bearer system-secret' },
      }),
    );
    expect(authorizedConfig.status).toBe(200);
  });
});
