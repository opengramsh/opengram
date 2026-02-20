CREATE INDEX IF NOT EXISTS `messages_stream_updated_idx`
ON `messages` (`stream_state`, `updated_at`);
