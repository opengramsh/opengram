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

function tableExists(db: Database.Database, tableName: string) {
  const row = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(tableName);
  return Boolean(row);
}

function listMigrationFiles(migrationsDir: string) {
  if (!existsSync(migrationsDir)) {
    return [];
  }

  return readdirSync(migrationsDir)
    .filter((name) => name.endsWith('.sql'))
    .sort();
}

function resolveMigrationTrackingColumn(db: Database.Database) {
  const columns = db.prepare('PRAGMA table_info(__opengram_migrations)').all() as Array<{ name: string }>;
  const columnNames = new Set(columns.map((column) => column.name));
  if (columnNames.has('name')) {
    return 'name';
  }

  if (columnNames.has('tag')) {
    return 'tag';
  }

  if (columnNames.has('hash')) {
    return 'hash';
  }

  return null;
}

function getAppliedNames(db: Database.Database, migrationFiles: string[], trackingColumn: string | null) {
  const appliedNames = new Set<string>();

  if (trackingColumn) {
    const trackedRows = db
      .prepare(`SELECT "${trackingColumn}" AS name FROM __opengram_migrations`)
      .all() as Array<{ name: string }>;
    for (const row of trackedRows) {
      if (typeof row.name === 'string') {
        appliedNames.add(row.name);
      }
    }
  }

  if (tableExists(db, '__drizzle_migrations')) {
    const columns = db.prepare('PRAGMA table_info(__drizzle_migrations)').all() as Array<{ name: string }>;
    const legacyNameColumn = columns.find((column) => column.name === 'hash' || column.name === 'tag');
    if (legacyNameColumn) {
      const legacyRows = db
        .prepare(`SELECT "${legacyNameColumn.name}" AS name FROM __drizzle_migrations`)
        .all() as Array<{ name: string | null }>;
      const knownFiles = new Set(migrationFiles);
      for (const row of legacyRows) {
        if (typeof row.name !== 'string' || !row.name) {
          continue;
        }

        const directMatch = row.name;
        const sqlMatch = `${row.name}.sql`;

        if (knownFiles.has(directMatch)) {
          appliedNames.add(directMatch);
        } else if (knownFiles.has(sqlMatch)) {
          appliedNames.add(sqlMatch);
        }
      }
    }
  }

  if (migrationFiles[0] && tableExists(db, 'chats')) {
    // Existing databases with baseline schema should never replay initial migration.
    appliedNames.add(migrationFiles[0]);
  }

  return appliedNames;
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

    const trackingColumn = resolveMigrationTrackingColumn(db);
    if (!trackingColumn) {
      throw new Error('Unable to resolve migration tracking column for __opengram_migrations');
    }

    const appliedNames = getAppliedNames(db, migrationFiles, trackingColumn);
    for (const fileName of migrationFiles) {
      if (appliedNames.has(fileName)) {
        continue;
      }

      const migrationPath = path.join(migrationsDir, fileName);
      const migrationSql = readFileSync(migrationPath, 'utf8');
      const applyMigration = db.transaction(() => {
        db.exec(migrationSql);
        db.prepare(`INSERT INTO __opengram_migrations ("${trackingColumn}", applied_at) VALUES (?, ?)`).run(
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

  if (process.env.NODE_ENV !== 'production') {
    applyMigrations(dbPath);
  }

  ensuredDbPaths.add(dbPath);
}

export function resetSqliteReadyForTests() {
  ensuredDbPaths.clear();
}
