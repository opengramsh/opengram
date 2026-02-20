import { createReadStream, statSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import { Readable } from 'node:stream';

import { Hono } from 'hono';

import { parseMediaPagination } from '@/src/api/pagination';
import { loadOpengramConfig } from '@/src/config/opengram-config';
import {
  parseJsonBody,
  payloadTooLargeError,
  successCollection,
  toErrorResponse,
  validationError,
} from '@/src/api/http';
import { applyReadMiddlewares, applyWriteMiddlewares } from '@/src/api/write-controls';
import {
  createMedia,
  deleteMedia,
  getMedia,
  getMediaFileDescriptor,
  getThumbnailDescriptor,
  listChatMedia,
} from '@/src/services/media-service';

type MediaKind = 'image' | 'audio' | 'file';
type ParsedRange = { start: number; end: number };

const MULTIPART_BODY_OVERHEAD_BYTES = 256 * 1024;
const SAFE_INLINE_IMAGE_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
]);
const FILE_RESPONSE_CSP = "default-src 'none'; script-src 'none'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'";

function parseContentLength(contentLength: string | null) {
  if (!contentLength) return null;
  const parsed = Number(contentLength);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return Math.floor(parsed);
}

async function readFileBytesWithLimit(file: File, maxUploadBytes: number) {
  const reader = file.stream().getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    total += value.byteLength;
    if (total > maxUploadBytes) {
      throw payloadTooLargeError('file exceeds maxUploadBytes.', {
        field: 'file',
        maxUploadBytes,
      });
    }

    chunks.push(value);
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return bytes;
}

type StreamingRequestInit = RequestInit & { duplex: 'half' };

function createByteLimitedMultipartRequest(request: Request, maxBodyBytes: number) {
  if (!request.body) return request;

  let totalBytes = 0;
  const limitedBody = request.body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        totalBytes += chunk.byteLength;
        if (totalBytes > maxBodyBytes) {
          controller.error(
            payloadTooLargeError('multipart body exceeds maxUploadBytes.', {
              field: 'file',
              maxBodyBytes,
            }),
          );
          return;
        }
        controller.enqueue(chunk);
      },
    }),
  );

  return new Request(request, {
    body: limitedBody,
    duplex: 'half',
  } as RequestInit & { duplex: string });
}

async function parseMultipartFormData(request: Request, maxBodyBytes: number) {
  const contentType = request.headers.get('content-type') ?? '';
  if (!contentType.includes('multipart/form-data')) {
    throw validationError('Unsupported Content-Type for multipart parser.');
  }

  const contentLength = parseContentLength(request.headers.get('content-length'));
  if (contentLength !== null && contentLength > maxBodyBytes) {
    throw payloadTooLargeError('multipart body exceeds maxUploadBytes.', {
      field: 'file',
      maxBodyBytes,
      contentLength,
    });
  }

  return createByteLimitedMultipartRequest(request, maxBodyBytes).formData();
}

function parseRangeHeader(rangeHeader: string, totalSize: number): ParsedRange {
  if (!rangeHeader.startsWith('bytes=')) throw validationError('Invalid Range header.');

  const rangeValue = rangeHeader.slice('bytes='.length).trim();
  if (!rangeValue || rangeValue.includes(',')) throw validationError('Only a single byte range is supported.');

  const [rawStart, rawEnd] = rangeValue.split('-', 2);
  if (rawStart === undefined || rawEnd === undefined) throw validationError('Invalid Range header.');

  if (rawStart === '') {
    const suffixLength = Number(rawEnd);
    if (!Number.isInteger(suffixLength) || suffixLength <= 0) throw validationError('Invalid Range header.');
    const length = Math.min(suffixLength, totalSize);
    return { start: totalSize - length, end: totalSize - 1 };
  }

  const start = Number(rawStart);
  const end = rawEnd === '' ? totalSize - 1 : Number(rawEnd);

  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start) {
    throw validationError('Invalid Range header.');
  }

  if (start >= totalSize) return { start: totalSize, end: totalSize - 1 };
  return { start, end: Math.min(end, totalSize - 1) };
}

function quotedFileName(name: string) {
  return name.replace(/["\\]/g, '_');
}

function isSafeInlineType(contentType: string) {
  const normalizedContentType = contentType.split(';', 1)[0]?.trim().toLowerCase() ?? '';
  return (
    SAFE_INLINE_IMAGE_TYPES.has(normalizedContentType)
    || normalizedContentType.startsWith('audio/')
    || normalizedContentType.startsWith('video/')
    || normalizedContentType === 'application/pdf'
  );
}

function contentDisposition(contentType: string, filename: string) {
  const mode = isSafeInlineType(contentType) ? 'inline' : 'attachment';
  return `${mode}; filename="${quotedFileName(filename)}"`;
}

function toWebReadableStream(stream: Readable) {
  return Readable.toWeb(stream) as ReadableStream<Uint8Array>;
}

// Chat media routes - mounted at /api/v1/chats/:chatId/media
const chatMedia = new Hono();

chatMedia.get('/', (c) => {
  try {
    applyReadMiddlewares(c.req.raw);
    const chatId = c.req.param('chatId');
    const url = new URL(c.req.url);
    const { limit, cursor } = parseMediaPagination(url.searchParams);
    const kindParam = url.searchParams.get('kind');
    const messageId = url.searchParams.get('messageId') ?? undefined;

    if (kindParam !== null && kindParam !== 'image' && kindParam !== 'audio' && kindParam !== 'file') {
      throw validationError('kind must be image, audio, or file.', { field: 'kind' });
    }

    const result = listChatMedia(chatId, {
      kind: kindParam ?? undefined,
      messageId,
      limit,
      cursor,
    });
    return successCollection(result.data, result.nextCursor, result.hasMore);
  } catch (error) {
    return toErrorResponse(error);
  }
});

chatMedia.post('/', async (c) => {
  try {
    applyWriteMiddlewares(c.req.raw);
    const chatId = c.req.param('chatId');
    const config = loadOpengramConfig();

    const contentType = c.req.raw.headers.get('content-type') ?? '';
    if (contentType.includes('multipart/form-data')) {
      const form = await parseMultipartFormData(
        c.req.raw,
        config.maxUploadBytes + MULTIPART_BODY_OVERHEAD_BYTES,
      );
      const file = form.get('file');
      const kind = form.get('kind');
      const messageId = form.get('messageId');

      if (!(file instanceof File)) {
        throw validationError('file is required.', { field: 'file' });
      }

      if (kind !== null && typeof kind !== 'string') {
        throw validationError('kind must be a string.', { field: 'kind' });
      }

      if (messageId !== null && typeof messageId !== 'string') {
        throw validationError('messageId must be a string.', { field: 'messageId' });
      }

      const buffer = await readFileBytesWithLimit(file, config.maxUploadBytes);
      const resolvedKind = kind === null ? undefined : kind;
      if (resolvedKind !== undefined && resolvedKind !== 'image' && resolvedKind !== 'audio' && resolvedKind !== 'file') {
        throw validationError('kind must be image, audio, or file.', { field: 'kind' });
      }

      const media = await createMedia({
        chatId,
        fileName: file.name,
        fileBytes: buffer,
        contentType: file.type || 'application/octet-stream',
        kind: resolvedKind,
        messageId: messageId === null ? undefined : messageId,
      });

      return c.json(media, 201);
    }

    const body = await parseJsonBody<{
      fileName: string;
      contentType: string;
      base64Data: string;
      kind?: MediaKind;
      messageId?: string;
    }>(c.req.raw);

    if (typeof body.fileName !== 'string' || !body.fileName.trim()) {
      throw validationError('fileName is required.', { field: 'fileName' });
    }

    if (typeof body.contentType !== 'string' || !body.contentType.trim()) {
      throw validationError('contentType is required.', { field: 'contentType' });
    }

    if (typeof body.base64Data !== 'string' || !body.base64Data.trim()) {
      throw validationError('base64Data is required.', { field: 'base64Data' });
    }

    const media = await createMedia({
      chatId,
      fileName: body.fileName,
      fileBytes: Uint8Array.from(Buffer.from(body.base64Data, 'base64')),
      contentType: body.contentType,
      kind: body.kind,
      messageId: body.messageId,
    });

    return c.json(media, 201);
  } catch (error) {
    return toErrorResponse(error);
  }
});

// Media metadata routes - mounted at /api/v1/media/:mediaId
const mediaMetadata = new Hono();

mediaMetadata.get('/:mediaId', (c) => {
  try {
    applyReadMiddlewares(c.req.raw);
    const mediaId = c.req.param('mediaId');
    const media = getMedia(mediaId);
    return c.json(media);
  } catch (error) {
    return toErrorResponse(error);
  }
});

mediaMetadata.delete('/:mediaId', (c) => {
  try {
    applyWriteMiddlewares(c.req.raw);
    const mediaId = c.req.param('mediaId');
    const deleted = deleteMedia(mediaId, { requireUnattached: true });
    return c.json(deleted);
  } catch (error) {
    return toErrorResponse(error);
  }
});

// File serving routes - mounted at /api/v1/files/:mediaId
const files = new Hono();

files.get('/:mediaId', (c) => {
  try {
    applyReadMiddlewares(c.req.raw);
    const mediaId = c.req.param('mediaId');
    const media = getMediaFileDescriptor(mediaId);
    const fileStat = statSync(media.absolutePath);
    const totalSize = Number(fileStat.size);

    const headers = new Headers({
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'private, max-age=86400',
      'Content-Disposition': contentDisposition(media.contentType, media.filename),
      'Content-Security-Policy': FILE_RESPONSE_CSP,
      'Content-Type': media.contentType,
      'X-Content-Type-Options': 'nosniff',
    });

    const rangeHeader = c.req.raw.headers.get('range');
    if (!rangeHeader) {
      headers.set('Content-Length', String(totalSize));
      const stream = createReadStream(media.absolutePath);
      return new Response(toWebReadableStream(stream), { status: 200, headers });
    }

    const range = parseRangeHeader(rangeHeader, totalSize);
    if (range.start >= totalSize) {
      headers.set('Content-Range', `bytes */${totalSize}`);
      return new Response(null, { status: 416, headers });
    }

    headers.set('Content-Length', String(range.end - range.start + 1));
    headers.set('Content-Range', `bytes ${range.start}-${range.end}/${totalSize}`);
    const stream = createReadStream(media.absolutePath, { start: range.start, end: range.end });
    return new Response(toWebReadableStream(stream), { status: 206, headers });
  } catch (error) {
    return toErrorResponse(error);
  }
});

files.get('/:mediaId/thumbnail', async (c) => {
  try {
    applyReadMiddlewares(c.req.raw);
    const mediaId = c.req.param('mediaId');
    const thumbnail = getThumbnailDescriptor(mediaId);
    const thumbnailStat = await stat(thumbnail.absolutePath);
    const stream = createReadStream(thumbnail.absolutePath);

    return new Response(toWebReadableStream(stream), {
      status: 200,
      headers: {
        'Cache-Control': 'private, max-age=86400',
        'Content-Disposition': `inline; filename="${quotedFileName(thumbnail.filename)}"`,
        'Content-Length': String(thumbnailStat.size),
        'Content-Type': thumbnail.contentType,
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (error) {
    return toErrorResponse(error);
  }
});

export { chatMedia, mediaMetadata, files };
