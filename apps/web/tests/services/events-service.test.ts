import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { emitEvent, resetEventSubscribersForTests, subscribeToEvents } from '@/src/services/events-service';

const repoRoot = join(import.meta.dirname, '..', '..');
const migrationSql = readFileSync(join(repoRoot, 'migrations', '0000_initial.sql'), 'utf8');

let db: Database.Database;

beforeEach(() => {
  const tempDir = mkdtempSync(join(tmpdir(), 'opengram-events-service-'));
  const dbPath = join(tempDir, 'test.db');

  process.env.DATABASE_URL = dbPath;
  db = new Database(dbPath);
  db.exec(migrationSql);
  db.exec("CREATE TABLE IF NOT EXISTS __opengram_migrations (name TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)");
  db.prepare("INSERT INTO __opengram_migrations (name, applied_at) VALUES (?, ?)").run('0000_initial.sql', Date.now());
  resetEventSubscribersForTests();
});

afterEach(() => {
  db.close();
  delete process.env.DATABASE_URL;
  resetEventSubscribersForTests();
});

describe('events service', () => {
  it('isolates subscriber callback failures and removes failing subscribers', () => {
    let failingSubscriberCalls = 0;
    let healthySubscriberCalls = 0;

    subscribeToEvents(true, () => {
      failingSubscriberCalls += 1;
      throw new Error('subscriber failure');
    });

    subscribeToEvents(true, () => {
      healthySubscriberCalls += 1;
    });

    expect(() => {
      emitEvent('chat.updated', { chatId: 'chat-1' }, { id: '111111111111111111111', timestampMs: 1000 });
    }).not.toThrow();

    expect(() => {
      emitEvent('chat.updated', { chatId: 'chat-1' }, { id: '222222222222222222222', timestampMs: 2000 });
    }).not.toThrow();

    expect(failingSubscriberCalls).toBe(1);
    expect(healthySubscriberCalls).toBe(2);
  });
});
