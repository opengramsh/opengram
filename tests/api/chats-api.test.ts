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

  it('rate limits write endpoints and returns retry-after header', async () => {
    const created = await createChat({ title: 'rate-limit-target' });
    const chatId = created.json.id as string;

    let rateLimitedResponse: Response | null = null;
    for (let i = 0; i < 150; i += 1) {
      const response = await archivePost(
        createJsonRequest(`http://localhost/api/v1/chats/${chatId}/archive`, 'POST'),
        routeContext(chatId),
      );
      if (response.status === 429) {
        rateLimitedResponse = response;
        break;
      }
    }

    expect(rateLimitedResponse).not.toBeNull();
    expect(rateLimitedResponse?.headers.get('Retry-After')).toBeTypeOf('string');
    const body = await rateLimitedResponse!.json();
    expect(body.error.code).toBe('RATE_LIMITED');
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
