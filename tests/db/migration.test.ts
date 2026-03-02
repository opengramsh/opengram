import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";

const repoRoot = join(import.meta.dirname, "..", "..");
const migrationDir = join(repoRoot, "migrations");
const migrationFiles = readdirSync(migrationDir).filter((file) => file.endsWith(".sql")).sort();

function createDatabase() {
  const tempDir = mkdtempSync(join(tmpdir(), "opengram-db-"));
  const dbPath = join(tempDir, "test.db");
  const db = new Database(dbPath);
  for (const file of migrationFiles) {
    db.exec(readFileSync(join(migrationDir, file), "utf8"));
  }
  return db;
}

function listObjects(db: Database.Database, type: string) {
  return db
    .prepare("SELECT name FROM sqlite_master WHERE type = ? ORDER BY name")
    .all(type)
    .map((row) => (row as { name: string }).name);
}

describe("migration", () => {
  it("creates all required tables and FTS virtual table", () => {
    const db = createDatabase();

    const tables = listObjects(db, "table");
    const requiredTables = [
      "chats",
      "events",
      "idempotency_keys",
      "media",
      "messages",
      "messages_fts",
      "push_subscriptions",
      "requests",
      "tags_catalog",
      "webhook_deliveries",
      "dispatch_inputs",
      "dispatch_chat_state",
      "dispatch_batches",
    ];

    for (const table of requiredTables) {
      expect(tables).toContain(table);
    }
  });

  it("creates all required indexes from spec section 10", () => {
    const db = createDatabase();
    const indexes = listObjects(db, "index");
    const requiredIndexes = [
      "chats_inbox_idx",
      "messages_chat_created_idx",
      "messages_stream_updated_idx",
      "media_chat_created_idx",
      "requests_chat_status_idx",
      "tags_catalog_name_idx",
      "events_created_at_idx",
      "webhook_deliveries_event_id_idx",
      "idempotency_keys_created_at_idx",
      "push_subscriptions_endpoint_idx",
      "dispatch_inputs_chat_state_created_idx",
      "dispatch_batches_status_available_created_idx",
      "dispatch_batches_chat_status_created_idx",
      "dispatch_batches_lease_expires_idx",
    ];

    for (const idx of requiredIndexes) {
      expect(indexes).toContain(idx);
    }
  });

  it("enforces 21-char NanoID check constraints", () => {
    const db = createDatabase();
    const now = Date.now();

    expect(() => {
      db.prepare(
        "INSERT INTO chats (id, title, model_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
      ).run("short_id", "Chat", "model-a", now, now);
    }).toThrow();

    expect(() => {
      db.prepare(
        "INSERT INTO chats (id, title, model_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
      ).run("123456789012345678901", "Chat", "model-a", now, now);
    }).not.toThrow();
  });

  it("writes messages to messages_fts via triggers", () => {
    const db = createDatabase();
    const now = Date.now();
    const chatId = "123456789012345678901";
    const messageId = "123456789012345678902";

    db.prepare(
      "INSERT INTO chats (id, title, model_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
    ).run(chatId, "FTS Chat", "model-a", now, now);

    db.prepare(
      [
        "INSERT INTO messages (id, chat_id, role, sender_id, created_at, updated_at, content_final, stream_state)",
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      ].join(" "),
    ).run(messageId, chatId, "agent", "agent:one", now, now, "hello full text search", "complete");

    const row = db
      .prepare("SELECT message_id FROM messages_fts WHERE messages_fts MATCH 'hello'")
      .get() as { message_id: string };

    expect(row.message_id).toBe(messageId);
  });

  it("does not index null content_final until content is set", () => {
    const db = createDatabase();
    const now = Date.now();
    const chatId = "123456789012345678901";
    const messageId = "123456789012345678903";

    db.prepare(
      "INSERT INTO chats (id, title, model_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
    ).run(chatId, "FTS Chat", "model-a", now, now);

    db.prepare(
      [
        "INSERT INTO messages (id, chat_id, role, sender_id, created_at, updated_at, content_final, stream_state)",
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      ].join(" "),
    ).run(messageId, chatId, "agent", "agent:one", now, now, null, "streaming");

    const before = db
      .prepare("SELECT message_id FROM messages_fts WHERE message_id = ?")
      .get(messageId) as { message_id: string } | undefined;
    expect(before).toBeUndefined();

    db.prepare("UPDATE messages SET content_final = ?, stream_state = ? WHERE id = ?").run(
      "indexed after completion",
      "complete",
      messageId,
    );

    const after = db
      .prepare("SELECT message_id FROM messages_fts WHERE messages_fts MATCH 'completion'")
      .get() as { message_id: string };
    expect(after.message_id).toBe(messageId);
  });

  it("keeps WAL pragma in sqlite client setup", () => {
    const clientSource = readFileSync(join(repoRoot, "src", "db", "client.ts"), "utf8");
    expect(clientSource).toMatch(/journal_mode\s*=\s*WAL/);
  });
});
