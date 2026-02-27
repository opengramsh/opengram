import { existsSync, mkdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, posix, resolve, sep } from 'node:path';

import type Database from 'better-sqlite3';
import { nanoid } from 'nanoid';
import sharp from 'sharp';

import {
  conflictError,
  notFoundError,
  payloadTooLargeError,
  unsupportedMediaTypeError,
  validationError,
} from '@/src/api/http';
import { encodeMediaCursor, type MediaListCursor } from '@/src/api/pagination';
import { loadOpengramConfig } from '@/src/config/opengram-config';
import { getDb } from '@/src/db/client';
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

type ListChatMediaInput = {
  kind?: MediaKind;
  messageId?: string;
  limit: number;
  cursor: MediaListCursor | null;
};

type ListChatMediaResult = {
  data: ReturnType<typeof serializeMedia>[];
  nextCursor: string | null;
  hasMore: boolean;
};

const SVG_MIME_TYPE = 'image/svg+xml';

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
  const envRoot = process.env.OPENGRAM_DATA_ROOT?.trim();
  if (envRoot) return resolve(envRoot);

  // Derive from DATABASE_URL: data root is the directory containing the DB file.
  // This ensures uploads always land next to the database regardless of NODE_ENV.
  const dbUrl = process.env.DATABASE_URL?.trim();
  if (dbUrl) return resolve(dirname(dbUrl));

  return resolve('./data');
}

function resolveStoragePath(relativePath: string) {
  const dataRoot = resolveDataRoot();
  const absolutePath = resolve(dataRoot, relativePath);
  const normalizedRoot = dataRoot.endsWith(sep) ? dataRoot : `${dataRoot}${sep}`;

  if (absolutePath !== dataRoot && !absolutePath.startsWith(normalizedRoot)) {
    throw validationError('Invalid storage path.');
  }

  return absolutePath;
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

function normalizeMimeType(contentType: string) {
  return contentType.split(';', 1)[0]?.trim().toLowerCase() ?? '';
}

function ensureAllowedContentType(contentType: string) {
  const normalizedContentType = normalizeMimeType(contentType);
  if (normalizedContentType === SVG_MIME_TYPE) {
    throw unsupportedMediaTypeError('SVG uploads are not allowed.', {
      field: 'file',
      contentType,
    });
  }

  const allowed = loadOpengramConfig().allowedMimeTypes;
  if (allowed.includes('*/*')) {
    return;
  }

  const matched = allowed.some((rule) => {
    const normalizedRule = normalizeMimeType(rule);
    if (normalizedRule === normalizedContentType) {
      return true;
    }

    if (normalizedRule.endsWith('/*')) {
      const prefix = normalizedRule.slice(0, -1);
      return normalizedContentType.startsWith(prefix);
    }

    return false;
  });

  if (!matched) {
    throw unsupportedMediaTypeError('Uploaded file type is not allowed.', {
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

async function createThumbnail(fileBytes: Uint8Array): Promise<Uint8Array> {
  return sharp(fileBytes)
    .rotate()
    .resize(512, 512, {
      fit: 'inside',
      withoutEnlargement: true,
    })
    .webp({ quality: 80 })
    .toBuffer();
}

function isInvalidImageContentError(error: unknown) {
  if (!(error instanceof Error)) {
    return false;
  }

  const message = error.message.toLowerCase();
  return (
    message.includes('unsupported image format')
    || message.includes('not a known file format')
    || message.includes('buffer is not in a known format')
    || message.includes('corrupt')
    || message.includes('invalid')
    || message.includes('unable to load')
  );
}

export async function createMedia(input: CreateMediaInput) {
  const config = loadOpengramConfig();
  if (!input.contentType) {
    throw validationError('file content type is required.', { field: 'file' });
  }

  if (!input.fileBytes.length) {
    throw validationError('file cannot be empty.', { field: 'file' });
  }

  if (input.fileBytes.length > config.maxUploadBytes) {
    throw payloadTooLargeError('file exceeds maxUploadBytes.', {
      field: 'file',
      maxUploadBytes: config.maxUploadBytes,
    });
  }

  ensureAllowedContentType(input.contentType);
  const kind = input.kind ?? detectKind(input.contentType);
  if (kind !== 'image' && kind !== 'audio' && kind !== 'file') {
    throw validationError('kind must be image, audio, or file.', { field: 'kind' });
  }

  const mediaId = nanoid();
  const safeName = sanitizeFileName(input.fileName);
  const extension = extname(safeName) || '.bin';
  const relativePath = posix.join('uploads', input.chatId, `${mediaId}${extension}`);
  const absolutePath = resolveStoragePath(relativePath);

  let thumbnailBuffer: Uint8Array | null = null;
  if (kind === 'image') {
    try {
      thumbnailBuffer = await createThumbnail(input.fileBytes);
    } catch (error) {
      if (isInvalidImageContentError(error)) {
        throw unsupportedMediaTypeError('file content is not a valid image.', {
          field: 'file',
          contentType: input.contentType,
        });
      }

      throw error;
    }
  }
  const relativeThumbnailPath = thumbnailBuffer
    ? posix.join('uploads', input.chatId, 'thumbnails', `${mediaId}.webp`)
    : null;
  const absoluteThumbnailPath = relativeThumbnailPath ? resolveStoragePath(relativeThumbnailPath) : null;

  const now = Date.now();

  const db = getDb();
  ensureChatAndMessage(db, input.chatId, input.messageId);

  mkdirSync(join(resolveDataRoot(), 'uploads', input.chatId), { recursive: true });
  if (absoluteThumbnailPath) {
    mkdirSync(join(resolveDataRoot(), 'uploads', input.chatId, 'thumbnails'), { recursive: true });
  }

  let fileWritten = false;
  let thumbnailWritten = false;

  try {
    writeFileSync(absolutePath, input.fileBytes);
    fileWritten = true;

    if (thumbnailBuffer && absoluteThumbnailPath) {
      writeFileSync(absoluteThumbnailPath, thumbnailBuffer);
      thumbnailWritten = true;
    }

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
      relativeThumbnailPath,
      safeName,
      input.contentType,
      input.fileBytes.length,
      kind,
      now,
    );
  } catch (error) {
    if (fileWritten) {
      try {
        unlinkSync(absolutePath);
      } catch {
        // Best-effort cleanup for failed DB writes after file creation.
      }
    }

    if (thumbnailWritten && absoluteThumbnailPath) {
      try {
        unlinkSync(absoluteThumbnailPath);
      } catch {
        // Best-effort cleanup for failed DB writes after thumbnail creation.
      }
    }

    throw error;
  }

  const record = db.prepare('SELECT * FROM media WHERE id = ?').get(mediaId) as MediaRecord;

  emitEvent('media.attached', {
    chatId: input.chatId,
    mediaId,
    messageId: input.messageId ?? null,
    kind,
  });

  return serializeMedia(record);
}

export function listChatMedia(chatId: string, input: ListChatMediaInput): ListChatMediaResult {
  const db = getDb();
  const chat = db.prepare('SELECT id FROM chats WHERE id = ?').get(chatId) as { id: string } | undefined;
  if (!chat) {
    throw notFoundError('Chat not found.', { chatId });
  }

  const filters = ['chat_id = ?'];
  const args: unknown[] = [chatId];

  if (input.kind) {
    filters.push('kind = ?');
    args.push(input.kind);
  }

  if (input.messageId) {
    filters.push('message_id = ?');
    args.push(input.messageId);
  }

  if (input.cursor) {
    filters.push('(created_at < ? OR (created_at = ? AND id < ?))');
    args.push(input.cursor.createdAt, input.cursor.createdAt, input.cursor.id);
  }

  const rows = db
    .prepare(
      [
        'SELECT * FROM media',
        `WHERE ${filters.join(' AND ')}`,
        'ORDER BY created_at DESC, id DESC',
        'LIMIT ?',
      ].join(' '),
    )
    .all(...args, input.limit + 1) as MediaRecord[];

  const hasMore = rows.length > input.limit;
  const pageRows = hasMore ? rows.slice(0, input.limit) : rows;
  const lastRow = pageRows.at(-1);

  return {
    data: pageRows.map(serializeMedia),
    hasMore,
    nextCursor: hasMore && lastRow
      ? encodeMediaCursor({ createdAt: lastRow.created_at, id: lastRow.id })
      : null,
  };
}

export function getMedia(mediaId: string) {
  const db = getDb();
  const media = db.prepare('SELECT * FROM media WHERE id = ?').get(mediaId) as MediaRecord | undefined;
  if (!media) {
    throw notFoundError('Media not found.', { mediaId });
  }

  return serializeMedia(media);
}

function unlinkFileIfPresent(path: string | null) {
  if (!path) {
    return;
  }

  const absolutePath = resolveStoragePath(path);
  if (!existsSync(absolutePath)) {
    return;
  }

  try {
    unlinkSync(absolutePath);
  } catch {
    // Best-effort cleanup for media removed from DB.
  }
}

export function deleteMedia(mediaId: string, options: { requireUnattached?: boolean } = {}) {
  const db = getDb();
  const media = getMediaRecord(db, mediaId);
  if (options.requireUnattached && media.message_id !== null) {
    throw conflictError('Cannot delete media that is attached to a message.', { mediaId });
  }

  db.prepare('DELETE FROM media WHERE id = ?').run(mediaId);

  unlinkFileIfPresent(media.storage_path);
  unlinkFileIfPresent(media.thumbnail_path);

  return serializeMedia(media);
}

function getMediaRecord(db: Database.Database, mediaId: string): MediaRecord {
  const media = db.prepare('SELECT * FROM media WHERE id = ?').get(mediaId) as MediaRecord | undefined;
  if (!media) {
    throw notFoundError('Media not found.', { mediaId });
  }

  return media;
}

export function getMediaFileDescriptor(mediaId: string) {
  const db = getDb();
  const media = getMediaRecord(db, mediaId);
  const absolutePath = resolveStoragePath(media.storage_path);

  if (!existsSync(absolutePath)) {
    throw notFoundError('Media file not found on disk.', { mediaId });
  }

  return {
    absolutePath,
    byteSize: media.byte_size,
    contentType: media.content_type,
    filename: media.filename,
  };
}

function thumbnailContentTypeFromPath(path: string) {
  if (path.endsWith('.webp')) {
    return 'image/webp';
  }

  if (path.endsWith('.png')) {
    return 'image/png';
  }

  if (path.endsWith('.jpg') || path.endsWith('.jpeg')) {
    return 'image/jpeg';
  }

  return 'application/octet-stream';
}

export function getThumbnailDescriptor(mediaId: string) {
  const db = getDb();
  const media = getMediaRecord(db, mediaId);
  if (media.kind !== 'image' || media.thumbnail_path === null) {
    throw notFoundError('Thumbnail not found.', { mediaId });
  }

  const absolutePath = resolveStoragePath(media.thumbnail_path);
  if (!existsSync(absolutePath)) {
    throw notFoundError('Thumbnail file not found on disk.', { mediaId });
  }

  return {
    absolutePath,
    contentType: thumbnailContentTypeFromPath(media.thumbnail_path),
    filename: `${media.id}-thumbnail${extname(media.thumbnail_path) || '.bin'}`,
  };
}
