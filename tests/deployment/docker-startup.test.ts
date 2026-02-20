import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";

const repoRoot = join(import.meta.dirname, "..", "..");
const migrationScript = join(repoRoot, "deploy", "docker", "run-migrations.js");
const migrationsDir = join(repoRoot, "drizzle");
const journalPath = join(migrationsDir, "meta", "_journal.json");

function runStartupMigrations(dbPath: string) {
  execFileSync("node", [migrationScript], {
    cwd: repoRoot,
    env: {
      ...process.env,
      DATABASE_URL: dbPath,
      OPENGRAM_MIGRATIONS_DIR: migrationsDir,
    },
  });
}

function readJournalEntries() {
  const raw = readFileSync(journalPath, "utf8");
  const parsed = JSON.parse(raw) as {
    entries: Array<{ idx: number; tag: string; when: number }>;
  };
  return parsed.entries.slice().sort((left, right) => left.idx - right.idx);
}

describe("docker startup migrations", () => {
  it("applies schema on first run and is idempotent on subsequent runs", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "opengram-docker-startup-"));
    const dbPath = join(tempDir, "opengram.db");

    runStartupMigrations(dbPath);
    runStartupMigrations(dbPath);

    const db = new Database(dbPath, { readonly: true });

    const chatsTable = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'chats'")
      .get() as { name: string } | undefined;
    expect(chatsTable?.name).toBe("chats");

    const appliedCount = db
      .prepare("SELECT COUNT(*) AS count FROM __opengram_migrations")
      .get() as { count: number };
    expect(appliedCount.count).toBeGreaterThan(0);

    db.close();
  });

  it("applies pending migrations when __drizzle_migrations already exists", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "opengram-docker-upgrade-"));
    const dbPath = join(tempDir, "opengram.db");
    const journalEntries = readJournalEntries();

    const db = new Database(dbPath);
    db.exec(readFileSync(join(migrationsDir, `${journalEntries[0].tag}.sql`), "utf8"));
    db.exec(`
      CREATE TABLE __drizzle_migrations (
        id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
        hash text NOT NULL,
        created_at numeric
      )
    `);
    db.prepare("INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)").run(
      journalEntries[0].tag,
      journalEntries[0].when,
    );
    db.close();

    runStartupMigrations(dbPath);

    const migratedDb = new Database(dbPath, { readonly: true });
    const appliedTags = migratedDb
      .prepare("SELECT tag FROM __opengram_migrations ORDER BY tag ASC")
      .all() as Array<{ tag: string }>;
    expect(appliedTags.map((row) => row.tag)).toEqual(journalEntries.slice(1).map((row) => row.tag));

    const upgradedIndex = migratedDb
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'messages_stream_updated_idx'",
      )
      .get() as { name: string } | undefined;
    expect(upgradedIndex?.name).toBe("messages_stream_updated_idx");

    migratedDb.close();
  });
});
