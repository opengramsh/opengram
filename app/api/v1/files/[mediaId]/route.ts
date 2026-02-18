import { createReadStream, statSync } from 'node:fs';
import { Readable } from 'node:stream';

import { toErrorResponse, validationError } from '@/src/api/http';
import { getMediaFileDescriptor } from '@/src/services/media-service';

type RouteContext = {
  params: Promise<{ mediaId: string }> | { mediaId: string };
};

type ParsedRange = {
  start: number;
  end: number;
};

async function resolveMediaId(context: RouteContext) {
  const params = await context.params;
  return params.mediaId;
}

function parseRangeHeader(rangeHeader: string, totalSize: number): ParsedRange {
  if (!rangeHeader.startsWith('bytes=')) {
    throw validationError('Invalid Range header.');
  }

  const rangeValue = rangeHeader.slice('bytes='.length).trim();
  if (!rangeValue || rangeValue.includes(',')) {
    throw validationError('Only a single byte range is supported.');
  }

  const [rawStart, rawEnd] = rangeValue.split('-', 2);
  if (rawStart === undefined || rawEnd === undefined) {
    throw validationError('Invalid Range header.');
  }

  if (rawStart === '') {
    const suffixLength = Number(rawEnd);
    if (!Number.isInteger(suffixLength) || suffixLength <= 0) {
      throw validationError('Invalid Range header.');
    }

    const length = Math.min(suffixLength, totalSize);
    return {
      start: totalSize - length,
      end: totalSize - 1,
    };
  }

  const start = Number(rawStart);
  const end = rawEnd === '' ? totalSize - 1 : Number(rawEnd);

  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start) {
    throw validationError('Invalid Range header.');
  }

  if (start >= totalSize) {
    return {
      start: totalSize,
      end: totalSize - 1,
    };
  }

  return {
    start,
    end: Math.min(end, totalSize - 1),
  };
}

function quotedFileName(name: string) {
  return name.replace(/["\\]/g, '_');
}

function isSafeInlineType(contentType: string) {
  return (
    contentType.startsWith('image/')
    || contentType.startsWith('audio/')
    || contentType.startsWith('video/')
    || contentType === 'application/pdf'
  );
}

function contentDisposition(contentType: string, filename: string) {
  const mode = isSafeInlineType(contentType) ? 'inline' : 'attachment';
  return `${mode}; filename="${quotedFileName(filename)}"`;
}

function toWebReadableStream(stream: NodeJS.ReadableStream) {
  return Readable.toWeb(stream) as ReadableStream<Uint8Array>;
}

export async function GET(request: Request, context: RouteContext) {
  try {
    const mediaId = await resolveMediaId(context);
    const media = getMediaFileDescriptor(mediaId);
    const stat = statSync(media.absolutePath);
    const totalSize = Number(stat.size);

    const headers = new Headers({
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'private, max-age=86400',
      'Content-Disposition': contentDisposition(media.contentType, media.filename),
      'Content-Type': media.contentType,
      'X-Content-Type-Options': 'nosniff',
    });

    const rangeHeader = request.headers.get('range');
    if (!rangeHeader) {
      headers.set('Content-Length', String(totalSize));
      const stream = createReadStream(media.absolutePath);
      return new Response(toWebReadableStream(stream), {
        status: 200,
        headers,
      });
    }

    const range = parseRangeHeader(rangeHeader, totalSize);
    if (range.start >= totalSize) {
      headers.set('Content-Range', `bytes */${totalSize}`);
      return new Response(null, { status: 416, headers });
    }

    headers.set('Content-Length', String(range.end - range.start + 1));
    headers.set('Content-Range', `bytes ${range.start}-${range.end}/${totalSize}`);
    const stream = createReadStream(media.absolutePath, { start: range.start, end: range.end });

    return new Response(toWebReadableStream(stream), {
      status: 206,
      headers,
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
