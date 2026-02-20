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

function tableExists(db, tableName) {
  const row = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(tableName);
  return Boolean(row);
}

function getDrizzleCreatedAtColumn(db) {
  const columns = db.prepare("PRAGMA table_info(__drizzle_migrations)").all();
  const knownColumn = columns.find(
    (column) => column.name === "created_at" || column.name === "createdAt",
  );
  return knownColumn ? knownColumn.name : null;
}

function getAppliedTags(db, entries) {
  const appliedTags = new Set();

  const opengramRows = db.prepare("SELECT tag FROM __opengram_migrations").all();
  for (const row of opengramRows) {
    if (typeof row.tag === "string") {
      appliedTags.add(row.tag);
    }
  }

  if (!tableExists(db, "__drizzle_migrations")) {
    return appliedTags;
  }

  const drizzleCreatedAtColumn = getDrizzleCreatedAtColumn(db);
  if (!drizzleCreatedAtColumn) {
    console.log(
      "[opengram-docker] __drizzle_migrations exists but has no created_at column; skipping drizzle reconciliation.",
    );
    return appliedTags;
  }

  const drizzleRows = db
    .prepare(`SELECT "${drizzleCreatedAtColumn}" AS created_at FROM __drizzle_migrations`)
    .all();
  const tagByWhen = new Map(entries.map((entry) => [Number(entry.when), entry.tag]));
  for (const row of drizzleRows) {
    const numericCreatedAt = Number(row.created_at);
    if (!Number.isFinite(numericCreatedAt)) {
      continue;
    }

    const tag = tagByWhen.get(numericCreatedAt);
    if (tag) {
      appliedTags.add(tag);
      continue;
    }

    console.log(
      `[opengram-docker] Could not reconcile __drizzle_migrations created_at=${numericCreatedAt} to a journal entry.`,
    );
  }

  return appliedTags;
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

  db.exec(`
    CREATE TABLE IF NOT EXISTS __opengram_migrations (
      tag TEXT PRIMARY KEY,
      applied_at INTEGER NOT NULL
    )
  `);

  const entries = getMigrationEntries(journalPath);
  const appliedTags = getAppliedTags(db, entries);
  for (const entry of entries) {
    if (appliedTags.has(entry.tag)) {
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
    appliedTags.add(entry.tag);
    console.log(`[opengram-docker] Applied migration ${entry.tag}`);
  }

  db.close();
}

main();
