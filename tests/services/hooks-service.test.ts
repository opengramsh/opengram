import { createHmac } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resetEventSubscribersForTests } from '@/src/services/events-service';
import {
  buildEnrichedPayloadForTests,
  matchesHookForTests,
  processEventForTests,
  runRetentionCleanup,
  signPayload,
} from '@/src/services/hooks-service';
import type { EventEnvelope } from '@/src/services/events-service';

const repoRoot = join(import.meta.dirname, '..', '..');
const migrationSql = readFileSync(join(repoRoot, 'drizzle', '0000_initial.sql'), 'utf8');

let db: Database.Database;
let configPath: string;

function writeConfig(hooks: unknown[]) {
  writeFileSync(configPath, JSON.stringify({ hooks }));
}

function createEnvelope(overrides: Partial<EventEnvelope> = {}): EventEnvelope {
  return {
    id: '111111111111111111111',
    type: 'message.created',
    timestamp: new Date(1000).toISOString(),
    payload: { chatId: 'chat-1', messageId: 'msg-1' },
    ...overrides,
  };
}

function insertEvent(id: string, type: string, payload: Record<string, unknown>, createdAt: number) {
  db.prepare('INSERT INTO events (id, type, payload, created_at) VALUES (?, ?, ?, ?)').run(
    id,
    type,
    JSON.stringify(payload),
    createdAt,
  );
}

function insertChat(id: string) {
  const now = Date.now();
  db.prepare(
    [
      'INSERT INTO chats (id, title, agent_ids, model_id, created_at, updated_at)',
      "VALUES (?, 'Test Chat', ?, 'model-default', ?, ?)",
    ].join(' '),
  ).run(id, JSON.stringify(['agent-default']), now, now);
}

function insertMessage(id: string, chatId: string, role = 'agent', senderId = 'agent-default') {
  const now = Date.now();
  db.prepare(
    [
      'INSERT INTO messages (id, chat_id, role, sender_id, created_at, updated_at, content_final, stream_state)',
      "VALUES (?, ?, ?, ?, ?, ?, 'hello world', 'none')",
    ].join(' '),
  ).run(id, chatId, role, senderId, now, now);
}

function insertRequest(id: string, chatId: string, status = 'resolved') {
  const now = Date.now();
  db.prepare(
    [
      'INSERT INTO requests (id, chat_id, type, status, title, config, created_at, trace)',
      "VALUES (?, ?, 'choice', ?, 'Pick one', '{}', ?, '{\"key\":\"val\"}')",
    ].join(' '),
  ).run(id, chatId, status, now);
}

function getDeliveries() {
  return db.prepare('SELECT * FROM webhook_deliveries ORDER BY attempted_at ASC').all() as Array<{
    id: string;
    event_id: string;
    target_url: string;
    status_code: number | null;
    success: number;
    error: string | null;
    attempted_at: number;
  }>;
}

beforeEach(() => {
  const tempDir = mkdtempSync(join(tmpdir(), 'opengram-hooks-service-'));
  const dbPath = join(tempDir, 'test.db');
  configPath = join(tempDir, 'opengram.config.json');

  process.env.DATABASE_URL = dbPath;
  process.env.OPENGRAM_CONFIG_PATH = configPath;

  db = new Database(dbPath);
  db.pragma('foreign_keys = ON');
  db.exec(migrationSql);

  resetEventSubscribersForTests();
  writeConfig([]);
});

afterEach(() => {
  db.close();
  delete process.env.DATABASE_URL;
  delete process.env.OPENGRAM_CONFIG_PATH;
  resetEventSubscribersForTests();
  vi.restoreAllMocks();
});

describe('hooks service', () => {
  describe('event matching', () => {
    it('matches hooks by event type', () => {
      const hook = { url: 'https://example.com/hook', events: ['message.created', 'request.resolved'] };
      expect(matchesHookForTests(hook, 'message.created')).toBe(true);
      expect(matchesHookForTests(hook, 'request.resolved')).toBe(true);
      expect(matchesHookForTests(hook, 'chat.updated')).toBe(false);
    });
  });

  describe('HMAC signing', () => {
    it('produces a valid sha256 HMAC signature', () => {
      const body = '{"test":"data"}';
      const secret = 'whsec_test_secret';

      const signature = signPayload(body, secret);

      const expected = createHmac('sha256', secret).update(body).digest('hex');
      expect(signature).toBe(`sha256=${expected}`);
    });

    it('produces different signatures for different secrets', () => {
      const body = '{"test":"data"}';
      const sig1 = signPayload(body, 'secret-a');
      const sig2 = signPayload(body, 'secret-b');
      expect(sig1).not.toBe(sig2);
    });
  });

  describe('payload enrichment', () => {
    it('enriches message.created with full message and chat data', () => {
      const chatId = 'aaaaaaaaaaaaaaaaaaaaa';
      const messageId = 'bbbbbbbbbbbbbbbbbbbbb';
      insertChat(chatId);
      insertMessage(messageId, chatId);

      const envelope = createEnvelope({
        type: 'message.created',
        payload: { chatId, messageId },
      });

      const enriched = buildEnrichedPayloadForTests(envelope);
      expect(enriched).toMatchObject({
        chatId,
        messageId,
        senderId: 'agent-default',
        role: 'agent',
        content: 'hello world',
        modelId: null,
        agentIds: ['agent-default'],
      });
    });

    it('enriches request.resolved with full request data', () => {
      const chatId = 'aaaaaaaaaaaaaaaaaaaaa';
      const requestId = 'ccccccccccccccccccccc';
      insertChat(chatId);
      insertRequest(requestId, chatId, 'resolved');

      const envelope = createEnvelope({
        type: 'request.resolved',
        payload: { chatId, requestId },
      });

      const enriched = buildEnrichedPayloadForTests(envelope);
      expect(enriched).toMatchObject({
        chatId,
        requestId,
        type: 'choice',
        status: 'resolved',
        trace: { key: 'val' },
      });
    });

    it('enriches request.cancelled with full request data', () => {
      const chatId = 'aaaaaaaaaaaaaaaaaaaaa';
      const requestId = 'ccccccccccccccccccccc';
      insertChat(chatId);
      insertRequest(requestId, chatId, 'cancelled');

      const envelope = createEnvelope({
        type: 'request.cancelled',
        payload: { chatId, requestId },
      });

      const enriched = buildEnrichedPayloadForTests(envelope);
      expect(enriched).toMatchObject({
        chatId,
        requestId,
        type: 'choice',
        status: 'cancelled',
      });
    });

    it('falls back to raw payload when records are missing', () => {
      const payload = { chatId: 'missing-chat', messageId: 'missing-msg' };
      const envelope = createEnvelope({ type: 'message.created', payload });

      const enriched = buildEnrichedPayloadForTests(envelope);
      expect(enriched).toEqual(payload);
    });

    it('passes through non-enrichable event types as-is', () => {
      const payload = { chatId: 'chat-1', foo: 'bar' };
      const envelope = createEnvelope({ type: 'chat.updated', payload });

      const enriched = buildEnrichedPayloadForTests(envelope);
      expect(enriched).toEqual(payload);
    });
  });

  describe('delivery and logging', () => {
    it('delivers hook payload and logs success', async () => {
      const eventId = '111111111111111111111';
      insertEvent(eventId, 'message.created', { chatId: 'c', messageId: 'm' }, Date.now());

      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response('OK', { status: 200 }),
      );

      writeConfig([{ url: 'https://example.com/hook', events: ['message.created'] }]);

      const envelope = createEnvelope({ id: eventId });
      await processEventForTests(envelope);

      expect(fetchSpy).toHaveBeenCalledOnce();
      const callArgs = fetchSpy.mock.calls[0]!;
      expect(callArgs[0]).toBe('https://example.com/hook');

      const deliveries = getDeliveries();
      expect(deliveries).toHaveLength(1);
      expect(deliveries[0]!.event_id).toBe(eventId);
      expect(deliveries[0]!.success).toBe(1);
      expect(deliveries[0]!.status_code).toBe(200);
      expect(deliveries[0]!.target_url).toBe('https://example.com/hook');
    });

    it('includes signing header when signingSecret is configured', async () => {
      const eventId = '111111111111111111111';
      insertEvent(eventId, 'message.created', { chatId: 'c', messageId: 'm' }, Date.now());

      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response('OK', { status: 200 }),
      );

      const secret = 'whsec_test123';
      writeConfig([{
        url: 'https://example.com/hook',
        events: ['message.created'],
        signingSecret: secret,
      }]);

      const envelope = createEnvelope({ id: eventId });
      await processEventForTests(envelope);

      expect(fetchSpy).toHaveBeenCalledOnce();
      const requestInit = fetchSpy.mock.calls[0]![1] as RequestInit;
      const headers = requestInit.headers as Record<string, string>;
      expect(headers['X-OpenGram-Signature']).toBeDefined();

      const body = requestInit.body as string;
      const expectedSig = signPayload(body, secret);
      expect(headers['X-OpenGram-Signature']).toBe(expectedSig);
    });

    it('includes custom headers from hook config', async () => {
      const eventId = '111111111111111111111';
      insertEvent(eventId, 'message.created', { chatId: 'c', messageId: 'm' }, Date.now());

      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response('OK', { status: 200 }),
      );

      writeConfig([{
        url: 'https://example.com/hook',
        events: ['message.created'],
        headers: { 'X-Custom': 'custom-value' },
      }]);

      await processEventForTests(createEnvelope({ id: eventId }));

      const requestInit = fetchSpy.mock.calls[0]![1] as RequestInit;
      const headers = requestInit.headers as Record<string, string>;
      expect(headers['X-Custom']).toBe('custom-value');
      expect(headers['Content-Type']).toBe('application/json');
    });

    it('logs failure on HTTP error and does not retry 4xx', async () => {
      const eventId = '111111111111111111111';
      insertEvent(eventId, 'message.created', { chatId: 'c', messageId: 'm' }, Date.now());

      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response('Bad Request', { status: 400 }),
      );

      writeConfig([{ url: 'https://example.com/hook', events: ['message.created'], maxRetries: 3 }]);

      await processEventForTests(createEnvelope({ id: eventId }));

      // 4xx should not be retried
      expect(fetchSpy).toHaveBeenCalledOnce();

      const deliveries = getDeliveries();
      expect(deliveries).toHaveLength(1);
      expect(deliveries[0]!.success).toBe(0);
      expect(deliveries[0]!.status_code).toBe(400);
    });
  });

  describe('retry behavior', () => {
    it('retries on 5xx up to maxRetries', async () => {
      const eventId = '111111111111111111111';
      insertEvent(eventId, 'message.created', { chatId: 'c', messageId: 'm' }, Date.now());

      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response('Server Error', { status: 500 }),
      );

      writeConfig([{ url: 'https://example.com/hook', events: ['message.created'], maxRetries: 2 }]);

      await processEventForTests(createEnvelope({ id: eventId }));

      // 1 initial + 2 retries = 3 calls
      expect(fetchSpy).toHaveBeenCalledTimes(3);

      const deliveries = getDeliveries();
      expect(deliveries).toHaveLength(3);
      expect(deliveries.every((d) => d.success === 0)).toBe(true);
    });

    it('stops retrying after success', async () => {
      const eventId = '111111111111111111111';
      insertEvent(eventId, 'message.created', { chatId: 'c', messageId: 'm' }, Date.now());

      let callCount = 0;
      vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
        callCount += 1;
        if (callCount === 1) {
          return new Response('Server Error', { status: 500 });
        }
        return new Response('OK', { status: 200 });
      });

      writeConfig([{ url: 'https://example.com/hook', events: ['message.created'], maxRetries: 5 }]);

      await processEventForTests(createEnvelope({ id: eventId }));

      expect(callCount).toBe(2);

      const deliveries = getDeliveries();
      expect(deliveries).toHaveLength(2);
      expect(deliveries[0]!.success).toBe(0);
      expect(deliveries[1]!.success).toBe(1);
    });

    it('logs network errors and retries', async () => {
      const eventId = '111111111111111111111';
      insertEvent(eventId, 'message.created', { chatId: 'c', messageId: 'm' }, Date.now());

      vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('connect ECONNREFUSED'));

      writeConfig([{ url: 'https://example.com/hook', events: ['message.created'], maxRetries: 1 }]);

      await processEventForTests(createEnvelope({ id: eventId }));

      const deliveries = getDeliveries();
      expect(deliveries).toHaveLength(2);
      expect(deliveries[0]!.status_code).toBeNull();
      expect(deliveries[0]!.error).toBe('connect ECONNREFUSED');
      expect(deliveries[1]!.error).toBe('connect ECONNREFUSED');
    });
  });

  describe('no hooks configured', () => {
    it('does not call fetch when no hooks are configured', async () => {
      const eventId = '111111111111111111111';
      insertEvent(eventId, 'message.created', { chatId: 'c', messageId: 'm' }, Date.now());

      const fetchSpy = vi.spyOn(globalThis, 'fetch');

      writeConfig([]);

      await processEventForTests(createEnvelope({ id: eventId }));

      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('does not call fetch when no hooks match the event type', async () => {
      const eventId = '111111111111111111111';
      insertEvent(eventId, 'message.created', { chatId: 'c', messageId: 'm' }, Date.now());

      const fetchSpy = vi.spyOn(globalThis, 'fetch');

      writeConfig([{ url: 'https://example.com/hook', events: ['chat.updated'] }]);

      await processEventForTests(createEnvelope({ id: eventId }));

      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });

  describe('timeout handling', () => {
    it('respects custom timeoutMs from hook config', async () => {
      const eventId = '111111111111111111111';
      insertEvent(eventId, 'message.created', { chatId: 'c', messageId: 'm' }, Date.now());

      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response('OK', { status: 200 }),
      );

      writeConfig([{
        url: 'https://example.com/hook',
        events: ['message.created'],
        timeoutMs: 10000,
        maxRetries: 0,
      }]);

      await processEventForTests(createEnvelope({ id: eventId }));

      expect(fetchSpy).toHaveBeenCalledOnce();
      const callArgs = fetchSpy.mock.calls[0]!;
      const init = callArgs[1] as RequestInit;
      expect(init.signal).toBeInstanceOf(AbortSignal);
    });
  });

  describe('retention cleanup', () => {
    it('deletes events older than 30 days', () => {
      const now = Date.now();
      const thirtyOneDaysAgo = now - 31 * 24 * 60 * 60 * 1000;
      const twentyNineDaysAgo = now - 29 * 24 * 60 * 60 * 1000;

      insertEvent('aaaaaaaaaaaaaaaaaaa01', 'chat.updated', { chatId: 'c' }, thirtyOneDaysAgo);
      insertEvent('aaaaaaaaaaaaaaaaaaa02', 'chat.updated', { chatId: 'c' }, twentyNineDaysAgo);

      runRetentionCleanup();

      const remaining = db.prepare('SELECT id FROM events').all() as { id: string }[];
      expect(remaining).toHaveLength(1);
      expect(remaining[0]!.id).toBe('aaaaaaaaaaaaaaaaaaa02');
    });

    it('cascade-deletes webhook deliveries with their parent event', () => {
      const now = Date.now();
      const thirtyOneDaysAgo = now - 31 * 24 * 60 * 60 * 1000;

      insertEvent('aaaaaaaaaaaaaaaaaaa01', 'chat.updated', { chatId: 'c' }, thirtyOneDaysAgo);
      db.prepare(
        "INSERT INTO webhook_deliveries (id, event_id, target_url, status_code, success, error, attempted_at) VALUES ('ddddddddddddddddddddd', 'aaaaaaaaaaaaaaaaaaa01', 'https://example.com', 200, 1, NULL, ?)",
      ).run(thirtyOneDaysAgo);

      runRetentionCleanup();

      const deliveries = db.prepare('SELECT id FROM webhook_deliveries').all();
      expect(deliveries).toHaveLength(0);
    });

    it('deletes idempotency keys older than 24 hours', () => {
      const now = Date.now();
      const twentyFiveHoursAgo = now - 25 * 60 * 60 * 1000;
      const twentyThreeHoursAgo = now - 23 * 60 * 60 * 1000;

      db.prepare(
        "INSERT INTO idempotency_keys (key, response, status_code, created_at) VALUES ('old-key', '{}', 200, ?)",
      ).run(twentyFiveHoursAgo);
      db.prepare(
        "INSERT INTO idempotency_keys (key, response, status_code, created_at) VALUES ('fresh-key', '{}', 200, ?)",
      ).run(twentyThreeHoursAgo);

      runRetentionCleanup();

      const remaining = db.prepare('SELECT key FROM idempotency_keys').all() as { key: string }[];
      expect(remaining).toHaveLength(1);
      expect(remaining[0]!.key).toBe('fresh-key');
    });
  });

  describe('hook payload structure', () => {
    it('sends well-formed JSON payload with event envelope fields', async () => {
      const eventId = '111111111111111111111';
      insertEvent(eventId, 'chat.updated', { chatId: 'c' }, Date.now());

      let capturedBody: string | undefined;
      vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
        capturedBody = (init as RequestInit).body as string;
        return new Response('OK', { status: 200 });
      });

      writeConfig([{ url: 'https://example.com/hook', events: ['chat.updated'] }]);

      const envelope = createEnvelope({
        id: eventId,
        type: 'chat.updated',
        payload: { chatId: 'c' },
      });
      await processEventForTests(envelope);

      expect(capturedBody).toBeDefined();
      const parsed = JSON.parse(capturedBody!);
      expect(parsed).toMatchObject({
        id: eventId,
        type: 'chat.updated',
        timestamp: envelope.timestamp,
        payload: { chatId: 'c' },
      });
    });
  });
});
