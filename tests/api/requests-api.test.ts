import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { GET as chatGet } from '@/app/api/v1/chats/[chatId]/route';
import { GET as chatRequestsGet, POST as chatRequestsPost } from '@/app/api/v1/chats/[chatId]/requests/route';
import { POST as chatsPost } from '@/app/api/v1/chats/route';
import { POST as cancelRequestPost } from '@/app/api/v1/requests/[requestId]/cancel/route';
import { PATCH as requestPatch } from '@/app/api/v1/requests/[requestId]/route';
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

async function createChat(title = 'requests-chat') {
  const response = await chatsPost(
    createJsonRequest('http://localhost/api/v1/chats', 'POST', {
      title,
      agentIds: ['agent-default'],
      modelId: 'model-default',
    }),
  );
  return response.json() as Promise<{ id: string }>;
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
    const chat = await createChat();
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

  it('creates requests with idempotency, increments pending count, and emits event once', async () => {
    const chat = await createChat();

    const requestPayload = {
      type: 'choice',
      title: 'Approve deploy',
      body: 'Select outcome',
      config: {
        options: [
          { id: 'approve', label: 'Approve', variant: 'primary' },
          { id: 'reject', label: 'Reject', variant: 'danger' },
        ],
        minSelections: 1,
        maxSelections: 1,
      },
    };

    const firstCreateResponse = await chatRequestsPost(
      new Request(`http://localhost/api/v1/chats/${chat.id}/requests`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'idempotency-key': 'req-create-key',
        },
        body: JSON.stringify(requestPayload),
      }),
      chatContext(chat.id),
    );
    const firstCreate = await firstCreateResponse.json();

    const replayResponse = await chatRequestsPost(
      new Request(`http://localhost/api/v1/chats/${chat.id}/requests`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'idempotency-key': 'req-create-key',
        },
        body: JSON.stringify(requestPayload),
      }),
      chatContext(chat.id),
    );
    const replay = await replayResponse.json();

    expect(firstCreateResponse.status).toBe(201);
    expect(replayResponse.status).toBe(201);
    expect(replay.id).toBe(firstCreate.id);

    const chatAfterResponse = await chatGet(
      createJsonRequest(`http://localhost/api/v1/chats/${chat.id}`, 'GET'),
      chatContext(chat.id),
    );
    const chatAfter = await chatAfterResponse.json();

    expect(chatAfter.pending_requests_count).toBe(1);

    const requestCount = db
      .prepare('SELECT COUNT(*) AS count FROM requests WHERE chat_id = ?')
      .get(chat.id) as { count: number };
    expect(requestCount.count).toBe(1);

    const events = db
      .prepare('SELECT type, payload FROM events WHERE type = ? ORDER BY rowid ASC')
      .all('request.created') as Array<{ type: string; payload: string }>;
    expect(events).toHaveLength(1);
    expect(JSON.parse(events[0].payload)).toMatchObject({
      chatId: chat.id,
      requestId: firstCreate.id,
      type: 'choice',
      title: 'Approve deploy',
    });
  });

  it('returns conflict when idempotency key is reused with different create payload', async () => {
    const chat = await createChat();
    const url = `http://localhost/api/v1/chats/${chat.id}/requests`;

    await chatRequestsPost(
      new Request(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'idempotency-key': 'req-conflict-key',
        },
        body: JSON.stringify({
          type: 'text_input',
          title: 'Provide details',
          config: { placeholder: 'details' },
        }),
      }),
      chatContext(chat.id),
    );

    const response = await chatRequestsPost(
      new Request(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'idempotency-key': 'req-conflict-key',
        },
        body: JSON.stringify({
          type: 'text_input',
          title: 'Different payload',
          config: { placeholder: 'different' },
        }),
      }),
      chatContext(chat.id),
    );
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body).toEqual({
      error: {
        code: 'CONFLICT',
        message: 'Idempotency-Key already used with a different request payload.',
        details: {
          field: 'Idempotency-Key',
          key: 'req-conflict-key',
        },
      },
    });
  });

  it('returns conflict when the same idempotency key is reused across different chats', async () => {
    const firstChat = await createChat('requests-chat-a');
    const secondChat = await createChat('requests-chat-b');
    const requestPayload = {
      type: 'text_input',
      title: 'Provide details',
      config: { placeholder: 'details' },
    };

    const firstResponse = await chatRequestsPost(
      new Request(`http://localhost/api/v1/chats/${firstChat.id}/requests`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'idempotency-key': 'req-scope-key',
        },
        body: JSON.stringify(requestPayload),
      }),
      chatContext(firstChat.id),
    );
    const firstBody = await firstResponse.json();

    const secondResponse = await chatRequestsPost(
      new Request(`http://localhost/api/v1/chats/${secondChat.id}/requests`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'idempotency-key': 'req-scope-key',
        },
        body: JSON.stringify(requestPayload),
      }),
      chatContext(secondChat.id),
    );
    const secondBody = await secondResponse.json();

    expect(firstResponse.status).toBe(201);
    expect(secondResponse.status).toBe(409);
    expect(secondBody).toEqual({
      error: {
        code: 'CONFLICT',
        message: 'Idempotency-Key already used with a different request payload.',
        details: {
          field: 'Idempotency-Key',
          key: 'req-scope-key',
        },
      },
    });

    const firstCount = db
      .prepare('SELECT COUNT(*) AS count FROM requests WHERE chat_id = ?')
      .get(firstChat.id) as { count: number };
    const secondCount = db
      .prepare('SELECT COUNT(*) AS count FROM requests WHERE chat_id = ?')
      .get(secondChat.id) as { count: number };

    expect(firstCount.count).toBe(1);
    expect(secondCount.count).toBe(0);
  });

  it('patches requests and validates type-specific config updates', async () => {
    const chat = await createChat();
    const now = Date.now();

    db.prepare(
      [
        'INSERT INTO requests (id, chat_id, type, status, title, body, config, created_at)',
        'VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      ].join(' '),
    ).run(
      '333333333333333333333',
      chat.id,
      'choice',
      'pending',
      'Old title',
      'Old body',
      JSON.stringify({ options: [{ id: 'yes', label: 'Yes' }] }),
      now,
    );

    const invalidPatch = await requestPatch(
      createJsonRequest('http://localhost/api/v1/requests/333333333333333333333', 'PATCH', {
        config: { options: [] },
      }),
      requestContext('333333333333333333333'),
    );
    expect(invalidPatch.status).toBe(400);

    const patchResponse = await requestPatch(
      createJsonRequest('http://localhost/api/v1/requests/333333333333333333333', 'PATCH', {
        title: 'New title',
        body: null,
        config: {
          options: [
            { id: 'approve', label: 'Approve' },
            { id: 'reject', label: 'Reject' },
          ],
          minSelections: 1,
          maxSelections: 1,
        },
        trace: { backend: 'worker-a' },
      }),
      requestContext('333333333333333333333'),
    );
    const patched = await patchResponse.json();

    expect(patchResponse.status).toBe(200);
    expect(patched.title).toBe('New title');
    expect(patched.body).toBeNull();
    expect(patched.config).toMatchObject({
      minSelections: 1,
      maxSelections: 1,
      options: [
        { id: 'approve', label: 'Approve' },
        { id: 'reject', label: 'Reject' },
      ],
    });
    expect(patched.trace).toEqual({ backend: 'worker-a' });
  });

  it('resolves text_input requests and updates chat pending count', async () => {
    const chat = await createChat();
    const now = Date.now();

    db.prepare('UPDATE chats SET pending_requests_count = ? WHERE id = ?').run(1, chat.id);
    db.prepare(
      [
        'INSERT INTO requests (id, chat_id, type, status, title, config, created_at)',
        'VALUES (?, ?, ?, ?, ?, ?, ?)',
      ].join(' '),
    ).run(
      '222222222222222222222',
      chat.id,
      'text_input',
      'pending',
      'Need details',
      JSON.stringify({
        placeholder: 'details',
        validation: {
          minLength: 3,
        },
      }),
      now,
    );

    const invalidResolveResponse = await resolveRequestPost(
      createJsonRequest('http://localhost/api/v1/requests/222222222222222222222/resolve', 'POST', { text: 'ok' }),
      requestContext('222222222222222222222'),
    );
    expect(invalidResolveResponse.status).toBe(400);

    const resolveResponse = await resolveRequestPost(
      createJsonRequest('http://localhost/api/v1/requests/222222222222222222222/resolve', 'POST', {
        text: 'all set',
        resolvedBy: 'backend',
      }),
      requestContext('222222222222222222222'),
    );
    const resolveBody = await resolveResponse.json();

    expect(resolveResponse.status).toBe(200);
    expect(resolveBody.status).toBe('resolved');
    expect(resolveBody.resolution_payload).toEqual({ text: 'all set' });
    expect(resolveBody.resolved_by).toBe('backend');

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
      status: 'resolved',
      resolution_payload: { text: 'all set' },
      trace: null,
    });
  });

  it('does not let pending count go negative when resolving with drifted counter state', async () => {
    const chat = await createChat();
    const now = Date.now();

    db.prepare(
      [
        'INSERT INTO requests (id, chat_id, type, status, title, config, created_at)',
        'VALUES (?, ?, ?, ?, ?, ?, ?)',
      ].join(' '),
    ).run(
      '777777777777777777777',
      chat.id,
      'text_input',
      'pending',
      'Need details',
      JSON.stringify({ placeholder: 'details' }),
      now,
    );

    const resolveResponse = await resolveRequestPost(
      createJsonRequest('http://localhost/api/v1/requests/777777777777777777777/resolve', 'POST', {
        text: 'all set',
      }),
      requestContext('777777777777777777777'),
    );

    expect(resolveResponse.status).toBe(200);

    const chatAfterResponse = await chatGet(
      createJsonRequest(`http://localhost/api/v1/chats/${chat.id}`, 'GET'),
      chatContext(chat.id),
    );
    const chatAfter = await chatAfterResponse.json();

    expect(chatAfter.pending_requests_count).toBe(0);
  });

  it('rejects duplicate selectedOptionIds when resolving a choice request', async () => {
    const chat = await createChat();
    const now = Date.now();

    db.prepare('UPDATE chats SET pending_requests_count = ? WHERE id = ?').run(1, chat.id);
    db.prepare(
      [
        'INSERT INTO requests (id, chat_id, type, status, title, config, created_at)',
        'VALUES (?, ?, ?, ?, ?, ?, ?)',
      ].join(' '),
    ).run(
      '666666666666666666666',
      chat.id,
      'choice',
      'pending',
      'Pick one',
      JSON.stringify({
        options: [
          { id: 'approve', label: 'Approve' },
          { id: 'reject', label: 'Reject' },
        ],
        minSelections: 1,
        maxSelections: 2,
      }),
      now,
    );

    const response = await resolveRequestPost(
      createJsonRequest('http://localhost/api/v1/requests/666666666666666666666/resolve', 'POST', {
        selectedOptionIds: ['approve', 'approve'],
      }),
      requestContext('666666666666666666666'),
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toEqual({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'selectedOptionIds must be unique.',
        details: {
          field: 'selectedOptionIds',
        },
      },
    });
  });

  it('cancels pending requests, decrements count, and emits request.cancelled', async () => {
    const chat = await createChat();
    const now = Date.now();

    db.prepare('UPDATE chats SET pending_requests_count = ? WHERE id = ?').run(1, chat.id);
    db.prepare(
      [
        'INSERT INTO requests (id, chat_id, type, status, title, config, created_at)',
        'VALUES (?, ?, ?, ?, ?, ?, ?)',
      ].join(' '),
    ).run('444444444444444444444', chat.id, 'form', 'pending', 'Fill form', JSON.stringify({
      fields: [{ name: 'title', type: 'text', required: true }],
    }), now);

    const response = await cancelRequestPost(
      createJsonRequest('http://localhost/api/v1/requests/444444444444444444444/cancel', 'POST'),
      requestContext('444444444444444444444'),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.status).toBe('cancelled');

    const chatAfterResponse = await chatGet(
      createJsonRequest(`http://localhost/api/v1/chats/${chat.id}`, 'GET'),
      chatContext(chat.id),
    );
    const chatAfter = await chatAfterResponse.json();
    expect(chatAfter.pending_requests_count).toBe(0);

    const event = db
      .prepare('SELECT type, payload FROM events ORDER BY created_at DESC LIMIT 1')
      .get() as { type: string; payload: string };
    expect(event.type).toBe('request.cancelled');
    expect(JSON.parse(event.payload)).toMatchObject({
      chatId: chat.id,
      requestId: '444444444444444444444',
      type: 'form',
      status: 'cancelled',
      resolution_payload: null,
      trace: null,
    });
  });

  it('returns validation error when cancelling a non-pending request', async () => {
    const chat = await createChat();
    const now = Date.now();
    db.prepare(
      [
        'INSERT INTO requests (id, chat_id, type, status, title, config, created_at, resolved_at, resolved_by, resolution_payload)',
        'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      ].join(' '),
    ).run(
      '555555555555555555555',
      chat.id,
      'choice',
      'resolved',
      'Already done',
      JSON.stringify({ options: [{ id: 'yes', label: 'Yes' }] }),
      now,
      now,
      'user',
      JSON.stringify({ selectedOptionIds: ['yes'] }),
    );

    const response = await cancelRequestPost(
      createJsonRequest('http://localhost/api/v1/requests/555555555555555555555/cancel', 'POST'),
      requestContext('555555555555555555555'),
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toEqual({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Only pending requests can be cancelled.',
        details: {
          requestId: '555555555555555555555',
          status: 'resolved',
        },
      },
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
