import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { GET as tagSuggestionsGet } from '@/app/api/v1/tags/suggestions/route';
import { PATCH as chatPatch } from '@/app/api/v1/chats/[chatId]/route';
import { POST as chatsPost } from '@/app/api/v1/chats/route';
import { resetWriteRateLimitForTests } from '@/src/api/write-controls';

type ChatContext = {
  params: Promise<{ chatId: string }>;
};

const repoRoot = join(import.meta.dirname, '..', '..');
const migrationSql = readFileSync(join(repoRoot, 'drizzle', '0000_initial.sql'), 'utf8');

let db: Database.Database;

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

async function createChat(tags: string[]) {
  const response = await chatsPost(
    createJsonRequest('http://localhost/api/v1/chats', 'POST', {
      title: 'tags-chat',
      agentIds: ['agent-default'],
      modelId: 'model-default',
      tags,
    }),
  );

  const body = await response.json();
  return { response, body };
}

beforeEach(() => {
  const tempDir = mkdtempSync(join(tmpdir(), 'opengram-tags-api-'));
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

describe('tags suggestions API', () => {
  it('returns empty suggestions when query is blank', async () => {
    await createChat(['alpha']);

    const response = await tagSuggestionsGet(new Request('http://localhost/api/v1/tags/suggestions?q='));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toEqual([]);
  });

  it('returns prefix suggestions sorted by usage_count desc and respects limit', async () => {
    const first = await createChat(['alpha', 'beta']);
    const second = await createChat(['alpha']);

    expect(first.response.status).toBe(201);
    expect(second.response.status).toBe(201);

    const secondChatId = second.body.id as string;

    const patchResponse = await chatPatch(
      createJsonRequest(`http://localhost/api/v1/chats/${secondChatId}`, 'PATCH', {
        tags: ['alpha', 'alpine', '  alpha  ', ''],
      }),
      chatContext(secondChatId),
    );

    expect(patchResponse.status).toBe(200);

    const response = await tagSuggestionsGet(
      new Request('http://localhost/api/v1/tags/suggestions?q=al&limit=2'),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toEqual([
      { name: 'alpha', usage_count: 2 },
      { name: 'alpine', usage_count: 1 },
    ]);
  });
});
