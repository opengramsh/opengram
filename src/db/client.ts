import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';

import { schema } from './schema';

function getDefaultDbPath() {
  return process.env.DATABASE_URL ?? './data/opengram.db';
}

export function createSqliteConnection(dbPath: string = getDefaultDbPath()) {
  const sqlite = new Database(dbPath);

  // Required baseline pragmas for predictable SQLite behavior in production.
  sqlite.pragma('foreign_keys = ON');
  sqlite.pragma('journal_mode = WAL');

  return sqlite;
}

export function createDb(dbPath: string = getDefaultDbPath()) {
  const sqlite = createSqliteConnection(dbPath);
  return drizzle(sqlite, { schema });
}
