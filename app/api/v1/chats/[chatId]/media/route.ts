import { NextResponse } from 'next/server';

import { parseJsonBody, toErrorResponse, validationError } from '@/src/api/http';
import { enforceWriteGuards } from '@/src/api/write-controls';
import { createMedia, listChatMedia } from '@/src/services/media-service';

type MediaKind = 'image' | 'audio' | 'file';

type RouteContext = {
  params: Promise<{ chatId: string }> | { chatId: string };
};

async function resolveChatId(context: RouteContext) {
  const params = await context.params;
  return params.chatId;
}

export async function GET(request: Request, context: RouteContext) {
  try {
    const chatId = await resolveChatId(context);
    const url = new URL(request.url);
    const kindParam = url.searchParams.get('kind');
    const messageId = url.searchParams.get('messageId') ?? undefined;

    if (kindParam !== null && kindParam !== 'image' && kindParam !== 'audio' && kindParam !== 'file') {
      throw validationError('kind must be image, audio, or file.', { field: 'kind' });
    }

    const media = listChatMedia(chatId, kindParam ?? undefined, messageId);
    return NextResponse.json({ data: media });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(request: Request, context: RouteContext) {
  try {
    enforceWriteGuards(request);
    const chatId = await resolveChatId(context);

    const contentType = request.headers.get('content-type') ?? '';
    if (contentType.includes('multipart/form-data')) {
      const form = await request.formData();
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

      const buffer = new Uint8Array(await file.arrayBuffer());
      const resolvedKind = kind === null ? undefined : kind;
      if (resolvedKind !== undefined && resolvedKind !== 'image' && resolvedKind !== 'audio' && resolvedKind !== 'file') {
        throw validationError('kind must be image, audio, or file.', { field: 'kind' });
      }

      const media = createMedia({
        chatId,
        fileName: file.name,
        fileBytes: buffer,
        contentType: file.type || 'application/octet-stream',
        kind: resolvedKind,
        messageId: messageId === null ? undefined : messageId,
      });

      return NextResponse.json(media, { status: 201 });
    }

    const body = await parseJsonBody<{
      fileName: string;
      contentType: string;
      base64Data: string;
      kind?: MediaKind;
      messageId?: string;
    }>(request);

    if (typeof body.fileName !== 'string' || !body.fileName.trim()) {
      throw validationError('fileName is required.', { field: 'fileName' });
    }

    if (typeof body.contentType !== 'string' || !body.contentType.trim()) {
      throw validationError('contentType is required.', { field: 'contentType' });
    }

    if (typeof body.base64Data !== 'string' || !body.base64Data.trim()) {
      throw validationError('base64Data is required.', { field: 'base64Data' });
    }

    const media = createMedia({
      chatId,
      fileName: body.fileName,
      fileBytes: Uint8Array.from(Buffer.from(body.base64Data, 'base64')),
      contentType: body.contentType,
      kind: body.kind,
      messageId: body.messageId,
    });

    return NextResponse.json(media, { status: 201 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
