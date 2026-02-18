import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { GET as mediaGet, POST as mediaPost } from '@/app/api/v1/chats/[chatId]/media/route';
import { POST as chatsPost } from '@/app/api/v1/chats/route';
import { GET as fileGet } from '@/app/api/v1/files/[mediaId]/route';
import { resetWriteRateLimitForTests } from '@/src/api/write-controls';

type ChatContext = { params: Promise<{ chatId: string }> };
type MediaContext = { params: Promise<{ mediaId: string }> };

const repoRoot = join(import.meta.dirname, '..', '..');
const migrationSql = readFileSync(join(repoRoot, 'drizzle', '0000_initial.sql'), 'utf8');

let db: Database.Database;
let tempDir: string;

function chatContext(chatId: string): ChatContext {
  return { params: Promise.resolve({ chatId }) };
}

function mediaContext(mediaId: string): MediaContext {
  return { params: Promise.resolve({ mediaId }) };
}

function createJsonRequest(url: string, method: string, body?: unknown) {
  return new Request(url, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'opengram-media-api-'));
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

describe('media API', () => {
  it('uploads base64 audio media, lists by chat, and serves file bytes', async () => {
    const chatResponse = await chatsPost(
      createJsonRequest('http://localhost/api/v1/chats', 'POST', {
        title: 'media-chat',
        agentIds: ['agent-default'],
        modelId: 'model-default',
      }),
    );
    const chat = await chatResponse.json();

    const uploadResponse = await mediaPost(
      createJsonRequest(`http://localhost/api/v1/chats/${chat.id}/media`, 'POST', {
        fileName: 'voice.webm',
        contentType: 'audio/webm',
        base64Data: Buffer.from('fake-audio').toString('base64'),
      }),
      chatContext(chat.id),
    );
    const uploaded = await uploadResponse.json();

    expect(uploadResponse.status).toBe(201);
    expect(uploaded.kind).toBe('audio');

    const listResponse = await mediaGet(
      createJsonRequest(`http://localhost/api/v1/chats/${chat.id}/media`, 'GET'),
      chatContext(chat.id),
    );
    const listed = await listResponse.json();

    expect(listResponse.status).toBe(200);
    expect(listed.data).toHaveLength(1);
    expect(listed.data[0].id).toBe(uploaded.id);

    const fileResponse = await fileGet(
      createJsonRequest(`http://localhost/api/v1/files/${uploaded.id}`, 'GET'),
      mediaContext(uploaded.id),
    );

    expect(fileResponse.status).toBe(200);
    expect(fileResponse.headers.get('content-type')).toBe('audio/webm');
    await expect(fileResponse.text()).resolves.toBe('fake-audio');

    const event = db
      .prepare('SELECT type, payload FROM events ORDER BY created_at DESC LIMIT 1')
      .get() as { type: string; payload: string };
    expect(event.type).toBe('media.attached');
    expect(JSON.parse(event.payload)).toMatchObject({
      chatId: chat.id,
      mediaId: uploaded.id,
      kind: 'audio',
    });
  });
});
