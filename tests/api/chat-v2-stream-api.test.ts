import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { app } from '@/src/server';
import { closeDb, resetDbForTests } from '@/src/db/client';
import { resetWriteRateLimitForTests } from '@/src/api/write-controls';
import {
  emitEvent,
  resetEventSubscribersForTests,
} from '@/src/services/events-service';
import {
  resetStreamingTimeoutSweeperForTests,
} from '@/src/services/messages-service';
import { resetConfigCacheForTests } from '@/src/config/opengram-config';

const repoRoot = join(import.meta.dirname, '..', '..');
const migrationSql = readFileSync(join(repoRoot, 'migrations', '0000_initial.sql'), 'utf8');

let db: Database.Database;

async function createChat() {
  const response = await app.request('/api/v1/chats', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      title: 'v2-test-chat',
      agentIds: ['agent-default'],
      modelId: 'model-default',
    }),
  });
  const json = (await response.json()) as { id: string };
  if (response.status !== 201) {
    throw new Error(`createChat failed with ${response.status}: ${JSON.stringify(json)}`);
  }
  return json;
}

beforeEach(() => {
  const tempDir = mkdtempSync(join(tmpdir(), 'opengram-chat-v2-api-'));
  const dbPath = join(tempDir, 'test.db');

  process.env.DATABASE_URL = dbPath;
  db = new Database(dbPath);
  db.exec(migrationSql);
  resetDbForTests();
  resetWriteRateLimitForTests();
  resetEventSubscribersForTests();
  resetStreamingTimeoutSweeperForTests();

  const baseConfig = JSON.parse(readFileSync(join(repoRoot, 'config', 'opengram.config.json'), 'utf8'));
  baseConfig.security = {
    ...baseConfig.security,
    instanceSecretEnabled: false,
    readEndpointsRequireInstanceSecret: false,
  };
  // Ensure test agent/model IDs exist in config
  if (!baseConfig.agents.some((a: { id: string }) => a.id === 'agent-default')) {
    baseConfig.agents.push({ id: 'agent-default', name: 'Test Agent' });
  }
  if (!baseConfig.models.some((m: { id: string }) => m.id === 'model-default')) {
    baseConfig.models.push({ id: 'model-default', name: 'Test Model' });
  }
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

describe('v2 chat stream API', () => {
  it('returns 404 for non-existent chat', async () => {
    const response = await app.request('/api/v2/chats/nonexistent/stream', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: 'hello' }),
    });

    expect(response.status).toBe(404);
  });

  it('returns 400 when message is empty', async () => {
    const chat = await createChat();
    const response = await app.request(`/api/v2/chats/${chat.id}/stream`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: '' }),
    });

    expect(response.status).toBe(400);
  });

  it('creates a user message and starts SSE stream', async () => {
    const chat = await createChat();

    // Start the stream in background
    const responsePromise = app.request(`/api/v2/chats/${chat.id}/stream`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: 'Hello from v2' }),
    });

    // Wait a tick for the user message to be created
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Verify user message was created
    const messagesResponse = await app.request(`/api/v1/chats/${chat.id}/messages`);
    const messagesPayload = (await messagesResponse.json()) as { data: Array<{ role: string; content_final: string }> };
    const userMessages = messagesPayload.data.filter((m) => m.role === 'user');
    expect(userMessages.length).toBe(1);
    expect(userMessages[0].content_final).toBe('Hello from v2');

    // Simulate a non-streaming agent response to complete the stream
    emitEvent('message.created', {
      chatId: chat.id,
      messageId: 'agent-msg-1',
      role: 'agent',
      senderId: 'agent-default',
      streamState: 'none',
      contentFinal: 'Hello back!',
      createdAt: new Date().toISOString(),
    });

    const response = await responsePromise;
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/event-stream');

    const body = await response.text();
    // Verify it contains AI SDK v6 UIMessage stream chunks
    expect(body).toContain('"type":"start"');
    expect(body).toContain('"type":"text-delta"');
    expect(body).toContain('"type":"finish"');
    expect(body).toContain('data: [DONE]');
  });

  it('streams chunks from a streaming agent message', async () => {
    const chat = await createChat();

    const responsePromise = app.request(`/api/v2/chats/${chat.id}/stream`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: 'stream test' }),
    });

    await new Promise((resolve) => setTimeout(resolve, 50));

    // Simulate streaming agent message creation
    const agentMsgId = 'agent-stream-1';
    emitEvent('message.created', {
      chatId: chat.id,
      messageId: agentMsgId,
      role: 'agent',
      senderId: 'agent-default',
      streamState: 'streaming',
      createdAt: new Date().toISOString(),
    });

    // Wait a tick then send chunks
    await new Promise((resolve) => setTimeout(resolve, 20));
    emitEvent('message.streaming.chunk', {
      chatId: chat.id,
      messageId: agentMsgId,
      deltaText: 'Hello ',
    }, { ephemeral: true });

    await new Promise((resolve) => setTimeout(resolve, 20));
    emitEvent('message.streaming.chunk', {
      chatId: chat.id,
      messageId: agentMsgId,
      deltaText: 'world!',
    }, { ephemeral: true });

    // Complete the stream
    await new Promise((resolve) => setTimeout(resolve, 20));
    emitEvent('message.streaming.complete', {
      chatId: chat.id,
      messageId: agentMsgId,
      streamState: 'complete',
      finalText: 'Hello world!',
    });

    const response = await responsePromise;
    expect(response.status).toBe(200);

    const body = await response.text();
    expect(body).toContain('"type":"start"');
    expect(body).toContain('"type":"text-start"');
    expect(body).toContain('"type":"text-delta"');
    expect(body).toContain('"type":"text-end"');
    expect(body).toContain('"type":"finish-step"');
    expect(body).toContain('"type":"finish"');
    expect(body).toContain('data: [DONE]');
    // Verify the actual content deltas
    expect(body).toContain('"delta":"Hello "');
    expect(body).toContain('"delta":"world!"');
  });
});
