import { NextResponse } from 'next/server';

import { toErrorResponse } from '@/src/api/http';
import { applyReadMiddlewares, applyWriteMiddlewares } from '@/src/api/write-controls';
import { deleteMedia, getMedia } from '@/src/services/media-service';

type RouteContext = {
  params: Promise<{ mediaId: string }> | { mediaId: string };
};

async function resolveMediaId(context: RouteContext) {
  const params = await context.params;
  return params.mediaId;
}

export async function GET(request: Request, context: RouteContext) {
  try {
    applyReadMiddlewares(request);
    const mediaId = await resolveMediaId(context);
    const media = getMedia(mediaId);
    return NextResponse.json(media);
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  try {
    applyWriteMiddlewares(request);
    const mediaId = await resolveMediaId(context);
    const deleted = deleteMedia(mediaId, { requireUnattached: true });
    return NextResponse.json(deleted);
  } catch (error) {
    return toErrorResponse(error);
  }
}
