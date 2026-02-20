import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { sendNotificationMock, setVapidDetailsMock } = vi.hoisted(() => ({
  sendNotificationMock: vi.fn(),
  setVapidDetailsMock: vi.fn(),
}));

vi.mock('web-push', () => ({
  default: {
    sendNotification: sendNotificationMock,
    setVapidDetails: setVapidDetailsMock,
  },
}));

import { DELETE as pushSubscribeDelete, POST as pushSubscribePost } from '@/app/api/v1/push/subscribe/route';
import { POST as pushTestPost } from '@/app/api/v1/push/test/route';
import { resetWriteRateLimitForTests } from '@/src/api/write-controls';
import { resetPushServiceForTests } from '@/src/services/push-service';

const repoRoot = join(import.meta.dirname, '..', '..');
const migrationSql = readFileSync(join(repoRoot, 'drizzle', '0000_initial.sql'), 'utf8');

let db: Database.Database;
let tempConfigPath: string;

function createJsonRequest(url: string, method: string, body?: unknown) {
  return new Request(url, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function writePushEnabledConfig() {
  const tempDir = mkdtempSync(join(tmpdir(), 'opengram-push-config-'));
  const filePath = join(tempDir, 'opengram.config.json');
  writeFileSync(
    filePath,
    JSON.stringify(
      {
        appName: 'OpenGram Test',
        agents: [
          {
            id: 'agent-default',
            name: 'Agent Default',
            description: 'Default',
            defaultModelId: 'model-default',
          },
        ],
        models: [
          {
            id: 'model-default',
            name: 'Model Default',
            description: 'Default model',
          },
        ],
        defaultModelIdForNewChats: 'model-default',
        push: {
          enabled: true,
          vapidPublicKey: 'public-key',
          vapidPrivateKey: 'private-key',
          subject: 'mailto:test@example.com',
        },
      },
      null,
      2,
    ),
  );

  return filePath;
}

beforeEach(() => {
  const tempDir = mkdtempSync(join(tmpdir(), 'opengram-push-api-'));
  const dbPath = join(tempDir, 'test.db');
  process.env.DATABASE_URL = dbPath;

  tempConfigPath = writePushEnabledConfig();
  process.env.OPENGRAM_CONFIG_PATH = tempConfigPath;

  db = new Database(dbPath);
  db.exec(migrationSql);

  sendNotificationMock.mockReset();
  setVapidDetailsMock.mockReset();
  resetPushServiceForTests();
  resetWriteRateLimitForTests();
});

afterEach(() => {
  db.close();
  delete process.env.DATABASE_URL;
  delete process.env.OPENGRAM_CONFIG_PATH;
  sendNotificationMock.mockReset();
  setVapidDetailsMock.mockReset();
  resetPushServiceForTests();
  resetWriteRateLimitForTests();
});

describe('push API', () => {
  it('subscribes and upserts push subscriptions by endpoint', async () => {
    const firstResponse = await pushSubscribePost(
      createJsonRequest('http://localhost/api/v1/push/subscribe', 'POST', {
        endpoint: 'https://fcm.googleapis.com/sub/1',
        keys: {
          p256dh: 'p256dh-key',
          auth: 'auth-key',
        },
      }),
    );
    expect(firstResponse.status).toBe(201);

    const secondResponse = await pushSubscribePost(
      createJsonRequest('http://localhost/api/v1/push/subscribe', 'POST', {
        endpoint: 'https://fcm.googleapis.com/sub/1',
        keys: {
          p256dh: 'p256dh-key-updated',
          auth: 'auth-key-updated',
        },
      }),
    );
    expect(secondResponse.status).toBe(201);

    const count = db
      .prepare('SELECT COUNT(*) AS count FROM push_subscriptions WHERE endpoint = ?')
      .get('https://fcm.googleapis.com/sub/1') as { count: number };
    expect(count.count).toBe(1);

    const row = db
      .prepare('SELECT keys_p256dh, keys_auth FROM push_subscriptions WHERE endpoint = ?')
      .get('https://fcm.googleapis.com/sub/1') as { keys_p256dh: string; keys_auth: string };
    expect(row).toEqual({
      keys_p256dh: 'p256dh-key-updated',
      keys_auth: 'auth-key-updated',
    });
  });

  it('rejects non-https and private-network subscription endpoints', async () => {
    const insecureResponse = await pushSubscribePost(
      createJsonRequest('http://localhost/api/v1/push/subscribe', 'POST', {
        endpoint: 'http://fcm.googleapis.com/sub/1',
        keys: {
          p256dh: 'p256dh-key',
          auth: 'auth-key',
        },
      }),
    );
    expect(insecureResponse.status).toBe(400);

    const privateResponse = await pushSubscribePost(
      createJsonRequest('http://localhost/api/v1/push/subscribe', 'POST', {
        endpoint: 'https://127.0.0.1/sub/1',
        keys: {
          p256dh: 'p256dh-key',
          auth: 'auth-key',
        },
      }),
    );
    expect(privateResponse.status).toBe(400);
  });

  it('deletes subscription by endpoint', async () => {
    db.prepare(
      [
        'INSERT INTO push_subscriptions (id, endpoint, keys_p256dh, keys_auth, user_agent, created_at)',
        'VALUES (?, ?, ?, ?, ?, ?)',
      ].join(' '),
    ).run('111111111111111111111', 'https://fcm.googleapis.com/sub/remove', 'k1', 'k2', 'agent', Date.now());

    const response = await pushSubscribeDelete(
      createJsonRequest('http://localhost/api/v1/push/subscribe', 'DELETE', {
        endpoint: 'https://fcm.googleapis.com/sub/remove',
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true, removed: true });

    const count = db
      .prepare('SELECT COUNT(*) AS count FROM push_subscriptions WHERE endpoint = ?')
      .get('https://fcm.googleapis.com/sub/remove') as { count: number };
    expect(count.count).toBe(0);
  });

  it('sends test push notifications and prunes gone subscriptions', async () => {
    db.prepare(
      [
        'INSERT INTO push_subscriptions (id, endpoint, keys_p256dh, keys_auth, user_agent, created_at)',
        'VALUES (?, ?, ?, ?, ?, ?), (?, ?, ?, ?, ?, ?)',
      ].join(' '),
    ).run(
      '111111111111111111111',
      'https://fcm.googleapis.com/sub/live',
      'k1',
      'a1',
      null,
      Date.now(),
      '222222222222222222222',
      'https://fcm.googleapis.com/sub/gone',
      'k2',
      'a2',
      null,
      Date.now(),
    );

    sendNotificationMock.mockResolvedValueOnce(undefined).mockRejectedValueOnce({ statusCode: 410 });

    const response = await pushTestPost(
      createJsonRequest('http://localhost/api/v1/push/test', 'POST', {
        title: 'Test title',
        body: 'Test body',
        chatId: 'chat-1',
        url: '/chats/chat-1',
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      sent: 1,
      failed: 1,
      removed: 1,
    });

    expect(setVapidDetailsMock).toHaveBeenCalledWith(
      'mailto:test@example.com',
      'public-key',
      'private-key',
    );

    const payload = sendNotificationMock.mock.calls[0]?.[1];
    expect(typeof payload).toBe('string');
    expect(JSON.parse(String(payload))).toMatchObject({
      title: 'Test title',
      body: 'Test body',
      data: {
        chatId: 'chat-1',
        type: 'test',
        url: '/chats/chat-1',
      },
    });

    const remaining = db
      .prepare('SELECT endpoint FROM push_subscriptions ORDER BY endpoint ASC')
      .all() as Array<{ endpoint: string }>;
    expect(remaining).toEqual([{ endpoint: 'https://fcm.googleapis.com/sub/live' }]);
  });
});
