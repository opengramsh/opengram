PRAGMA foreign_keys = ON;

CREATE TABLE `chats` (
  `id` text PRIMARY KEY NOT NULL,
  `is_archived` integer DEFAULT 0 NOT NULL,
  `custom_state` text,
  `title` text NOT NULL,
  `tags` text DEFAULT '[]' NOT NULL,
  `pinned` integer DEFAULT 0 NOT NULL,
  `agent_ids` text DEFAULT '[]' NOT NULL,
  `model_id` text NOT NULL,
  `last_message_preview` text,
  `last_message_role` text,
  `pending_requests_count` integer DEFAULT 0 NOT NULL,
  `last_read_at` integer,
  `unread_count` integer DEFAULT 0 NOT NULL,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  `last_message_at` integer,
  CONSTRAINT `id_len_check` CHECK(length(`id`) = 21)
);

CREATE TABLE `messages` (
  `id` text PRIMARY KEY NOT NULL,
  `chat_id` text NOT NULL,
  `role` text NOT NULL,
  `sender_id` text NOT NULL,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  `content_final` text,
  `content_partial` text,
  `stream_state` text DEFAULT 'none' NOT NULL,
  `model_id` text,
  `trace` text,
  CONSTRAINT `id_len_check` CHECK(length(`id`) = 21),
  CONSTRAINT `messages_role_check` CHECK(`role` IN ('user', 'agent', 'system', 'tool')),
  CONSTRAINT `messages_stream_state_check` CHECK(`stream_state` IN ('none', 'streaming', 'complete', 'cancelled')),
  FOREIGN KEY (`chat_id`) REFERENCES `chats`(`id`) ON DELETE CASCADE
);

CREATE TABLE `media` (
  `id` text PRIMARY KEY NOT NULL,
  `chat_id` text NOT NULL,
  `message_id` text,
  `storage_path` text NOT NULL,
  `thumbnail_path` text,
  `filename` text NOT NULL,
  `content_type` text NOT NULL,
  `byte_size` integer NOT NULL,
  `kind` text NOT NULL,
  `created_at` integer NOT NULL,
  CONSTRAINT `id_len_check` CHECK(length(`id`) = 21),
  CONSTRAINT `media_kind_check` CHECK(`kind` IN ('image', 'audio', 'file')),
  FOREIGN KEY (`chat_id`) REFERENCES `chats`(`id`) ON DELETE CASCADE,
  FOREIGN KEY (`message_id`) REFERENCES `messages`(`id`) ON DELETE SET NULL
);

CREATE TABLE `requests` (
  `id` text PRIMARY KEY NOT NULL,
  `chat_id` text NOT NULL,
  `type` text NOT NULL,
  `status` text DEFAULT 'pending' NOT NULL,
  `title` text NOT NULL,
  `body` text,
  `config` text NOT NULL,
  `created_at` integer NOT NULL,
  `resolved_at` integer,
  `resolved_by` text,
  `resolution_payload` text,
  `trace` text,
  CONSTRAINT `id_len_check` CHECK(length(`id`) = 21),
  CONSTRAINT `requests_type_check` CHECK(`type` IN ('choice', 'text_input', 'form')),
  CONSTRAINT `requests_status_check` CHECK(`status` IN ('pending', 'resolved', 'cancelled')),
  CONSTRAINT `requests_resolved_by_check` CHECK(`resolved_by` IN ('user', 'backend') OR `resolved_by` IS NULL),
  FOREIGN KEY (`chat_id`) REFERENCES `chats`(`id`) ON DELETE CASCADE
);

CREATE TABLE `tags_catalog` (
  `id` text PRIMARY KEY NOT NULL,
  `name` text NOT NULL,
  `usage_count` integer DEFAULT 0 NOT NULL,
  `created_at` integer NOT NULL,
  CONSTRAINT `id_len_check` CHECK(length(`id`) = 21)
);

CREATE TABLE `events` (
  `id` text PRIMARY KEY NOT NULL,
  `type` text NOT NULL,
  `payload` text NOT NULL,
  `created_at` integer NOT NULL,
  CONSTRAINT `id_len_check` CHECK(length(`id`) = 21)
);

CREATE TABLE `webhook_deliveries` (
  `id` text PRIMARY KEY NOT NULL,
  `event_id` text NOT NULL,
  `target_url` text NOT NULL,
  `status_code` integer,
  `success` integer NOT NULL,
  `error` text,
  `attempted_at` integer NOT NULL,
  CONSTRAINT `id_len_check` CHECK(length(`id`) = 21),
  FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON DELETE CASCADE
);

CREATE TABLE `idempotency_keys` (
  `key` text PRIMARY KEY NOT NULL,
  `response` text NOT NULL,
  `status_code` integer NOT NULL,
  `created_at` integer NOT NULL
);

CREATE TABLE `push_subscriptions` (
  `id` text PRIMARY KEY NOT NULL,
  `endpoint` text NOT NULL,
  `keys_p256dh` text NOT NULL,
  `keys_auth` text NOT NULL,
  `user_agent` text,
  `created_at` integer NOT NULL,
  CONSTRAINT `id_len_check` CHECK(length(`id`) = 21)
);

CREATE INDEX `chats_inbox_idx` ON `chats` (`is_archived`, `pinned` DESC, `last_message_at` DESC);
CREATE INDEX `messages_chat_created_idx` ON `messages` (`chat_id`, `created_at`);
CREATE INDEX `media_chat_created_idx` ON `media` (`chat_id`, `created_at`);
CREATE INDEX `requests_chat_status_idx` ON `requests` (`chat_id`, `status`);
CREATE UNIQUE INDEX `tags_catalog_name_idx` ON `tags_catalog` (`name`);
CREATE INDEX `events_created_at_idx` ON `events` (`created_at`);
CREATE INDEX `webhook_deliveries_event_id_idx` ON `webhook_deliveries` (`event_id`);
CREATE INDEX `idempotency_keys_created_at_idx` ON `idempotency_keys` (`created_at`);
CREATE UNIQUE INDEX `push_subscriptions_endpoint_idx` ON `push_subscriptions` (`endpoint`);

CREATE VIRTUAL TABLE `messages_fts` USING fts5(
  message_id UNINDEXED,
  chat_id UNINDEXED,
  content_final
);

CREATE TRIGGER `messages_ai` AFTER INSERT ON `messages` BEGIN
  INSERT INTO `messages_fts` (`message_id`, `chat_id`, `content_final`)
  VALUES (`new`.`id`, `new`.`chat_id`, COALESCE(`new`.`content_final`, ''));
END;

CREATE TRIGGER `messages_ad` AFTER DELETE ON `messages` BEGIN
  DELETE FROM `messages_fts` WHERE `message_id` = `old`.`id`;
END;

CREATE TRIGGER `messages_au` AFTER UPDATE OF `content_final`, `chat_id` ON `messages` BEGIN
  UPDATE `messages_fts`
  SET `chat_id` = `new`.`chat_id`, `content_final` = COALESCE(`new`.`content_final`, '')
  WHERE `message_id` = `old`.`id`;
END;
