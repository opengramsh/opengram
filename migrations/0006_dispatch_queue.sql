PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS `dispatch_inputs` (
  `id` text PRIMARY KEY NOT NULL,
  `chat_id` text NOT NULL,
  `source_kind` text NOT NULL,
  `source_id` text NOT NULL,
  `payload` text NOT NULL,
  `created_at` integer NOT NULL,
  `state` text NOT NULL DEFAULT 'pending',
  CONSTRAINT `id_len_check` CHECK(length(`id`) = 21),
  CONSTRAINT `dispatch_inputs_source_kind_check` CHECK(`source_kind` IN ('user_message', 'request_resolved')),
  CONSTRAINT `dispatch_inputs_state_check` CHECK(`state` IN ('pending', 'batched')),
  FOREIGN KEY (`chat_id`) REFERENCES `chats`(`id`) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS `dispatch_chat_state` (
  `chat_id` text PRIMARY KEY NOT NULL,
  `first_pending_at` integer,
  `last_input_at` integer,
  `last_user_typing_at` integer,
  `updated_at` integer NOT NULL,
  FOREIGN KEY (`chat_id`) REFERENCES `chats`(`id`) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS `dispatch_batches` (
  `id` text PRIMARY KEY NOT NULL,
  `chat_id` text NOT NULL,
  `kind` text NOT NULL,
  `payload` text NOT NULL,
  `status` text NOT NULL DEFAULT 'pending',
  `attempt_count` integer NOT NULL DEFAULT 0,
  `available_at` integer NOT NULL,
  `lease_owner` text,
  `lease_expires_at` integer,
  `last_error` text,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  `started_at` integer,
  `completed_at` integer,
  CONSTRAINT `id_len_check` CHECK(length(`id`) = 21),
  CONSTRAINT `dispatch_batches_kind_check` CHECK(`kind` IN ('user_batch', 'request_batch')),
  CONSTRAINT `dispatch_batches_status_check` CHECK(`status` IN ('pending', 'leased', 'completed', 'failed')),
  FOREIGN KEY (`chat_id`) REFERENCES `chats`(`id`) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS `dispatch_inputs_chat_state_created_idx`
  ON `dispatch_inputs` (`chat_id`, `state`, `created_at`);
CREATE INDEX IF NOT EXISTS `dispatch_batches_status_available_created_idx`
  ON `dispatch_batches` (`status`, `available_at`, `created_at`);
CREATE INDEX IF NOT EXISTS `dispatch_batches_chat_status_created_idx`
  ON `dispatch_batches` (`chat_id`, `status`, `created_at`);
CREATE INDEX IF NOT EXISTS `dispatch_batches_lease_expires_idx`
  ON `dispatch_batches` (`lease_expires_at`);
