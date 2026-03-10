import { z } from '@hono/zod-openapi';

export const MediaSchema = z.object({
  id: z.string(),
  chat_id: z.string(),
  message_id: z.string().nullable(),
  storage_path: z.string(),
  thumbnail_path: z.string().nullable(),
  filename: z.string(),
  content_type: z.string(),
  byte_size: z.number(),
  kind: z.enum(['image', 'audio', 'file']),
  created_at: z.string().openapi({ format: 'date-time' }),
}).openapi('Media');

// Upload body schemas — for OpenAPI documentation only (validation is handled by parseMediaUploadRequest)
export const MediaUploadMultipartSchema = z.object({
  file: z.any().openapi({ type: 'string', format: 'binary', description: 'The file to upload' }),
  kind: z.enum(['image', 'audio', 'file']).optional().openapi({ description: 'Media kind (auto-detected if omitted)' }),
  messageId: z.string().optional().openapi({ description: 'Message ID to attach the media to' }),
}).openapi('MediaUploadMultipart');

export const MediaUploadJsonSchema = z.object({
  fileName: z.string().openapi({ description: 'Original filename' }),
  contentType: z.string().openapi({ description: 'MIME type of the file' }),
  base64Data: z.string().openapi({ description: 'Base64-encoded file content' }),
  kind: z.enum(['image', 'audio', 'file']).optional().openapi({ description: 'Media kind (auto-detected if omitted)' }),
  messageId: z.string().optional().openapi({ description: 'Message ID to attach the media to' }),
}).openapi('MediaUploadJson');

export const MediaKindQuerySchema = z.object({
  kind: z.enum(['image', 'audio', 'file']).optional().openapi({ param: { name: 'kind', in: 'query' } }),
  messageId: z.string().optional().openapi({ param: { name: 'messageId', in: 'query' } }),
  cursor: z.string().optional().openapi({ param: { name: 'cursor', in: 'query' } }),
  limit: z.coerce.number().int().min(1).max(100).optional().openapi({ param: { name: 'limit', in: 'query' } }),
}).openapi('MediaListQuery');
