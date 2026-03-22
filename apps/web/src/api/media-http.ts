import { createReadStream, statSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import { Readable } from 'node:stream';

import { parseJsonBody, payloadTooLargeError, validationError } from '@/src/api/http';

type MediaKind = 'image' | 'audio' | 'file';
type ParsedRange = { start: number; end: number };

type StreamingRequestInit = RequestInit & { duplex: 'half' };

type Base64MediaUploadRequest = {
  fileName: string;
  contentType: string;
  base64Data: string;
  kind?: MediaKind;
  messageId?: string;
};

export type MediaUploadPayload = {
  fileName: string;
  fileBytes: Uint8Array;
  contentType: string;
  kind?: MediaKind;
  messageId?: string;
};

type MediaFileDescriptor = {
  absolutePath: string;
  contentType: string;
  filename: string;
};

type ThumbnailDescriptor = {
  absolutePath: string;
  contentType: string;
  filename: string;
};

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
  } as StreamingRequestInit);
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

function parseMediaKind(raw: string | null, field: 'kind') {
  if (raw === null) {
    return undefined;
  }

  if (raw !== 'image' && raw !== 'audio' && raw !== 'file') {
    throw validationError(`${field} must be image, audio, or file.`, { field });
  }

  return raw;
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

export async function parseMediaUploadRequest(request: Request, maxUploadBytes: number): Promise<MediaUploadPayload> {
  const contentType = request.headers.get('content-type') ?? '';
  if (contentType.includes('multipart/form-data')) {
    const form = await parseMultipartFormData(
      request,
      maxUploadBytes + MULTIPART_BODY_OVERHEAD_BYTES,
    );
    const file = form.get('file');
    const rawKind = form.get('kind');
    const messageId = form.get('messageId');

    if (!(file instanceof File)) {
      throw validationError('file is required.', { field: 'file' });
    }

    if (rawKind !== null && typeof rawKind !== 'string') {
      throw validationError('kind must be a string.', { field: 'kind' });
    }

    if (messageId !== null && typeof messageId !== 'string') {
      throw validationError('messageId must be a string.', { field: 'messageId' });
    }

    return {
      fileName: file.name,
      fileBytes: await readFileBytesWithLimit(file, maxUploadBytes),
      contentType: file.type || 'application/octet-stream',
      kind: parseMediaKind(rawKind, 'kind'),
      messageId: messageId ?? undefined,
    };
  }

  const body = await parseJsonBody<Base64MediaUploadRequest>(request);

  if (typeof body.fileName !== 'string' || !body.fileName.trim()) {
    throw validationError('fileName is required.', { field: 'fileName' });
  }

  if (typeof body.contentType !== 'string' || !body.contentType.trim()) {
    throw validationError('contentType is required.', { field: 'contentType' });
  }

  if (typeof body.base64Data !== 'string' || !body.base64Data.trim()) {
    throw validationError('base64Data is required.', { field: 'base64Data' });
  }

  return {
    fileName: body.fileName,
    fileBytes: Uint8Array.from(Buffer.from(body.base64Data, 'base64')),
    contentType: body.contentType,
    kind: body.kind === undefined ? undefined : parseMediaKind(body.kind, 'kind'),
    messageId: body.messageId,
  };
}

export function createMediaFileResponse(media: MediaFileDescriptor, rangeHeader: string | null) {
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
}

export async function createMediaThumbnailResponse(thumbnail: ThumbnailDescriptor) {
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
}
