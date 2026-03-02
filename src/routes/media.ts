import { createRoute, z } from '@hono/zod-openapi';

import {
  createMediaFileResponse,
  createMediaThumbnailResponse,
  parseMediaUploadRequest,
} from '@/src/api/media-http';
import { decodeMediaCursor } from '@/src/api/pagination';
import { ChatIdParamSchema, MediaIdParamSchema, ErrorResponseSchema, readErrorResponses, writeErrorResponses, createRouter, paginatedSchema } from '@/src/api/schemas/common';
import { MediaKindQuerySchema, MediaSchema, MediaUploadMultipartSchema, MediaUploadJsonSchema } from '@/src/api/schemas/media';
import { readMiddleware, writeMiddleware } from '@/src/api/write-controls';
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
const chatMedia = createRouter();

// Register upload schemas as reusable OpenAPI components.
chatMedia.openAPIRegistry.register('MediaUploadMultipart', MediaUploadMultipartSchema);
chatMedia.openAPIRegistry.register('MediaUploadJson', MediaUploadJsonSchema);

const listChatMediaRoute = createRoute({
  operationId: 'listChatMedia',
  method: 'get',
  path: '/',
  tags: ['Media'],
  summary: 'List media in a chat',
  security: [{ bearerAuth: [] }],
  middleware: [readMiddleware] as const,
  request: { params: ChatIdParamSchema, query: MediaKindQuerySchema },
  responses: {
    200: { content: { 'application/json': { schema: paginatedSchema(MediaSchema, 'MediaList') } }, description: 'Media list' },
    ...readErrorResponses,
  },
});

chatMedia.openapi(listChatMediaRoute, (c) => {
  const { chatId } = c.req.valid('param');
  const query = c.req.valid('query');

  const result = listChatMedia(chatId, {
    kind: query.kind,
    messageId: query.messageId,
    limit: query.limit ?? 50,
    cursor: query.cursor ? decodeMediaCursor(query.cursor) : null,
  });
  return c.json({
    data: result.data,
    cursor: {
      next: result.nextCursor,
      hasMore: result.hasMore,
    },
  });
});

const uploadMediaRoute = createRoute({
  operationId: 'uploadMedia',
  method: 'post',
  path: '/',
  tags: ['Media'],
  summary: 'Upload media to a chat',
  description: 'Accepts multipart/form-data (with a `file` field) or application/json (with base64-encoded data). Body is parsed by a custom handler — see MediaUploadMultipart and MediaUploadJson schemas for the expected formats.',
  security: [{ bearerAuth: [] }],
  middleware: [writeMiddleware] as const,
  request: {
    params: ChatIdParamSchema,
    body: {
      required: true,
      content: {
        'multipart/form-data': {
          // Reference-only schema to document payload without triggering zod-openapi body parsing.
          schema: { $ref: '#/components/schemas/MediaUploadMultipart' },
        },
        'application/json': {
          // Reference-only schema to document payload without triggering zod-openapi body parsing.
          schema: { $ref: '#/components/schemas/MediaUploadJson' },
        },
      },
    },
  },
  responses: {
    201: { content: { 'application/json': { schema: MediaSchema } }, description: 'Media uploaded' },
    413: { content: { 'application/json': { schema: ErrorResponseSchema } }, description: 'Payload too large' },
    415: { content: { 'application/json': { schema: ErrorResponseSchema } }, description: 'Unsupported media type' },
    ...writeErrorResponses,
  },
});

// Use plain handler since parseMediaUploadRequest handles both multipart and JSON
chatMedia.openapi(uploadMediaRoute, async (c) => {
  const { chatId } = c.req.valid('param');
  const config = loadOpengramConfig();
  const payload = await parseMediaUploadRequest(c.req.raw, config.maxUploadBytes);

  const media = await createMedia({
    chatId,
    ...payload,
  });

  return c.json(media, 201);
});

// Media metadata routes - mounted at /api/v1/media/:mediaId
const mediaMetadata = createRouter();

const getMediaRoute = createRoute({
  operationId: 'getMedia',
  method: 'get',
  path: '/{mediaId}',
  tags: ['Media'],
  summary: 'Get media metadata',
  security: [{ bearerAuth: [] }],
  middleware: [readMiddleware] as const,
  request: { params: MediaIdParamSchema },
  responses: {
    200: { content: { 'application/json': { schema: MediaSchema } }, description: 'Media metadata' },
    ...readErrorResponses,
  },
});

mediaMetadata.openapi(getMediaRoute, (c) => {
  const { mediaId } = c.req.valid('param');
  const media = getMedia(mediaId);
  return c.json(media);
});

const deleteMediaRoute = createRoute({
  operationId: 'deleteMedia',
  method: 'delete',
  path: '/{mediaId}',
  tags: ['Media'],
  summary: 'Delete media',
  security: [{ bearerAuth: [] }],
  middleware: [writeMiddleware] as const,
  request: { params: MediaIdParamSchema },
  responses: {
    200: { content: { 'application/json': { schema: MediaSchema } }, description: 'Media deleted' },
    ...writeErrorResponses,
  },
});

mediaMetadata.openapi(deleteMediaRoute, (c) => {
  const { mediaId } = c.req.valid('param');
  const deleted = deleteMedia(mediaId, { requireUnattached: true });
  return c.json(deleted);
});

// File serving routes - mounted at /api/v1/files/:mediaId
const files = createRouter();

const getFileRoute = createRoute({
  operationId: 'downloadFile',
  method: 'get',
  path: '/{mediaId}',
  tags: ['Files'],
  summary: 'Download a file',
  security: [{ bearerAuth: [] }],
  middleware: [readMiddleware] as const,
  request: { params: MediaIdParamSchema },
  responses: {
    200: {
      description: 'File content',
      content: { 'application/octet-stream': { schema: z.string().openapi({ format: 'binary' }) } },
    },
    206: { description: 'Partial file content' },
    416: { description: 'Range not satisfiable' },
    ...readErrorResponses,
  },
});

files.openapi(getFileRoute, (c) => {
  const { mediaId } = c.req.valid('param');
  const media = getMediaFileDescriptor(mediaId);
  return createMediaFileResponse(media, c.req.raw.headers.get('range'));
});

const getThumbnailRoute = createRoute({
  operationId: 'downloadThumbnail',
  method: 'get',
  path: '/{mediaId}/thumbnail',
  tags: ['Files'],
  summary: 'Download a thumbnail',
  security: [{ bearerAuth: [] }],
  middleware: [readMiddleware] as const,
  request: { params: MediaIdParamSchema },
  responses: {
    200: {
      description: 'Thumbnail image',
      content: { 'application/octet-stream': { schema: z.string().openapi({ format: 'binary' }) } },
    },
    ...readErrorResponses,
  },
});

files.openapi(getThumbnailRoute, async (c) => {
  const { mediaId } = c.req.valid('param');
  const thumbnail = getThumbnailDescriptor(mediaId);
  return createMediaThumbnailResponse(thumbnail);
});

export { chatMedia, mediaMetadata, files };
