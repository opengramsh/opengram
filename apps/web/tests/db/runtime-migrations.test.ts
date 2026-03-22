import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { closeDb, getDb, resetDbForTests } from '@/src/db/client';
import { resetSqliteReadyForTests } from '@/src/db/migrations';

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
});
