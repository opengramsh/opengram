import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { app } from '@/src/server';
import { closeDb, resetDbForTests } from '@/src/db/client';
import { resetWriteRateLimitForTests } from '@/src/api/write-controls';
import { resetConfigCacheForTests } from '@/src/config/opengram-config';

const repoRoot = join(import.meta.dirname, '..', '..');
const migrationSql = readFileSync(join(repoRoot, 'migrations', '0000_initial.sql'), 'utf8');

const TEST_BASE_CONFIG = {
  appName: 'OpenGram',
  maxUploadBytes: 50_000_000,
  allowedMimeTypes: ['*/*'],
  titleMaxChars: 48,
  agents: [{ id: 'agent-default', name: 'Test Agent', description: 'test', defaultModelId: 'model-default' }],
  models: [{ id: 'model-default', name: 'Test Model', description: 'test' }],
  push: { enabled: false, vapidPublicKey: '', vapidPrivateKey: '', subject: '' },
  security: { instanceSecretEnabled: false, instanceSecret: '', readEndpointsRequireInstanceSecret: false },
  server: { publicBaseUrl: 'http://localhost:3333', port: 3333, streamTimeoutSeconds: 60, corsOrigins: [] },
  hooks: [],
};

let db: Database.Database;
let previousConfigPath: string | undefined;

async function createChat(tags: string[]) {
  const response = await app.request('/api/v1/chats', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      title: 'tags-chat',
      agentIds: ['agent-default'],
      modelId: 'model-default',
      tags,
    }),
  });

  const body = await response.json();
  return { response, body };
}

beforeEach(() => {
  const tempDir = mkdtempSync(join(tmpdir(), 'opengram-tags-api-'));
  const dbPath = join(tempDir, 'test.db');

  previousConfigPath = process.env.OPENGRAM_CONFIG_PATH;
  process.env.DATABASE_URL = dbPath;
  db = new Database(dbPath);
  db.exec(migrationSql);
  resetDbForTests();
  resetWriteRateLimitForTests();

  const configPath = join(tempDir, 'opengram.config.json');
  writeFileSync(configPath, JSON.stringify(TEST_BASE_CONFIG), 'utf8');
  process.env.OPENGRAM_CONFIG_PATH = configPath;
  resetConfigCacheForTests();
});

afterEach(() => {
  closeDb();
  db.close();
  delete process.env.DATABASE_URL;
  if (previousConfigPath === undefined) {
    delete process.env.OPENGRAM_CONFIG_PATH;
  } else {
    process.env.OPENGRAM_CONFIG_PATH = previousConfigPath;
  }
  resetWriteRateLimitForTests();
  resetConfigCacheForTests();
});

describe('tags suggestions API', () => {
  it('returns empty suggestions when query is blank', async () => {
    await createChat(['alpha']);

    const response = await app.request('/api/v1/tags/suggestions?q=');
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

    const patchResponse = await app.request('/api/v1/chats/' + secondChatId, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        tags: ['alpha', 'alpine', '  alpha  ', ''],
      }),
    });

    expect(patchResponse.status).toBe(200);

    const response = await app.request('/api/v1/tags/suggestions?q=al&limit=2');
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toEqual([
      { name: 'alpha', usage_count: 2 },
      { name: 'alpine', usage_count: 1 },
    ]);
  });
});
