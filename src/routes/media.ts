import { Hono } from 'hono';

import {
  createMediaFileResponse,
  createMediaThumbnailResponse,
  parseMediaUploadRequest,
} from '@/src/api/media-http';
import { successCollection, toErrorResponse, validationError } from '@/src/api/http';
import { parseMediaPagination } from '@/src/api/pagination';
import { applyReadMiddlewares, applyWriteMiddlewares } from '@/src/api/write-controls';
import { loadOpengramConfig } from '@/src/config/opengram-config';
import {
  createMedia,
  deleteMedia,
  getMedia,
  getMediaFileDescriptor,
  getThumbnailDescriptor,
  listChatMedia,
} from '@/src/services/media-service';

// Chat media routes - mounted at /api/v1/chats/:chatId/media
const chatMedia = new Hono();

chatMedia.get('/', (c) => {
  try {
    applyReadMiddlewares(c.req.raw);
    const chatId = c.req.param('chatId')!;
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
    const chatId = c.req.param('chatId')!;
    const config = loadOpengramConfig();
    const payload = await parseMediaUploadRequest(c.req.raw, config.maxUploadBytes);

    const media = await createMedia({
      chatId,
      ...payload,
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
    return createMediaFileResponse(media, c.req.raw.headers.get('range'));
  } catch (error) {
    return toErrorResponse(error);
  }
});

files.get('/:mediaId/thumbnail', async (c) => {
  try {
    applyReadMiddlewares(c.req.raw);
    const mediaId = c.req.param('mediaId');
    const thumbnail = getThumbnailDescriptor(mediaId);
    return createMediaThumbnailResponse(thumbnail);
  } catch (error) {
    return toErrorResponse(error);
  }
});

export { chatMedia, mediaMetadata, files };
