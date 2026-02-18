import { toErrorResponse } from '@/src/api/http';
import { readMediaFile } from '@/src/services/media-service';

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
    const media = readMediaFile(mediaId);

    return new Response(media.content, {
      headers: {
        'Content-Type': media.contentType,
        'Content-Disposition': `inline; filename="${media.filename}"`,
        'Cache-Control': 'private, max-age=86400',
      },
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
