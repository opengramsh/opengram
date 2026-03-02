import fs from "node:fs";
import path from "node:path";

import Database from "better-sqlite3";

const DEFAULT_DB_PATH = "/opt/opengram/data/opengram.db";
const DEFAULT_MIGRATIONS_DIR = "/opt/opengram/web/migrations";

function listMigrationFiles(migrationsDir) {
  if (!fs.existsSync(migrationsDir)) {
    return [];
  }

  return fs
    .readdirSync(migrationsDir)
    .filter((entry) => entry.endsWith(".sql"))
    .sort();
}

function getAppliedNames(db) {
  const rows = db
    .prepare("SELECT name FROM __opengram_migrations")
    .all();

  return new Set(rows.map((row) => row.name));
}

function main() {
  const dbPath = process.env.DATABASE_URL || DEFAULT_DB_PATH;
  const migrationsDir = process.env.OPENGRAM_MIGRATIONS_DIR || DEFAULT_MIGRATIONS_DIR;

  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  fs.mkdirSync(path.join(path.dirname(dbPath), "uploads"), { recursive: true });

  const migrationFiles = listMigrationFiles(migrationsDir);
  if (!migrationFiles.length) {
    throw new Error(`No SQL migrations found in: ${migrationsDir}`);
  }

  const db = new Database(dbPath);
  db.pragma("foreign_keys = ON");
  db.pragma("journal_mode = WAL");

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
    const migrationSql = fs.readFileSync(migrationPath, "utf8");
    const applyMigration = db.transaction(() => {
      db.exec(migrationSql);
      db.prepare("INSERT INTO __opengram_migrations (name, applied_at) VALUES (?, ?)").run(
        fileName,
        Date.now(),
      );
    });

    applyMigration();
    appliedNames.add(fileName);
    console.log(`[opengram-docker] Applied migration ${fileName}`);
  }

  db.close();
}

main();
