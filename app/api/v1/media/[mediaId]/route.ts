import { NextResponse } from 'next/server';

import { toErrorResponse } from '@/src/api/http';
import { getMedia } from '@/src/services/media-service';

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
    const media = getMedia(mediaId);
    return NextResponse.json(media);
  } catch (error) {
    return toErrorResponse(error);
  }
}
