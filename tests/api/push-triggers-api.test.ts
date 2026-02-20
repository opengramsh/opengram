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

import { POST as chatsPost } from '@/app/api/v1/chats/route';
import { POST as messagesPost } from '@/app/api/v1/chats/[chatId]/messages/route';
import { POST as chatRequestsPost } from '@/app/api/v1/chats/[chatId]/requests/route';
import { resetWriteRateLimitForTests } from '@/src/api/write-controls';
import { resetPushServiceForTests } from '@/src/services/push-service';

type ChatContext = {
  params: Promise<{ chatId: string }>;
};

const repoRoot = join(import.meta.dirname, '..', '..');
const migrationSql = readFileSync(join(repoRoot, 'drizzle', '0000_initial.sql'), 'utf8');

let db: Database.Database;
let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

function chatContext(chatId: string): ChatContext {
  return { params: Promise.resolve({ chatId }) };
}

function createJsonRequest(url: string, method: string, body?: unknown) {
  return new Request(url, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

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
  const response = await chatsPost(
    createJsonRequest('http://localhost/api/v1/chats', 'POST', {
      title: 'push trigger chat',
      agentIds: ['agent-default'],
      modelId: 'model-default',
    }),
  );
  return response.json() as Promise<{ id: string }>;
}

beforeEach(() => {
  const tempDir = mkdtempSync(join(tmpdir(), 'opengram-push-trigger-api-'));
  const dbPath = join(tempDir, 'test.db');
  process.env.DATABASE_URL = dbPath;
  process.env.OPENGRAM_CONFIG_PATH = writePushEnabledConfig();

  db = new Database(dbPath);
  db.exec(migrationSql);

  db.prepare(
    [
      'INSERT INTO push_subscriptions (id, endpoint, keys_p256dh, keys_auth, user_agent, created_at)',
      'VALUES (?, ?, ?, ?, ?, ?)',
    ].join(' '),
  ).run('111111111111111111111', 'https://example.com/sub/live', 'k1', 'a1', null, Date.now());

  sendNotificationMock.mockReset();
  sendNotificationMock.mockResolvedValue(undefined);
  setVapidDetailsMock.mockReset();
  consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  resetPushServiceForTests();
  resetWriteRateLimitForTests();
});

afterEach(() => {
  db.close();
  delete process.env.DATABASE_URL;
  delete process.env.OPENGRAM_CONFIG_PATH;
  sendNotificationMock.mockReset();
  setVapidDetailsMock.mockReset();
  consoleErrorSpy.mockRestore();
  resetPushServiceForTests();
  resetWriteRateLimitForTests();
});

describe('push triggers', () => {
  it('sends push for agent messages only', async () => {
    const chat = await createChat();

    const response = await messagesPost(
      createJsonRequest(`http://localhost/api/v1/chats/${chat.id}/messages`, 'POST', {
        role: 'agent',
        senderId: 'agent-default',
        content: 'Agent says hello from push path',
      }),
      chatContext(chat.id),
    );
    expect(response.status).toBe(201);

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(sendNotificationMock).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(String(sendNotificationMock.mock.calls[0][1])) as {
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

    sendNotificationMock.mockClear();

    const userMessageResponse = await messagesPost(
      createJsonRequest(`http://localhost/api/v1/chats/${chat.id}/messages`, 'POST', {
        role: 'user',
        senderId: 'user:primary',
        content: 'User message should not push',
      }),
      chatContext(chat.id),
    );
    expect(userMessageResponse.status).toBe(201);

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(sendNotificationMock).not.toHaveBeenCalled();
  });

  it('sends push for request.created events', async () => {
    const chat = await createChat();

    const response = await chatRequestsPost(
      createJsonRequest(`http://localhost/api/v1/chats/${chat.id}/requests`, 'POST', {
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
      chatContext(chat.id),
    );

    expect(response.status).toBe(201);

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(sendNotificationMock).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(String(sendNotificationMock.mock.calls[0][1])) as {
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

    const response = await messagesPost(
      createJsonRequest(`http://localhost/api/v1/chats/${chat.id}/messages`, 'POST', {
        role: 'agent',
        senderId: 'agent-default',
        content: 'Agent message that fails push',
      }),
      chatContext(chat.id),
    );
    expect(response.status).toBe(201);

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      'Failed to send message.created push notification.',
      expect.any(Error),
    );
    expect(sendNotificationMock).not.toHaveBeenCalled();
  });

  it('contains push failures for request-created notifications', async () => {
    process.env.OPENGRAM_CONFIG_PATH = writePushEnabledConfig('A'.repeat(5000));
    resetPushServiceForTests();
    const chat = await createChat();

    const response = await chatRequestsPost(
      createJsonRequest(`http://localhost/api/v1/chats/${chat.id}/requests`, 'POST', {
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
      chatContext(chat.id),
    );
    expect(response.status).toBe(201);

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      'Failed to send request.created push notification.',
      expect.any(Error),
    );
    expect(sendNotificationMock).not.toHaveBeenCalled();
  });
});
