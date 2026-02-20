import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';

import { createSqliteConnection } from '@/src/db/client';
import { resetSqliteReadyForTests } from '@/src/db/migrations';

const repoRoot = join(import.meta.dirname, '..', '..');
const initialMigrationSql = readFileSync(join(repoRoot, 'drizzle', '0000_initial.sql'), 'utf8');

afterEach(() => {
  resetSqliteReadyForTests();
});

describe('runtime sqlite bootstrap', () => {
  it('creates and migrates a fresh local database path', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'opengram-runtime-migrations-'));
    const dbPath = join(tempDir, 'nested', 'opengram.db');

    const db = createSqliteConnection(dbPath);
    const chatsTable = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'chats'")
      .get() as { name: string } | undefined;
    db.close();

    expect(chatsTable?.name).toBe('chats');
  });

  it('handles databases that already have the baseline schema', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'opengram-runtime-migrations-existing-'));
    const dbPath = join(tempDir, 'opengram.db');

    const seeded = new Database(dbPath);
    seeded.exec(initialMigrationSql);
    seeded.close();

    const db = createSqliteConnection(dbPath);
    const tags = db
      .prepare('SELECT tag FROM __opengram_migrations ORDER BY tag ASC')
      .all() as Array<{ tag: string }>;
    db.close();

    expect(tags.map((row) => row.tag)).toEqual([
      '0001_messages_fts_trigger_upgrade',
      '0002_messages_stream_sweep_index',
    ]);
  });
});
