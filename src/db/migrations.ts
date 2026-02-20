import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import Database from 'better-sqlite3';

type MigrationEntry = {
  idx: number;
  tag: string;
  when: number;
};

const ensuredDbPaths = new Set<string>();

function resolveMigrationsDir() {
  if (process.env.OPENGRAM_MIGRATIONS_DIR) {
    return path.resolve(process.env.OPENGRAM_MIGRATIONS_DIR);
  }

  return path.resolve(process.cwd(), 'drizzle');
}

function getMigrationEntries(journalPath: string) {
  const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as { entries?: unknown };
  const entries = Array.isArray(journal.entries) ? journal.entries : [];

  return entries
    .filter(
      (entry): entry is MigrationEntry => (
        typeof entry === 'object'
        && entry !== null
        && typeof (entry as { idx?: unknown }).idx === 'number'
        && typeof (entry as { tag?: unknown }).tag === 'string'
        && typeof (entry as { when?: unknown }).when === 'number'
      ),
    )
    .sort((left, right) => left.idx - right.idx);
}

function tableExists(db: Database.Database, tableName: string) {
  const row = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(tableName);
  return Boolean(row);
}

function getDrizzleCreatedAtColumn(db: Database.Database) {
  const columns = db.prepare('PRAGMA table_info(__drizzle_migrations)').all() as Array<{ name: string }>;
  const knownColumn = columns.find((column) => column.name === 'created_at' || column.name === 'createdAt');
  return knownColumn?.name ?? null;
}

function getAppliedTags(db: Database.Database, entries: MigrationEntry[]) {
  const appliedTags = new Set<string>();

  const trackedRows = db.prepare('SELECT tag FROM __opengram_migrations').all() as Array<{ tag: string }>;
  for (const row of trackedRows) {
    if (typeof row.tag === 'string') {
      appliedTags.add(row.tag);
    }
  }

  if (tableExists(db, '__drizzle_migrations')) {
    const drizzleCreatedAtColumn = getDrizzleCreatedAtColumn(db);
    if (drizzleCreatedAtColumn) {
      const drizzleRows = db
        .prepare(`SELECT "${drizzleCreatedAtColumn}" AS created_at FROM __drizzle_migrations`)
        .all() as Array<{ created_at: number }>;
      const tagByWhen = new Map(entries.map((entry) => [Number(entry.when), entry.tag]));
      for (const row of drizzleRows) {
        const tag = tagByWhen.get(Number(row.created_at));
        if (tag) {
          appliedTags.add(tag);
        }
      }
    }
  }

  if (appliedTags.size === 0 && entries[0] && tableExists(db, 'chats')) {
    // Legacy/test databases may have schema applied without migration bookkeeping.
    appliedTags.add(entries[0].tag);
  }

  return appliedTags;
}

function applyMigrations(dbPath: string) {
  const migrationsDir = resolveMigrationsDir();
  const journalPath = path.join(migrationsDir, 'meta', '_journal.json');
  if (!existsSync(journalPath)) {
    return;
  }

  const entries = getMigrationEntries(journalPath);
  if (!entries.length) {
    return;
  }

  const db = new Database(dbPath);
  try {
    db.pragma('foreign_keys = ON');
    db.pragma('journal_mode = WAL');
    db.exec(`
      CREATE TABLE IF NOT EXISTS __opengram_migrations (
        tag TEXT PRIMARY KEY,
        applied_at INTEGER NOT NULL
      )
    `);

    const appliedTags = getAppliedTags(db, entries);
    for (const entry of entries) {
      if (appliedTags.has(entry.tag)) {
        continue;
      }

      const migrationPath = path.join(migrationsDir, `${entry.tag}.sql`);
      if (!existsSync(migrationPath)) {
        throw new Error(`Migration file not found: ${migrationPath}`);
      }

      const migrationSql = readFileSync(migrationPath, 'utf8');
      const applyMigration = db.transaction(() => {
        db.exec(migrationSql);
        db.prepare('INSERT INTO __opengram_migrations (tag, applied_at) VALUES (?, ?)').run(
          entry.tag,
          Date.now(),
        );
      });
      applyMigration();
      appliedTags.add(entry.tag);
    }
  } finally {
    db.close();
  }
}

export function ensureSqliteReady(dbPath: string) {
  if (ensuredDbPaths.has(dbPath)) {
    return;
  }

  mkdirSync(path.dirname(dbPath), { recursive: true });

  if (process.env.NODE_ENV !== 'production') {
    applyMigrations(dbPath);
  }

  ensuredDbPaths.add(dbPath);
}

export function resetSqliteReadyForTests() {
  ensuredDbPaths.clear();
}
