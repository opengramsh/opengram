import { readFileSync } from 'node:fs';

import { toErrorResponse } from '@/src/api/http';
import { getThumbnailDescriptor } from '@/src/services/media-service';

type RouteContext = {
  params: Promise<{ mediaId: string }> | { mediaId: string };
};

async function resolveMediaId(context: RouteContext) {
  const params = await context.params;
  return params.mediaId;
}

export async function GET(_: Request, context: RouteContext) {
  try {
    const mediaId = await resolveMediaId(context);
    const thumbnail = getThumbnailDescriptor(mediaId);

    return new Response(readFileSync(thumbnail.absolutePath), {
      status: 200,
      headers: {
        'Cache-Control': 'private, max-age=86400',
        'Content-Disposition': `inline; filename="${thumbnail.filename}"`,
        'Content-Type': thumbnail.contentType,
      },
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
