DROP TRIGGER IF EXISTS `messages_ai`;
DROP TRIGGER IF EXISTS `messages_au_nonnull`;
DROP TRIGGER IF EXISTS `messages_au_null`;

CREATE TRIGGER `messages_ai` AFTER INSERT ON `messages`
WHEN `new`.`content_final` IS NOT NULL
BEGIN
  INSERT INTO `messages_fts` (`message_id`, `chat_id`, `content_final`)
  VALUES (`new`.`id`, `new`.`chat_id`, `new`.`content_final`);
END;

CREATE TRIGGER `messages_au_nonnull` AFTER UPDATE OF `content_final`, `chat_id` ON `messages`
WHEN `new`.`content_final` IS NOT NULL
BEGIN
  DELETE FROM `messages_fts` WHERE `message_id` = `old`.`id`;
  INSERT INTO `messages_fts` (`message_id`, `chat_id`, `content_final`)
  VALUES (`new`.`id`, `new`.`chat_id`, `new`.`content_final`);
END;

CREATE TRIGGER `messages_au_null` AFTER UPDATE OF `content_final`, `chat_id` ON `messages`
WHEN `new`.`content_final` IS NULL
BEGIN
  DELETE FROM `messages_fts` WHERE `message_id` = `old`.`id`;
END;
