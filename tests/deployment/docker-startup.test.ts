import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";

const repoRoot = join(import.meta.dirname, "..", "..");
const migrationScript = join(repoRoot, "deploy", "docker", "run-migrations.js");
const migrationsDir = join(repoRoot, "migrations");

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

    const db = new Database(dbPath);
    db.exec(readFileSync(join(migrationsDir, "0000_initial.sql"), "utf8"));
    db.exec(`
      CREATE TABLE __drizzle_migrations (
        id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
        hash text NOT NULL,
        created_at numeric
      )
    `);
    db.prepare("INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)").run(
      "0000_initial",
      Date.now(),
    );
    db.close();

    runStartupMigrations(dbPath);

    const migratedDb = new Database(dbPath, { readonly: true });
    const appliedNames = migratedDb
      .prepare("SELECT name FROM __opengram_migrations ORDER BY name ASC")
      .all() as Array<{ name: string }>;
    expect(appliedNames.map((row) => row.name)).toEqual([
      "0001_messages_fts_trigger_upgrade.sql",
      "0002_messages_stream_sweep_index.sql",
      "0003_add_notifications_muted.sql",
      "0004_drop_custom_state.sql",
      "0005_add_title_source.sql",
      "0006_dispatch_queue.sql",
    ]);

    const upgradedIndex = migratedDb
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'messages_stream_updated_idx'",
      )
      .get() as { name: string } | undefined;
    expect(upgradedIndex?.name).toBe("messages_stream_updated_idx");

    migratedDb.close();
  });

  it("applies pending migrations when baseline schema exists without __drizzle_migrations", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "opengram-docker-baseline-"));
    const dbPath = join(tempDir, "opengram.db");

    const db = new Database(dbPath);
    db.exec(readFileSync(join(migrationsDir, "0000_initial.sql"), "utf8"));
    db.close();

    runStartupMigrations(dbPath);

    const migratedDb = new Database(dbPath, { readonly: true });
    const appliedNames = migratedDb
      .prepare("SELECT name FROM __opengram_migrations ORDER BY name ASC")
      .all() as Array<{ name: string }>;
    expect(appliedNames.map((row) => row.name)).toEqual([
      "0001_messages_fts_trigger_upgrade.sql",
      "0002_messages_stream_sweep_index.sql",
      "0003_add_notifications_muted.sql",
      "0004_drop_custom_state.sql",
      "0005_add_title_source.sql",
      "0006_dispatch_queue.sql",
    ]);

    const upgradedIndex = migratedDb
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'messages_stream_updated_idx'",
      )
      .get() as { name: string } | undefined;
    expect(upgradedIndex?.name).toBe("messages_stream_updated_idx");

    migratedDb.close();
  });
});
