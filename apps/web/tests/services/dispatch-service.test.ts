import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resetConfigCacheForTests } from '@/src/config/opengram-config';
import { closeDb, getDb, resetDbForTests } from '@/src/db/client';
import { resetSqliteReadyForTests } from '@/src/db/migrations';
import {
  claimDispatchBatch,
  completeDispatchBatch,
  enqueueDispatchInputForRequestResolved,
  enqueueDispatchInputForUserMessage,
  failDispatchBatch,
  recordDispatchUserTyping,
  resetDispatchServiceForTests,
  runDispatchBatchSchedulerIteration,
} from '@/src/services/dispatch-service';

const BASE_CONFIG = {
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
      batchDebounceMs: 100,
      typingGraceMs: 200,
      maxBatchWaitMs: 800,
      schedulerTickMs: 200,
      leaseMs: 30_000,
      heartbeatIntervalMs: 5_000,
      claimWaitMs: 10_000,
      retryBaseMs: 500,
      retryMaxMs: 30_000,
      maxAttempts: 3,
    },
  },
  hooks: [],
};

const CHAT_ID_1 = '123456789012345678901';
const CHAT_ID_2 = '123456789012345678902';
const CHAT_ID_3 = '123456789012345678903';
const CHAT_ID_4 = '123456789012345678904';
const CHAT_ID_5 = '123456789012345678905';
const CHAT_ID_6 = '123456789012345678906';

let testConfigPath: string;

function seedChat(chatId: string) {
  const db = getDb();
  const now = Date.now();
  db.prepare(
    [
      'INSERT INTO chats (id, title, model_id, created_at, updated_at)',
      'VALUES (?, ?, ?, ?, ?)',
    ].join(' '),
  ).run(chatId, 'Dispatch Chat', 'model-default', now, now);
}

beforeEach(() => {
  const tempDir = mkdtempSync(join(tmpdir(), 'opengram-dispatch-service-'));
  const dbPath = join(tempDir, 'test.db');
  const configPath = join(tempDir, 'opengram.config.json');
  testConfigPath = configPath;
  writeFileSync(configPath, JSON.stringify(BASE_CONFIG), 'utf8');

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

function setDispatchMode(mode: 'immediate' | 'sequential' | 'batched_sequential') {
  const next = structuredClone(BASE_CONFIG);
  next.server.dispatch.mode = mode;
  writeFileSync(testConfigPath, JSON.stringify(next), 'utf8');
  resetConfigCacheForTests();
}

describe('dispatch service', () => {
  it('does not apply typing grace when typing happened before first pending message', () => {
    seedChat(CHAT_ID_1);

    const nowSpy = vi.spyOn(Date, 'now');
    nowSpy.mockReturnValue(1_950);
    recordDispatchUserTyping(CHAT_ID_1, 1_950);

    nowSpy.mockReturnValue(2_000);
    enqueueDispatchInputForUserMessage({
      chatId: CHAT_ID_1,
      messageId: 'msg-pretyping',
      senderId: 'user:primary',
      content: 'Single message',
      trace: null,
    });

    // debounce is 100ms in this test config; typing grace should be ignored here.
    expect(runDispatchBatchSchedulerIteration(2_090)).toBe(0);
    expect(runDispatchBatchSchedulerIteration(2_100)).toBe(1);

    nowSpy.mockRestore();
  });

  it('batches rapid user messages and respects typing grace window', () => {
    seedChat(CHAT_ID_1);

    const nowSpy = vi.spyOn(Date, 'now');
    nowSpy.mockReturnValue(1_000);
    enqueueDispatchInputForUserMessage({
      chatId: CHAT_ID_1,
      messageId: 'msg-1',
      senderId: 'user:primary',
      content: 'First',
      trace: null,
    });

    nowSpy.mockReturnValue(1_050);
    enqueueDispatchInputForUserMessage({
      chatId: CHAT_ID_1,
      messageId: 'msg-2',
      senderId: 'user:primary',
      content: 'Second',
      trace: null,
    });

    nowSpy.mockReturnValue(1_080);
    recordDispatchUserTyping(CHAT_ID_1, 1_080);

    nowSpy.mockReturnValue(1_220);
    expect(runDispatchBatchSchedulerIteration(1_220)).toBe(0);

    nowSpy.mockReturnValue(1_310);
    expect(runDispatchBatchSchedulerIteration(1_310)).toBe(1);

    const db = getDb();
    const batch = db
      .prepare('SELECT payload FROM dispatch_batches WHERE chat_id = ?')
      .get(CHAT_ID_1) as { payload: string };
    const payload = JSON.parse(batch.payload) as { compiledContent: string; items: Array<{ sourceId: string }> };

    expect(payload.items.map((item) => item.sourceId)).toEqual(['msg-1', 'msg-2']);
    expect(payload.compiledContent).toContain('[Message 1]');
    expect(payload.compiledContent).toContain('[Message 2]');

    nowSpy.mockRestore();
  });

  it('enforces one leased batch at a time per chat', async () => {
    seedChat(CHAT_ID_2);
    const nowSpy = vi.spyOn(Date, 'now');

    nowSpy.mockReturnValue(10_000);
    enqueueDispatchInputForUserMessage({
      chatId: CHAT_ID_2,
      messageId: 'msg-a',
      senderId: 'user:primary',
      content: 'A',
      trace: null,
    });
    runDispatchBatchSchedulerIteration(11_000);

    nowSpy.mockReturnValue(12_000);
    enqueueDispatchInputForRequestResolved({
      chatId: CHAT_ID_2,
      requestId: 'req-b',
      senderId: 'user:primary',
      type: 'text_input',
      title: 'Question',
      resolutionPayload: { text: 'B' },
    });
    runDispatchBatchSchedulerIteration(13_000);

    nowSpy.mockReturnValue(13_000);

    const first = await claimDispatchBatch({
      workerId: 'worker-1',
      leaseMs: 30_000,
      waitMs: 0,
    });
    expect(first?.chatId).toBe(CHAT_ID_2);

    const secondWhileFirstLeased = await claimDispatchBatch({
      workerId: 'worker-2',
      leaseMs: 30_000,
      waitMs: 0,
    });
    expect(secondWhileFirstLeased).toBeNull();

    completeDispatchBatch(first!.batchId, 'worker-1');

    const second = await claimDispatchBatch({
      workerId: 'worker-2',
      leaseMs: 30_000,
      waitMs: 0,
    });
    expect(second?.chatId).toBe(CHAT_ID_2);
    expect(second?.batchId).not.toBe(first?.batchId);

    nowSpy.mockRestore();
  });

  it('marks batch failed and emits a visible system message when max attempts reached', async () => {
    seedChat(CHAT_ID_3);
    const nowSpy = vi.spyOn(Date, 'now');

    nowSpy.mockReturnValue(20_000);
    enqueueDispatchInputForUserMessage({
      chatId: CHAT_ID_3,
      messageId: 'msg-1',
      senderId: 'user:primary',
      content: 'Hello',
      trace: null,
    });
    runDispatchBatchSchedulerIteration(21_000);
    nowSpy.mockReturnValue(21_000);

    const firstClaim = await claimDispatchBatch({
      workerId: 'worker-1',
      leaseMs: 30_000,
      waitMs: 0,
    });
    expect(firstClaim).not.toBeNull();
    failDispatchBatch(firstClaim!.batchId, {
      workerId: 'worker-1',
      reason: 'temporary outage',
      retryable: true,
      retryDelayMs: 0,
    });

    const secondClaim = await claimDispatchBatch({
      workerId: 'worker-1',
      leaseMs: 30_000,
      waitMs: 0,
    });
    expect(secondClaim).not.toBeNull();
    failDispatchBatch(secondClaim!.batchId, {
      workerId: 'worker-1',
      reason: 'temporary outage',
      retryable: true,
      retryDelayMs: 0,
    });

    const thirdClaim = await claimDispatchBatch({
      workerId: 'worker-1',
      leaseMs: 30_000,
      waitMs: 0,
    });
    expect(thirdClaim).not.toBeNull();
    failDispatchBatch(thirdClaim!.batchId, {
      workerId: 'worker-1',
      reason: 'still failing',
      retryable: true,
      retryDelayMs: 0,
    });

    const db = getDb();
    const batchRow = db
      .prepare('SELECT status, last_error FROM dispatch_batches WHERE id = ?')
      .get(thirdClaim!.batchId) as { status: string; last_error: string };
    expect(batchRow.status).toBe('failed');
    expect(batchRow.last_error).toBe('still failing');

    const systemMessage = db
      .prepare(
        [
          "SELECT role, sender_id, content_final FROM messages",
          "WHERE chat_id = ? AND role = 'system'",
          'ORDER BY created_at DESC LIMIT 1',
        ].join(' '),
      )
      .get(CHAT_ID_3) as { role: string; sender_id: string; content_final: string } | undefined;
    expect(systemMessage?.role).toBe('system');
    expect(systemMessage?.sender_id).toBe('system');
    expect(systemMessage?.content_final).toContain('Dispatch failed after 3 attempts');

    nowSpy.mockRestore();
  });

  it('keeps accumulating pending inputs while a batch for the same chat is leased', async () => {
    seedChat(CHAT_ID_4);
    const nowSpy = vi.spyOn(Date, 'now');

    nowSpy.mockReturnValue(30_000);
    enqueueDispatchInputForUserMessage({
      chatId: CHAT_ID_4,
      messageId: 'msg-a',
      senderId: 'user:primary',
      content: 'A',
      trace: null,
    });
    expect(runDispatchBatchSchedulerIteration(31_000)).toBe(1);

    nowSpy.mockReturnValue(31_000);
    const firstClaim = await claimDispatchBatch({
      workerId: 'worker-1',
      leaseMs: 30_000,
      waitMs: 0,
    });
    expect(firstClaim).not.toBeNull();

    nowSpy.mockReturnValue(32_000);
    enqueueDispatchInputForUserMessage({
      chatId: CHAT_ID_4,
      messageId: 'msg-b',
      senderId: 'user:primary',
      content: 'B',
      trace: null,
    });
    nowSpy.mockReturnValue(32_500);
    enqueueDispatchInputForUserMessage({
      chatId: CHAT_ID_4,
      messageId: 'msg-c',
      senderId: 'user:primary',
      content: 'C',
      trace: null,
    });

    // While first batch is leased, scheduler must not split/create new batches.
    expect(runDispatchBatchSchedulerIteration(33_000)).toBe(0);

    const db = getDb();
    const pendingCountWhileLeased = db
      .prepare(
        "SELECT COUNT(*) AS count FROM dispatch_inputs WHERE chat_id = ? AND state = 'pending'",
      )
      .get(CHAT_ID_4) as { count: number };
    expect(pendingCountWhileLeased.count).toBe(2);

    completeDispatchBatch(firstClaim!.batchId, 'worker-1');

    // Once lease clears, one combined batch should be created from accumulated pending items.
    expect(runDispatchBatchSchedulerIteration(34_000)).toBe(1);
    nowSpy.mockReturnValue(34_000);
    const secondClaim = await claimDispatchBatch({
      workerId: 'worker-1',
      leaseMs: 30_000,
      waitMs: 0,
    });
    expect(secondClaim?.items.map((item) => item.sourceId)).toEqual(['msg-b', 'msg-c']);

    nowSpy.mockRestore();
  });

  it('supports sequential mode (no batching, one in-flight per chat)', async () => {
    setDispatchMode('sequential');
    seedChat(CHAT_ID_5);

    enqueueDispatchInputForUserMessage({
      chatId: CHAT_ID_5,
      messageId: 'msg-1',
      senderId: 'user:primary',
      content: 'First',
      trace: null,
    });
    enqueueDispatchInputForUserMessage({
      chatId: CHAT_ID_5,
      messageId: 'msg-2',
      senderId: 'user:primary',
      content: 'Second',
      trace: null,
    });

    const first = await claimDispatchBatch({
      workerId: 'worker-1',
      leaseMs: 30_000,
      waitMs: 0,
    });
    expect(first?.items.map((item) => item.sourceId)).toEqual(['msg-1']);

    const secondWhileFirstLeased = await claimDispatchBatch({
      workerId: 'worker-2',
      leaseMs: 30_000,
      waitMs: 0,
    });
    expect(secondWhileFirstLeased).toBeNull();

    completeDispatchBatch(first!.batchId, 'worker-1');

    const second = await claimDispatchBatch({
      workerId: 'worker-2',
      leaseMs: 30_000,
      waitMs: 0,
    });
    expect(second?.items.map((item) => item.sourceId)).toEqual(['msg-2']);
  });

  it('supports immediate mode (no batching, no per-chat sequencing lock)', async () => {
    setDispatchMode('immediate');
    seedChat(CHAT_ID_6);

    enqueueDispatchInputForUserMessage({
      chatId: CHAT_ID_6,
      messageId: 'msg-1',
      senderId: 'user:primary',
      content: 'First',
      trace: null,
    });
    enqueueDispatchInputForUserMessage({
      chatId: CHAT_ID_6,
      messageId: 'msg-2',
      senderId: 'user:primary',
      content: 'Second',
      trace: null,
    });

    const first = await claimDispatchBatch({
      workerId: 'worker-1',
      leaseMs: 30_000,
      waitMs: 0,
    });
    const second = await claimDispatchBatch({
      workerId: 'worker-2',
      leaseMs: 30_000,
      waitMs: 0,
    });

    expect(first?.items.map((item) => item.sourceId)).toEqual(['msg-1']);
    expect(second?.items.map((item) => item.sourceId)).toEqual(['msg-2']);
  });
});
