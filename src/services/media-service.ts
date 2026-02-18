import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, extname, join } from 'node:path';
import type Database from 'better-sqlite3';
import { nanoid } from 'nanoid';

import { notFoundError, validationError } from '@/src/api/http';
import { loadOpengramConfig } from '@/src/config/opengram-config';
import { createSqliteConnection } from '@/src/db/client';
import { emitEvent } from '@/src/services/events-service';

type MediaKind = 'image' | 'audio' | 'file';

type MediaRecord = {
  id: string;
  chat_id: string;
  message_id: string | null;
  storage_path: string;
  thumbnail_path: string | null;
  filename: string;
  content_type: string;
  byte_size: number;
  kind: MediaKind;
  created_at: number;
};

type CreateMediaInput = {
  chatId: string;
  fileName: string;
  fileBytes: Uint8Array;
  contentType: string;
  kind?: MediaKind;
  messageId?: string;
};

function withDb<T>(callback: (db: Database.Database) => T): T {
  const db = createSqliteConnection();
  try {
    return callback(db);
  } finally {
    db.close();
  }
}

function toTimestamp(value: number) {
  return new Date(value).toISOString();
}

function serializeMedia(record: MediaRecord) {
  return {
    id: record.id,
    chat_id: record.chat_id,
    message_id: record.message_id,
    storage_path: record.storage_path,
    thumbnail_path: record.thumbnail_path,
    filename: record.filename,
    content_type: record.content_type,
    byte_size: record.byte_size,
    kind: record.kind,
    created_at: toTimestamp(record.created_at),
  };
}

function resolveDataRoot() {
  const dbPath = process.env.DATABASE_URL ?? './data/opengram.db';
  return dirname(dbPath);
}

function sanitizeFileName(value: string) {
  const base = value.trim() || 'upload.bin';
  return base.replace(/[^a-zA-Z0-9._-]/g, '_');
}

function detectKind(contentType: string): MediaKind {
  if (contentType.startsWith('image/')) {
    return 'image';
  }

  if (contentType.startsWith('audio/')) {
    return 'audio';
  }

  return 'file';
}

function ensureAllowedContentType(contentType: string) {
  const allowed = loadOpengramConfig().allowedMimeTypes;
  if (allowed.includes('*/*')) {
    return;
  }

  const matched = allowed.some((rule) => {
    if (rule === contentType) {
      return true;
    }

    if (rule.endsWith('/*')) {
      const prefix = rule.slice(0, -1);
      return contentType.startsWith(prefix);
    }

    return false;
  });

  if (!matched) {
    throw validationError('Uploaded file type is not allowed.', {
      field: 'file',
      contentType,
    });
  }
}

function ensureChatAndMessage(db: Database.Database, chatId: string, messageId: string | undefined) {
  const chat = db.prepare('SELECT id FROM chats WHERE id = ?').get(chatId) as { id: string } | undefined;
  if (!chat) {
    throw notFoundError('Chat not found.', { chatId });
  }

  if (!messageId) {
    return;
  }

  const message = db
    .prepare('SELECT id FROM messages WHERE id = ? AND chat_id = ?')
    .get(messageId, chatId) as { id: string } | undefined;
  if (!message) {
    throw validationError('messageId does not belong to this chat.', { field: 'messageId' });
  }
}

export function createMedia(input: CreateMediaInput) {
  const config = loadOpengramConfig();
  if (!input.contentType) {
    throw validationError('file content type is required.', { field: 'file' });
  }

  if (!input.fileBytes.length) {
    throw validationError('file cannot be empty.', { field: 'file' });
  }

  if (input.fileBytes.length > config.maxUploadBytes) {
    throw validationError('file exceeds maxUploadBytes.', { field: 'file' });
  }

  ensureAllowedContentType(input.contentType);
  const kind = input.kind ?? detectKind(input.contentType);
  if (kind !== 'image' && kind !== 'audio' && kind !== 'file') {
    throw validationError('kind must be image, audio, or file.', { field: 'kind' });
  }

  const mediaId = nanoid();
  const safeName = sanitizeFileName(input.fileName);
  const extension = extname(safeName) || '.bin';
  const relativePath = join('uploads', input.chatId, `${mediaId}${extension}`);
  const absolutePath = join(resolveDataRoot(), relativePath);
  mkdirSync(dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, input.fileBytes);

  const now = Date.now();

  return withDb((db) => {
    ensureChatAndMessage(db, input.chatId, input.messageId);

    db.prepare(
      [
        'INSERT INTO media (',
        'id, chat_id, message_id, storage_path, thumbnail_path, filename, content_type, byte_size, kind, created_at',
        ') VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      ].join(' '),
    ).run(
      mediaId,
      input.chatId,
      input.messageId ?? null,
      relativePath,
      null,
      safeName,
      input.contentType,
      input.fileBytes.length,
      kind,
      now,
    );

    const record = db.prepare('SELECT * FROM media WHERE id = ?').get(mediaId) as MediaRecord;

    emitEvent('media.attached', {
      chatId: input.chatId,
      mediaId,
      messageId: input.messageId ?? null,
      kind,
    });

    return serializeMedia(record);
  });
}

export function listChatMedia(chatId: string, kind?: MediaKind, messageId?: string) {
  return withDb((db) => {
    const chat = db.prepare('SELECT id FROM chats WHERE id = ?').get(chatId) as { id: string } | undefined;
    if (!chat) {
      throw notFoundError('Chat not found.', { chatId });
    }

    const filters = ['chat_id = ?'];
    const args: unknown[] = [chatId];

    if (kind) {
      filters.push('kind = ?');
      args.push(kind);
    }

    if (messageId) {
      filters.push('message_id = ?');
      args.push(messageId);
    }

    const rows = db
      .prepare(
        [
          'SELECT * FROM media',
          `WHERE ${filters.join(' AND ')}`,
          'ORDER BY created_at ASC, id ASC',
        ].join(' '),
      )
      .all(...args) as MediaRecord[];

    return rows.map(serializeMedia);
  });
}

export function getMedia(mediaId: string) {
  return withDb((db) => {
    const media = db.prepare('SELECT * FROM media WHERE id = ?').get(mediaId) as MediaRecord | undefined;
    if (!media) {
      throw notFoundError('Media not found.', { mediaId });
    }

    return serializeMedia(media);
  });
}

export function readMediaFile(mediaId: string) {
  return withDb((db) => {
    const media = db.prepare('SELECT * FROM media WHERE id = ?').get(mediaId) as MediaRecord | undefined;
    if (!media) {
      throw notFoundError('Media not found.', { mediaId });
    }

    const absolutePath = join(resolveDataRoot(), media.storage_path);
    const content = readFileSync(absolutePath);

    return {
      content,
      filename: media.filename,
      contentType: media.content_type,
    };
  });
}
