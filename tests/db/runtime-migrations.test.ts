import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';

import { closeDb, getDb, resetDbForTests } from '@/src/db/client';
import { resetSqliteReadyForTests } from '@/src/db/migrations';

const repoRoot = join(import.meta.dirname, '..', '..');
const initialMigrationSql = readFileSync(join(repoRoot, 'migrations', '0000_initial.sql'), 'utf8');

afterEach(() => {
  closeDb();
  resetDbForTests();
  resetSqliteReadyForTests();
  delete process.env.DATABASE_URL;
});

describe('runtime sqlite bootstrap', () => {
  it('creates and migrates a fresh local database path', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'opengram-runtime-migrations-'));
    const dbPath = join(tempDir, 'nested', 'opengram.db');
    process.env.DATABASE_URL = dbPath;

    const db = getDb();
    const chatsTable = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'chats'")
      .get() as { name: string } | undefined;

    expect(chatsTable?.name).toBe('chats');
    expect(getDb()).toBe(db);

    const journalMode = db.pragma('journal_mode', { simple: true }) as string;
    const synchronous = db.pragma('synchronous', { simple: true }) as number;
    const busyTimeout = db.pragma('busy_timeout', { simple: true }) as number;
    const cacheSize = db.pragma('cache_size', { simple: true }) as number;
    const mmapSize = db.pragma('mmap_size', { simple: true }) as number;
    const tempStore = db.pragma('temp_store', { simple: true }) as number;
    const foreignKeys = db.pragma('foreign_keys', { simple: true }) as number;

    expect(journalMode.toLowerCase()).toBe('wal');
    expect(synchronous).toBe(1); // NORMAL
    expect(busyTimeout).toBe(5000);
    expect(cacheSize).toBe(-20000);
    expect(mmapSize).toBe(268435456);
    expect(tempStore).toBe(2); // MEMORY
    expect(foreignKeys).toBe(1);
  });

  it('handles databases that already have the baseline schema', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'opengram-runtime-migrations-existing-'));
    const dbPath = join(tempDir, 'opengram.db');

    const seeded = new Database(dbPath);
    seeded.exec(initialMigrationSql);
    seeded.close();

    process.env.DATABASE_URL = dbPath;
    const db = getDb();
    const rows = db
      .prepare('SELECT name FROM __opengram_migrations ORDER BY name ASC')
      .all() as Array<{ name: string }>;

    expect(rows.map((row) => row.name)).toEqual([
      '0001_messages_fts_trigger_upgrade.sql',
      '0002_messages_stream_sweep_index.sql',
      '0003_add_notifications_muted.sql',
    ]);
  });

  it('supports legacy __opengram_migrations tag column', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'opengram-runtime-migrations-legacy-tags-'));
    const dbPath = join(tempDir, 'opengram.db');

    const seeded = new Database(dbPath);
    seeded.exec(initialMigrationSql);
    seeded.exec(`
      CREATE TABLE __opengram_migrations (
        tag TEXT PRIMARY KEY,
        applied_at INTEGER NOT NULL
      )
    `);
    seeded
      .prepare('INSERT INTO __opengram_migrations (tag, applied_at) VALUES (?, ?)')
      .run('0001_messages_fts_trigger_upgrade.sql', Date.now());
    seeded.close();

    process.env.DATABASE_URL = dbPath;
    const db = getDb();
    const rows = db
      .prepare('SELECT tag FROM __opengram_migrations ORDER BY tag ASC')
      .all() as Array<{ tag: string }>;

    expect(rows.map((row) => row.tag)).toEqual([
      '0001_messages_fts_trigger_upgrade.sql',
      '0002_messages_stream_sweep_index.sql',
      '0003_add_notifications_muted.sql',
    ]);
  });
});
