import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { GET as eventsStreamGet } from '@/app/api/v1/events/stream/route';

const repoRoot = join(import.meta.dirname, '..', '..');
const migrationSql = readFileSync(join(repoRoot, 'drizzle', '0000_initial.sql'), 'utf8');

let db: Database.Database;

function insertEvent(id: string, createdAt: number) {
  db.prepare('INSERT INTO events (id, type, payload, created_at) VALUES (?, ?, ?, ?)').run(
    id,
    'message.created',
    JSON.stringify({ chatId: 'chat-1' }),
    createdAt,
  );
}

async function readSomeChunks(
  response: Response,
  abort: AbortController,
  maxChunks: number,
  stopWhen?: (output: string) => boolean,
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
        setTimeout(() => reject(new Error('Timed out while reading SSE stream.')), 500);
      }),
    ]);

    if (readResult.done) {
      break;
    }

    output += decoder.decode(readResult.value);
    if (stopWhen?.(output)) {
      break;
    }

    if (output.includes('id: 222222222222222222222') && output.includes('id: 333333333333333333333')) {
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

  process.env.DATABASE_URL = dbPath;
  db = new Database(dbPath);
  db.exec(migrationSql);
});

afterEach(() => {
  db.close();
  delete process.env.DATABASE_URL;
});

describe('events stream API', () => {
  it('starts from latest cursor when cursor query is omitted', async () => {
    insertEvent('111111111111111111111', 1000);
    insertEvent('222222222222222222222', 2000);
    insertEvent('333333333333333333333', 3000);

    const abort = new AbortController();
    const response = await eventsStreamGet(
      new Request('http://localhost/api/v1/events/stream?limit=100', { signal: abort.signal }),
    );
    const output = await readSomeChunks(response, abort, 1);

    expect(response.status).toBe(200);
    expect(output).toContain(': stream opened');
    expect(output).not.toContain('event: message.created');
    expect(output).not.toContain('id: 111111111111111111111');
    expect(output).not.toContain('id: 222222222222222222222');
    expect(output).not.toContain('id: 333333333333333333333');
  });

  it('streams events newer than the provided cursor', async () => {
    insertEvent('111111111111111111111', 1000);
    insertEvent('222222222222222222222', 2000);
    insertEvent('333333333333333333333', 3000);

    const abort = new AbortController();
    const response = await eventsStreamGet(
      new Request('http://localhost/api/v1/events/stream?cursor=111111111111111111111&limit=100', { signal: abort.signal }),
    );
    const output = await readSomeChunks(response, abort, 4);

    expect(response.status).toBe(200);
    expect(output).toContain('id: 222222222222222222222');
    expect(output).toContain('id: 333333333333333333333');
    expect(output).not.toContain('id: 111111111111111111111');
  });

  it('streams newer events inserted at the same timestamp as cursor', async () => {
    insertEvent('zzzzzzzzzzzzzzzzzzzzz', 2000);
    insertEvent('aaaaaaaaaaaaaaaaaaaaa', 2000);
    insertEvent('mmmmmmmmmmmmmmmmmmmmm', 3000);

    const abort = new AbortController();
    const response = await eventsStreamGet(
      new Request('http://localhost/api/v1/events/stream?cursor=zzzzzzzzzzzzzzzzzzzzz&limit=100', { signal: abort.signal }),
    );
    const output = await readSomeChunks(
      response,
      abort,
      6,
      (value) => value.includes('id: aaaaaaaaaaaaaaaaaaaaa') && value.includes('id: mmmmmmmmmmmmmmmmmmmmm'),
    );

    expect(response.status).toBe(200);
    expect(output).toContain('id: aaaaaaaaaaaaaaaaaaaaa');
    expect(output).toContain('id: mmmmmmmmmmmmmmmmmmmmm');
    expect(output).not.toContain('id: zzzzzzzzzzzzzzzzzzzzz');
  });
});
