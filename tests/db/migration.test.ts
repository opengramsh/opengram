import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";

const repoRoot = join(import.meta.dirname, "..", "..");
const initialMigrationSql = readFileSync(join(repoRoot, "drizzle", "0000_initial.sql"), "utf8");
const ftsTriggerUpgradeSql = readFileSync(
  join(repoRoot, "drizzle", "0001_messages_fts_trigger_upgrade.sql"),
  "utf8",
);

function createDatabase() {
  const tempDir = mkdtempSync(join(tmpdir(), "opengram-db-"));
  const dbPath = join(tempDir, "test.db");
  const db = new Database(dbPath);
  db.exec(initialMigrationSql);
  db.exec(ftsTriggerUpgradeSql);
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
      "media_chat_created_idx",
      "requests_chat_status_idx",
      "tags_catalog_name_idx",
      "events_created_at_idx",
      "webhook_deliveries_event_id_idx",
      "idempotency_keys_created_at_idx",
      "push_subscriptions_endpoint_idx",
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

  it("upgrades legacy FTS triggers so streaming placeholders are no longer indexed", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "opengram-db-legacy-upgrade-"));
    const dbPath = join(tempDir, "test.db");
    const db = new Database(dbPath);
    const now = Date.now();
    const chatId = "123456789012345678901";
    const legacyMessageId = "123456789012345678904";
    const upgradedMessageId = "123456789012345678905";

    db.exec(initialMigrationSql);

    db.exec(`
      DROP TRIGGER IF EXISTS \`messages_ai\`;
      DROP TRIGGER IF EXISTS \`messages_au_nonnull\`;
      DROP TRIGGER IF EXISTS \`messages_au_null\`;

      CREATE TRIGGER \`messages_ai\` AFTER INSERT ON \`messages\`
      BEGIN
        INSERT INTO \`messages_fts\` (\`message_id\`, \`chat_id\`, \`content_final\`)
        VALUES (\`new\`.\`id\`, \`new\`.\`chat_id\`, COALESCE(\`new\`.\`content_final\`, ''));
      END;

      CREATE TRIGGER \`messages_au_nonnull\` AFTER UPDATE OF \`content_final\`, \`chat_id\` ON \`messages\`
      BEGIN
        DELETE FROM \`messages_fts\` WHERE \`message_id\` = \`old\`.\`id\`;
        INSERT INTO \`messages_fts\` (\`message_id\`, \`chat_id\`, \`content_final\`)
        VALUES (\`new\`.\`id\`, \`new\`.\`chat_id\`, COALESCE(\`new\`.\`content_final\`, ''));
      END;
    `);

    db.prepare(
      "INSERT INTO chats (id, title, model_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
    ).run(chatId, "FTS Chat", "model-a", now, now);

    db.prepare(
      [
        "INSERT INTO messages (id, chat_id, role, sender_id, created_at, updated_at, content_final, stream_state)",
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      ].join(" "),
    ).run(legacyMessageId, chatId, "agent", "agent:one", now, now, null, "streaming");

    const beforeUpgrade = db
      .prepare("SELECT message_id FROM messages_fts WHERE message_id = ?")
      .get(legacyMessageId) as { message_id: string } | undefined;
    expect(beforeUpgrade?.message_id).toBe(legacyMessageId);

    db.exec(ftsTriggerUpgradeSql);

    db.prepare(
      [
        "INSERT INTO messages (id, chat_id, role, sender_id, created_at, updated_at, content_final, stream_state)",
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      ].join(" "),
    ).run(upgradedMessageId, chatId, "agent", "agent:one", now + 1, now + 1, null, "streaming");

    const afterUpgrade = db
      .prepare("SELECT message_id FROM messages_fts WHERE message_id = ?")
      .get(upgradedMessageId) as { message_id: string } | undefined;
    expect(afterUpgrade).toBeUndefined();
  });

  it("keeps WAL pragma in sqlite client setup", () => {
    const clientSource = readFileSync(join(repoRoot, "src", "db", "client.ts"), "utf8");
    expect(clientSource).toMatch(/journal_mode\s*=\s*WAL/);
  });
});
