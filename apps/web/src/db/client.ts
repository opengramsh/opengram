import Database from 'better-sqlite3';

import { ensureSqliteReady } from './migrations';

function getDefaultDbPath() {
  return process.env.DATABASE_URL ?? './data/opengram.db';
}

let instance: Database.Database | null = null;

export function getDb(dbPath: string = getDefaultDbPath()): Database.Database {
  if (instance) {
    return instance;
  }

  ensureSqliteReady(dbPath);

  const sqlite = new Database(dbPath);

  // Performance tuning (set once, persists for connection lifetime)
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  sqlite.pragma('synchronous = NORMAL');
  sqlite.pragma('busy_timeout = 5000');
  sqlite.pragma('cache_size = -20000');       // 20MB page cache
  sqlite.pragma('mmap_size = 268435456');     // 256MB memory-mapped I/O
  sqlite.pragma('temp_store = MEMORY');

  instance = sqlite;
  return instance;
}

export function closeDb() {
  if (instance) {
    instance.close();
    instance = null;
  }
}

export function resetDbForTests() {
  instance = null;
}

// Graceful shutdown
process.on('SIGTERM', () => closeDb());
process.on('SIGINT', () => closeDb());
