import { existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import Database from 'better-sqlite3';

const ensuredDbPaths = new Set<string>();

function resolveMigrationsDir() {
  if (process.env.OPENGRAM_MIGRATIONS_DIR) {
    return path.resolve(process.env.OPENGRAM_MIGRATIONS_DIR);
  }

  return path.resolve(process.cwd(), 'migrations');
}

function listMigrationFiles(migrationsDir: string) {
  if (!existsSync(migrationsDir)) {
    return [];
  }

  return readdirSync(migrationsDir)
    .filter((name) => name.endsWith('.sql'))
    .sort();
}

function getAppliedNames(db: Database.Database) {
  const rows = db
    .prepare('SELECT name FROM __opengram_migrations')
    .all() as Array<{ name: string }>;

  return new Set(rows.map((row) => row.name));
}

function applyMigrations(dbPath: string) {
  const migrationsDir = resolveMigrationsDir();
  const migrationFiles = listMigrationFiles(migrationsDir);
  if (!migrationFiles.length) {
    return;
  }

  const db = new Database(dbPath);
  try {
    db.pragma('foreign_keys = ON');
    db.pragma('journal_mode = WAL');
    db.exec(`
      CREATE TABLE IF NOT EXISTS __opengram_migrations (
        name TEXT PRIMARY KEY,
        applied_at INTEGER NOT NULL
      )
    `);

    const appliedNames = getAppliedNames(db);
    for (const fileName of migrationFiles) {
      if (appliedNames.has(fileName)) {
        continue;
      }

      const migrationPath = path.join(migrationsDir, fileName);
      const migrationSql = readFileSync(migrationPath, 'utf8');
      const applyMigration = db.transaction(() => {
        db.exec(migrationSql);
        db.prepare('INSERT INTO __opengram_migrations (name, applied_at) VALUES (?, ?)').run(
          fileName,
          Date.now(),
        );
      });
      applyMigration();
      appliedNames.add(fileName);
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
  applyMigrations(dbPath);
  ensuredDbPaths.add(dbPath);
}

export function resetSqliteReadyForTests() {
  ensuredDbPaths.clear();
}
