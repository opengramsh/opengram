const fs = require("node:fs");
const path = require("node:path");

const Database = require("better-sqlite3");

const DEFAULT_DB_PATH = "/opt/opengram/data/opengram.db";
const DEFAULT_MIGRATIONS_DIR = "/opt/opengram/web/migrations";

function tableExists(db, tableName) {
  const row = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(tableName);
  return Boolean(row);
}

function listMigrationFiles(migrationsDir) {
  if (!fs.existsSync(migrationsDir)) {
    return [];
  }

  return fs
    .readdirSync(migrationsDir)
    .filter((entry) => entry.endsWith(".sql"))
    .sort();
}

function resolveMigrationTrackingColumn(db) {
  const columns = db.prepare("PRAGMA table_info(__opengram_migrations)").all();
  const columnNames = new Set(columns.map((column) => column.name));
  if (columnNames.has("name")) {
    return "name";
  }

  if (columnNames.has("tag")) {
    return "tag";
  }

  if (columnNames.has("hash")) {
    return "hash";
  }

  return null;
}

function getAppliedNames(db, migrationFiles, trackingColumn) {
  const appliedNames = new Set();

  if (trackingColumn) {
    const trackedRows = db
      .prepare(`SELECT "${trackingColumn}" AS name FROM __opengram_migrations`)
      .all();
    for (const row of trackedRows) {
      if (typeof row.name === "string") {
        appliedNames.add(row.name);
      }
    }
  }

  if (!tableExists(db, "__drizzle_migrations")) {
    return appliedNames;
  }

  const columns = db.prepare("PRAGMA table_info(__drizzle_migrations)").all();
  const legacyNameColumn = columns.find((column) => column.name === "hash" || column.name === "tag");
  if (!legacyNameColumn) {
    return appliedNames;
  }

  const knownFiles = new Set(migrationFiles);
  const legacyRows = db
    .prepare(`SELECT "${legacyNameColumn.name}" AS name FROM __drizzle_migrations`)
    .all();
  for (const row of legacyRows) {
    if (typeof row.name !== "string" || !row.name) {
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

  if (migrationFiles[0] && tableExists(db, "chats")) {
    appliedNames.add(migrationFiles[0]);
  }

  return appliedNames;
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

  const trackingColumn = resolveMigrationTrackingColumn(db);
  if (!trackingColumn) {
    throw new Error("Unable to resolve migration tracking column for __opengram_migrations");
  }

  const appliedNames = getAppliedNames(db, migrationFiles, trackingColumn);
  for (const fileName of migrationFiles) {
    if (appliedNames.has(fileName)) {
      continue;
    }

    const migrationPath = path.join(migrationsDir, fileName);
    const migrationSql = fs.readFileSync(migrationPath, "utf8");
    const applyMigration = db.transaction(() => {
      db.exec(migrationSql);
      db.prepare(`INSERT INTO __opengram_migrations ("${trackingColumn}", applied_at) VALUES (?, ?)`).run(
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
