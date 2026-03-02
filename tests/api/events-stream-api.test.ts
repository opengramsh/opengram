import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { app } from '@/src/server';
import { closeDb, resetDbForTests } from '@/src/db/client';
import { emitEvent, getEventSubscriberCountForTests, resetEventSubscribersForTests } from '@/src/services/events-service';
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

function insertPersistedEvent(id: string, type: string, createdAt: number) {
  db.prepare('INSERT INTO events (id, type, payload, created_at) VALUES (?, ?, ?, ?)').run(
    id,
    type,
    JSON.stringify({ chatId: 'chat-1' }),
    createdAt,
  );
}

function setInstanceSecretConfig(secret: string) {
  const config = structuredClone(TEST_BASE_CONFIG);
  config.security = {
    ...config.security,
    instanceSecretEnabled: true,
    instanceSecret: secret,
  };
  const tempDir = mkdtempSync(join(tmpdir(), 'opengram-events-stream-config-'));
  const configPath = join(tempDir, 'opengram.config.json');
  writeFileSync(configPath, JSON.stringify(config), 'utf8');
  process.env.OPENGRAM_CONFIG_PATH = configPath;
  resetConfigCacheForTests();
}

async function readSseOutput(
  response: Response,
  abort: AbortController,
  stopWhen: (output: string) => boolean,
  maxChunks = 8,
) {
  const body = response.body;
  if (!body) {
    return '';
  }

  const reader = body.getReader();
  const decoder = new TextDecoder();
  let output = '';

  for (let index = 0; index < maxChunks; index += 1) {
    const readResult = await Promise.race([
      reader.read(),
      new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('Timed out while reading SSE stream.')), 750);
      }),
    ]);

    if (readResult.done) {
      break;
    }

    output += decoder.decode(readResult.value);
    if (stopWhen(output)) {
      break;
    }
  }

  abort.abort();
  await reader.cancel();
  return output;
}

beforeEach(() => {
  const tempDir = mkdtempSync(join(tmpdir(), 'opengram-events-stream-api-'));
  const dbPath = join(tempDir, 'test.db');

  previousConfigPath = process.env.OPENGRAM_CONFIG_PATH;
  process.env.DATABASE_URL = dbPath;
  db = new Database(dbPath);
  db.exec(migrationSql);
  db.exec("CREATE TABLE IF NOT EXISTS __opengram_migrations (name TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)");
  db.prepare("INSERT INTO __opengram_migrations (name, applied_at) VALUES (?, ?)").run('0000_initial.sql', Date.now());
  resetDbForTests();
  resetEventSubscribersForTests();

  const configPath = join(tempDir, 'opengram.config.json');
  writeFileSync(configPath, JSON.stringify(TEST_BASE_CONFIG), 'utf8');
  process.env.OPENGRAM_CONFIG_PATH = configPath;
  resetConfigCacheForTests();
});

afterEach(() => {
  closeDb();
  db.close();
  delete process.env.DATABASE_URL;
  resetEventSubscribersForTests();
  if (previousConfigPath === undefined) {
    delete process.env.OPENGRAM_CONFIG_PATH;
  } else {
    process.env.OPENGRAM_CONFIG_PATH = previousConfigPath;
  }
  resetConfigCacheForTests();
});

describe('events stream API', () => {
  it('starts from latest persisted cursor when cursor query is omitted, then streams live events', async () => {
    insertPersistedEvent('111111111111111111111', 'chat.created', 1000);
    insertPersistedEvent('222222222222222222222', 'chat.updated', 2000);

    const abort = new AbortController();
    const response = await app.request(
      new Request('http://localhost/api/v1/events/stream?ephemeral=true', { signal: abort.signal }),
    );

    emitEvent('chat.archived', { chatId: 'chat-1' }, { id: '333333333333333333333', timestampMs: 3000 });

    const output = await readSseOutput(
      response,
      abort,
      (value) => value.includes('id: 333333333333333333333'),
    );

    expect(response.status).toBe(200);
    expect(output).toContain(': stream opened');
    expect(output).toContain('id: 333333333333333333333');
    expect(output).not.toContain('id: 111111111111111111111');
    expect(output).not.toContain('id: 222222222222222222222');
  });

  it('replays persisted events after cursor and includes subsequent live events', async () => {
    insertPersistedEvent('111111111111111111111', 'chat.created', 1000);
    insertPersistedEvent('222222222222222222222', 'chat.updated', 2000);
    insertPersistedEvent('333333333333333333333', 'message.created', 3000);

    const abort = new AbortController();
    const response = await app.request(
      new Request('http://localhost/api/v1/events/stream?cursor=111111111111111111111&ephemeral=true', { signal: abort.signal }),
    );

    emitEvent('chat.unarchived', { chatId: 'chat-1' }, { id: '444444444444444444444', timestampMs: 4000 });

    const output = await readSseOutput(
      response,
      abort,
      (value) => (
        value.includes('id: 222222222222222222222')
        && value.includes('id: 333333333333333333333')
        && value.includes('id: 444444444444444444444')
      ),
      10,
    );

    expect(response.status).toBe(200);
    expect(output).toContain('id: 222222222222222222222');
    expect(output).toContain('id: 333333333333333333333');
    expect(output).toContain('id: 444444444444444444444');
    expect(output).not.toContain('id: 111111111111111111111');
  });

  it('includes ephemeral chunk events only for ephemeral=true subscribers and never persists chunk events', async () => {
    const trueAbort = new AbortController();
    const falseAbort = new AbortController();

    const ephemeralTrueResponse = await app.request(
      new Request('http://localhost/api/v1/events/stream?ephemeral=true', { signal: trueAbort.signal }),
    );
    const ephemeralFalseResponse = await app.request(
      new Request('http://localhost/api/v1/events/stream?ephemeral=false', { signal: falseAbort.signal }),
    );

    emitEvent(
      'message.streaming.chunk',
      {
        chatId: 'chat-1',
        messageId: '555555555555555555555',
        delta: 'hello',
      },
      {
        id: '666666666666666666666',
        ephemeral: true,
        timestampMs: 5000,
      },
    );

    const [ephemeralTrueOutput, ephemeralFalseOutput] = await Promise.all([
      readSseOutput(ephemeralTrueResponse, trueAbort, (value) => value.includes('id: 666666666666666666666')),
      readSseOutput(ephemeralFalseResponse, falseAbort, (value) => value.includes(': stream opened'), 1),
    ]);

    expect(ephemeralTrueResponse.status).toBe(200);
    expect(ephemeralFalseResponse.status).toBe(200);
    expect(ephemeralTrueOutput).toContain('id: 666666666666666666666');
    expect(ephemeralTrueOutput).toContain('event: message.streaming.chunk');
    expect(ephemeralFalseOutput).not.toContain('id: 666666666666666666666');

    const persistedChunkCount = (
      db.prepare('SELECT COUNT(*) as count FROM events WHERE type = ?').get('message.streaming.chunk') as { count: number }
    ).count;
    expect(persistedChunkCount).toBe(0);
  });

  it('returns validation error when cursor does not exist', async () => {
    const response = await app.request(
      new Request('http://localhost/api/v1/events/stream?cursor=missing-cursor-id'),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'cursor event id was not found.',
        details: {
          field: 'cursor',
        },
      },
    });
  });

  it('enforces stream auth when instance secret is enabled', async () => {
    setInstanceSecretConfig('stream-secret');

    const unauthorized = await app.request(
      new Request('http://localhost/api/v1/events/stream?ephemeral=true'),
    );
    expect(unauthorized.status).toBe(401);
    await expect(unauthorized.json()).resolves.toEqual({
      error: {
        code: 'UNAUTHORIZED',
        message: 'Missing or invalid instance secret.',
        details: undefined,
      },
    });

    const abort = new AbortController();
    const authorized = await app.request(
      new Request('http://localhost/api/v1/events/stream?ephemeral=true', {
        signal: abort.signal,
        headers: {
          authorization: 'Bearer stream-secret',
        },
      }),
    );

    expect(authorized.status).toBe(200);

    const output = await readSseOutput(authorized, abort, (value) => value.includes(': stream opened'), 1);
    expect(output).toContain(': stream opened');
  });

  it('does not retain subscribers when the request is already aborted', async () => {
    const abort = new AbortController();
    abort.abort();

    const response = await app.request(
      new Request('http://localhost/api/v1/events/stream?ephemeral=true', {
        signal: abort.signal,
      }),
    );

    expect(response.status).toBe(200);
    expect(getEventSubscriberCountForTests()).toBe(0);
  });

  it('returns SSE-specific response headers', async () => {
    const abort = new AbortController();
    const response = await app.request(
      new Request('http://localhost/api/v1/events/stream?ephemeral=true', { signal: abort.signal }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('text/event-stream');
    expect(response.headers.get('Cache-Control')).toBe('no-cache, no-transform');
    expect(response.headers.get('Connection')).toBe('keep-alive');
    expect(response.headers.get('X-Accel-Buffering')).toBe('no');

    abort.abort();
    await response.body?.cancel();
  });

  it('does not apply compression to SSE stream responses', async () => {
    const abort = new AbortController();
    const response = await app.request(
      new Request('http://localhost/api/v1/events/stream?ephemeral=true', {
        signal: abort.signal,
        headers: {
          'accept-encoding': 'gzip',
        },
      }),
    );

    emitEvent(
      'chat.updated',
      { chatId: 'chat-1', note: 'x'.repeat(5000) },
      { id: '777777777777777777777', timestampMs: 7000 },
    );

    const output = await readSseOutput(
      response,
      abort,
      (value) => value.includes('id: 777777777777777777777'),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Encoding')).toBeNull();
    expect(output).toContain('id: 777777777777777777777');
  });
});
