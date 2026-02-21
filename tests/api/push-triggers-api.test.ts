import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { sendWebPushNotificationMock } = vi.hoisted(() => ({
  sendWebPushNotificationMock: vi.fn(),
}));

vi.mock('@/src/services/push-crypto', () => ({
  sendWebPushNotification: sendWebPushNotificationMock,
}));

import { app } from '@/src/server';
import { closeDb, resetDbForTests } from '@/src/db/client';
import { resetWriteRateLimitForTests } from '@/src/api/write-controls';
import { resetPushServiceForTests } from '@/src/services/push-service';

const repoRoot = join(import.meta.dirname, '..', '..');
const migrationSql = readFileSync(join(repoRoot, 'migrations', '0000_initial.sql'), 'utf8');

let db: Database.Database;
let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

function writePushEnabledConfig(agentName = 'Agent Default') {
  const tempDir = mkdtempSync(join(tmpdir(), 'opengram-push-trigger-config-'));
  const filePath = join(tempDir, 'opengram.config.json');
  writeFileSync(
    filePath,
    JSON.stringify(
      {
        appName: 'OpenGram Test',
        agents: [
          {
            id: 'agent-default',
            name: agentName,
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

async function createChat() {
  const response = await app.request('/api/v1/chats', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      title: 'push trigger chat',
      agentIds: ['agent-default'],
      modelId: 'model-default',
    }),
  });
  return response.json() as Promise<{ id: string }>;
}

beforeEach(() => {
  const tempDir = mkdtempSync(join(tmpdir(), 'opengram-push-trigger-api-'));
  const dbPath = join(tempDir, 'test.db');
  process.env.DATABASE_URL = dbPath;
  process.env.OPENGRAM_CONFIG_PATH = writePushEnabledConfig();

  db = new Database(dbPath);
  db.exec(migrationSql);
  resetDbForTests();

  db.prepare(
    [
      'INSERT INTO push_subscriptions (id, endpoint, keys_p256dh, keys_auth, user_agent, created_at)',
      'VALUES (?, ?, ?, ?, ?, ?)',
    ].join(' '),
  ).run('111111111111111111111', 'https://example.com/sub/live', 'k1', 'a1', null, Date.now());

  sendWebPushNotificationMock.mockReset();
  sendWebPushNotificationMock.mockResolvedValue({ statusCode: 201 });
  consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  resetPushServiceForTests();
  resetWriteRateLimitForTests();
});

afterEach(() => {
  closeDb();
  db.close();
  delete process.env.DATABASE_URL;
  delete process.env.OPENGRAM_CONFIG_PATH;
  sendWebPushNotificationMock.mockReset();
  consoleErrorSpy.mockRestore();
  resetPushServiceForTests();
  resetWriteRateLimitForTests();
});

describe('push triggers', () => {
  it('sends push for agent messages only', async () => {
    const chat = await createChat();

    const response = await app.request('/api/v1/chats/' + chat.id + '/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        role: 'agent',
        senderId: 'agent-default',
        content: 'Agent says hello from push path',
      }),
    });
    expect(response.status).toBe(201);

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(sendWebPushNotificationMock).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(String(sendWebPushNotificationMock.mock.calls[0][1])) as {
      title: string;
      body: string;
      data: {
        chatId: string;
        type: string;
        url: string;
      };
    };

    expect(payload).toMatchObject({
      title: 'Agent Default',
      data: {
        chatId: chat.id,
        type: 'message',
        url: `/chats/${chat.id}`,
      },
    });
    expect(payload.body).toContain('Agent says hello');

    sendWebPushNotificationMock.mockClear();

    const userMessageResponse = await app.request('/api/v1/chats/' + chat.id + '/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        role: 'user',
        senderId: 'user:primary',
        content: 'User message should not push',
      }),
    });
    expect(userMessageResponse.status).toBe(201);

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(sendWebPushNotificationMock).not.toHaveBeenCalled();
  });

  it('sends push for request.created events', async () => {
    const chat = await createChat();

    const response = await app.request('/api/v1/chats/' + chat.id + '/requests', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        type: 'choice',
        title: 'Approve deployment?',
        config: {
          options: [
            { id: 'yes', label: 'Yes' },
            { id: 'no', label: 'No' },
          ],
          minSelections: 1,
          maxSelections: 1,
        },
      }),
    });

    expect(response.status).toBe(201);

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(sendWebPushNotificationMock).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(String(sendWebPushNotificationMock.mock.calls[0][1])) as {
      title: string;
      body: string;
      data: {
        chatId: string;
        type: string;
        url: string;
      };
    };

    expect(payload).toEqual({
      title: 'Agent Default',
      body: 'Approve deployment?',
      data: {
        chatId: chat.id,
        type: 'request',
        url: `/chats/${chat.id}`,
      },
    });
  });

  it('contains push failures for message-created notifications', async () => {
    process.env.OPENGRAM_CONFIG_PATH = writePushEnabledConfig('A'.repeat(5000));
    resetPushServiceForTests();
    const chat = await createChat();

    const response = await app.request('/api/v1/chats/' + chat.id + '/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        role: 'agent',
        senderId: 'agent-default',
        content: 'Agent message that fails push',
      }),
    });
    expect(response.status).toBe(201);

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      'Failed to send message.created push notification.',
      expect.any(Error),
    );
    expect(sendWebPushNotificationMock).not.toHaveBeenCalled();
  });

  it('contains push failures for request-created notifications', async () => {
    process.env.OPENGRAM_CONFIG_PATH = writePushEnabledConfig('A'.repeat(5000));
    resetPushServiceForTests();
    const chat = await createChat();

    const response = await app.request('/api/v1/chats/' + chat.id + '/requests', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        type: 'choice',
        title: 'Request that fails push',
        config: {
          options: [
            { id: 'yes', label: 'Yes' },
            { id: 'no', label: 'No' },
          ],
          minSelections: 1,
          maxSelections: 1,
        },
      }),
    });
    expect(response.status).toBe(201);

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      'Failed to send request.created push notification.',
      expect.any(Error),
    );
    expect(sendWebPushNotificationMock).not.toHaveBeenCalled();
  });
});
