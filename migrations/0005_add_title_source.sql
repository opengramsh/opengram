ALTER TABLE `chats` ADD COLUMN `title_source` text NOT NULL DEFAULT 'default';
-- Existing chats that already have messages are treated as manually titled to prevent unwanted auto-renames after upgrade
UPDATE chats SET title_source = 'manual'
WHERE id IN (SELECT DISTINCT chat_id FROM messages);
