import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { Readable } from 'node:stream';

import { toErrorResponse } from '@/src/api/http';
import { applyReadMiddlewares } from '@/src/api/write-controls';
import { getThumbnailDescriptor } from '@/src/services/media-service';

type RouteContext = {
  params: Promise<{ mediaId: string }> | { mediaId: string };
};

async function resolveMediaId(context: RouteContext) {
  const params = await context.params;
  return params.mediaId;
}

function quotedFileName(name: string) {
  return name.replace(/["\\]/g, '_');
}

function toWebReadableStream(stream: Readable) {
  return Readable.toWeb(stream) as ReadableStream<Uint8Array>;
}

export async function GET(request: Request, context: RouteContext) {
  try {
    applyReadMiddlewares(request);
    const mediaId = await resolveMediaId(context);
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
}
