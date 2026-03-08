import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { app } from '@/src/server';
import { resetConfigCacheForTests } from '@/src/config/opengram-config';
import { closeDb, getDb, resetDbForTests } from '@/src/db/client';
import { resetSqliteReadyForTests } from '@/src/db/migrations';
import {
  enqueueDispatchInputForUserMessage,
  resetDispatchServiceForTests,
  runDispatchBatchSchedulerIteration,
} from '@/src/services/dispatch-service';

const TEST_CONFIG = {
  appName: 'OpenGram',
  maxUploadBytes: 50_000_000,
  allowedMimeTypes: ['*/*'],
  titleMaxChars: 48,
  agents: [{ id: 'agent-default', name: 'Agent', description: 'test', defaultModelId: 'model-default' }],
  models: [{ id: 'model-default', name: 'Model', description: 'test' }],
  push: { enabled: false, vapidPublicKey: '', vapidPrivateKey: '', subject: '' },
  security: { instanceSecretEnabled: false, instanceSecret: '', readEndpointsRequireInstanceSecret: false },
  server: {
    publicBaseUrl: 'http://localhost:3333',
    port: 3333,
    streamTimeoutSeconds: 60,
    corsOrigins: [],
    idempotencyTtlSeconds: 86_400,
    dispatch: {
      mode: 'batched_sequential',
      batchDebounceMs: 0,
      typingGraceMs: 0,
      maxBatchWaitMs: 0,
      schedulerTickMs: 200,
      leaseMs: 30_000,
      heartbeatIntervalMs: 5_000,
      claimWaitMs: 10_000,
      retryBaseMs: 500,
      retryMaxMs: 30_000,
      maxAttempts: 8,
    },
  },
  hooks: [],
};

const CHAT_ID_1 = '123456789012345678901';
const CHAT_ID_2 = '123456789012345678902';

function seedChat(chatId: string) {
  const db = getDb();
  const now = Date.now();
  db.prepare(
    [
      'INSERT INTO chats (id, title, model_id, created_at, updated_at)',
      'VALUES (?, ?, ?, ?, ?)',
    ].join(' '),
  ).run(chatId, 'Dispatch API Chat', 'model-default', now, now);
}

beforeEach(() => {
  const tempDir = mkdtempSync(join(tmpdir(), 'opengram-dispatch-api-'));
  const dbPath = join(tempDir, 'test.db');
  const configPath = join(tempDir, 'opengram.config.json');

  writeFileSync(configPath, JSON.stringify(TEST_CONFIG), 'utf8');
  process.env.DATABASE_URL = dbPath;
  process.env.OPENGRAM_CONFIG_PATH = configPath;

  resetDbForTests();
  resetSqliteReadyForTests();
  resetConfigCacheForTests();
  resetDispatchServiceForTests();
  getDb();
});

afterEach(() => {
  closeDb();
  resetDbForTests();
  resetSqliteReadyForTests();
  resetConfigCacheForTests();
  resetDispatchServiceForTests();
  delete process.env.DATABASE_URL;
  delete process.env.OPENGRAM_CONFIG_PATH;
});

describe('dispatch API', () => {
  it('claims, heartbeats, completes, and then returns 204 when queue is empty', async () => {
    seedChat(CHAT_ID_1);
    enqueueDispatchInputForUserMessage({
      chatId: CHAT_ID_1,
      messageId: 'msg-1',
      senderId: 'user:primary',
      content: 'hello',
      trace: null,
    });
    runDispatchBatchSchedulerIteration(Date.now());

    const claimResponse = await app.request('/api/v1/dispatch/claim', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        workerId: 'worker-1',
        leaseMs: 30_000,
        waitMs: 0,
      }),
    });

    expect(claimResponse.status).toBe(200);
    const claimed = await claimResponse.json() as { batchId: string; chatId: string; compiledContent: string };
    expect(claimed.chatId).toBe(CHAT_ID_1);
    expect(claimed.compiledContent).toContain('hello');

    const heartbeatResponse = await app.request(`/api/v1/dispatch/${claimed.batchId}/heartbeat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        workerId: 'worker-1',
        extendMs: 30_000,
      }),
    });
    expect(heartbeatResponse.status).toBe(204);

    const completeResponse = await app.request(`/api/v1/dispatch/${claimed.batchId}/complete`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        workerId: 'worker-1',
      }),
    });
    expect(completeResponse.status).toBe(204);

    const emptyClaim = await app.request('/api/v1/dispatch/claim', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        workerId: 'worker-1',
        waitMs: 0,
      }),
    });
    expect(emptyClaim.status).toBe(204);
  });

  it('returns 409 when another worker tries to complete a leased batch', async () => {
    seedChat(CHAT_ID_2);
    enqueueDispatchInputForUserMessage({
      chatId: CHAT_ID_2,
      messageId: 'msg-2',
      senderId: 'user:primary',
      content: 'hi',
      trace: null,
    });
    runDispatchBatchSchedulerIteration(Date.now());

    const claimResponse = await app.request('/api/v1/dispatch/claim', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        workerId: 'worker-a',
        waitMs: 0,
      }),
    });
    const claimed = await claimResponse.json() as { batchId: string };

    const wrongWorkerComplete = await app.request(`/api/v1/dispatch/${claimed.batchId}/complete`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        workerId: 'worker-b',
      }),
    });
    expect(wrongWorkerComplete.status).toBe(409);
  });

  it('claims multiple batches via /claim-many', async () => {
    seedChat(CHAT_ID_1);
    seedChat(CHAT_ID_2);
    enqueueDispatchInputForUserMessage({
      chatId: CHAT_ID_1,
      messageId: 'msg-1',
      senderId: 'user:primary',
      content: 'hello-a',
      trace: null,
    });
    enqueueDispatchInputForUserMessage({
      chatId: CHAT_ID_2,
      messageId: 'msg-2',
      senderId: 'user:primary',
      content: 'hello-b',
      trace: null,
    });
    runDispatchBatchSchedulerIteration(Date.now());

    const claimManyResponse = await app.request('/api/v1/dispatch/claim-many', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        workerId: 'worker-many',
        waitMs: 0,
        limit: 2,
      }),
    });

    expect(claimManyResponse.status).toBe(200);
    const body = await claimManyResponse.json() as { batches: Array<{ chatId: string; batchId: string }> };
    expect(body.batches).toHaveLength(2);
    expect(new Set(body.batches.map((batch) => batch.chatId))).toEqual(
      new Set([CHAT_ID_1, CHAT_ID_2]),
    );
  });
});
