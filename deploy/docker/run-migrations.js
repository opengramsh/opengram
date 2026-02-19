const fs = require("node:fs");
const path = require("node:path");

const Database = require("better-sqlite3");

const DEFAULT_DB_PATH = "/opt/opengram/data/opengram.db";
const DEFAULT_MIGRATIONS_DIR = "/opt/opengram/web/drizzle";

function getMigrationEntries(journalPath) {
  const journal = JSON.parse(fs.readFileSync(journalPath, "utf8"));
  if (!Array.isArray(journal.entries)) {
    throw new Error(`Invalid migration journal: ${journalPath}`);
  }

  return journal.entries
    .filter((entry) => typeof entry.tag === "string" && typeof entry.idx === "number")
    .sort((a, b) => a.idx - b.idx);
}

function main() {
  const dbPath = process.env.DATABASE_URL || DEFAULT_DB_PATH;
  const migrationsDir = process.env.OPENGRAM_MIGRATIONS_DIR || DEFAULT_MIGRATIONS_DIR;
  const journalPath = path.join(migrationsDir, "meta", "_journal.json");

  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  fs.mkdirSync(path.join(path.dirname(dbPath), "uploads"), { recursive: true });

  if (!fs.existsSync(journalPath)) {
    throw new Error(`Migration journal not found: ${journalPath}`);
  }

  const db = new Database(dbPath);
  db.pragma("foreign_keys = ON");
  db.pragma("journal_mode = WAL");

  const drizzleMigrationsTable = db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = '__drizzle_migrations'",
    )
    .get();

  if (drizzleMigrationsTable) {
    console.log("[opengram-docker] Found __drizzle_migrations table; skipping startup migrations.");
    db.close();
    return;
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS __opengram_migrations (
      tag TEXT PRIMARY KEY,
      applied_at INTEGER NOT NULL
    )
  `);

  const entries = getMigrationEntries(journalPath);
  for (const entry of entries) {
    const alreadyApplied = db
      .prepare("SELECT 1 FROM __opengram_migrations WHERE tag = ?")
      .get(entry.tag);

    if (alreadyApplied) {
      continue;
    }

    const migrationPath = path.join(migrationsDir, `${entry.tag}.sql`);
    if (!fs.existsSync(migrationPath)) {
      throw new Error(`Migration file not found: ${migrationPath}`);
    }

    const migrationSql = fs.readFileSync(migrationPath, "utf8");
    const applyMigration = db.transaction(() => {
      db.exec(migrationSql);
      db.prepare("INSERT INTO __opengram_migrations (tag, applied_at) VALUES (?, ?)").run(
        entry.tag,
        Date.now(),
      );
    });

    applyMigration();
    console.log(`[opengram-docker] Applied migration ${entry.tag}`);
  }

  db.close();
}

main();
