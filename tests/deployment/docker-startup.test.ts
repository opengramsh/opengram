import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
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
});
