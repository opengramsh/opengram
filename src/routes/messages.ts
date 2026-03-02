import { createRoute } from '@hono/zod-openapi';

import { validationError } from '@/src/api/http';
import { ChatIdParamSchema, readErrorResponses, writeErrorResponses, createRouter, MessageIdParamSchema, MessagePaginationQuerySchema, paginatedSchema } from '@/src/api/schemas/common';
import {
  CancelStreamingResultSchema,
  ChunkBodySchema,
  CompleteBodySchema,
  CreateMessageBodySchema,
  MessageSchema,
} from '@/src/api/schemas/messages';
import { readMiddleware, writeMiddleware } from '@/src/api/write-controls';
import {
  appendStreamingChunk,
  cancelStreamingMessage,
  cancelStreamingMessagesForChat,
  completeStreamingMessage,
  createMessage,
  ensureStreamingTimeoutSweeperStarted,
  listMessages,
} from '@/src/services/messages-service';

// Chat messages router - mounted at /api/v1/chats/:chatId/messages
const messages = createRouter();

const createMessageRoute = createRoute({
  operationId: 'createMessage',
  method: 'post',
  path: '/',
  tags: ['Messages'],
  summary: 'Create a message',
  security: [{ bearerAuth: [] }],
  middleware: [writeMiddleware] as const,
  request: {
    params: ChatIdParamSchema,
    body: { content: { 'application/json': { schema: CreateMessageBodySchema } }, required: true },
  },
  responses: {
    201: { content: { 'application/json': { schema: MessageSchema } }, description: 'Message created' },
    ...writeErrorResponses,
  },
});

messages.openapi(createMessageRoute, (c) => {
  const { chatId } = c.req.valid('param');
  const body = c.req.valid('json');
  const message = createMessage(chatId, body);
  return c.json(message, 201);
});

const listMessagesRoute = createRoute({
  operationId: 'listMessages',
  method: 'get',
  path: '/',
  tags: ['Messages'],
  summary: 'List messages in a chat',
  security: [{ bearerAuth: [] }],
  middleware: [readMiddleware] as const,
  request: { params: ChatIdParamSchema, query: MessagePaginationQuerySchema },
  responses: {
    200: { content: { 'application/json': { schema: paginatedSchema(MessageSchema, 'MessageList') } }, description: 'Messages' },
    ...readErrorResponses,
  },
});

messages.openapi(listMessagesRoute, (c) => {
  const { chatId } = c.req.valid('param');
  const query = c.req.valid('query');
  const result = listMessages(chatId, query);
  return c.json({
    data: result.data,
    cursor: {
      next: result.nextCursor,
      hasMore: result.hasMore,
    },
  });
});

const cancelStreamingRoute = createRoute({
  operationId: 'cancelStreamingMessages',
  method: 'post',
  path: '/cancel-streaming',
  tags: ['Messages'],
  summary: 'Cancel all streaming messages in a chat',
  security: [{ bearerAuth: [] }],
  middleware: [writeMiddleware] as const,
  request: { params: ChatIdParamSchema },
  responses: {
    200: { content: { 'application/json': { schema: CancelStreamingResultSchema } }, description: 'Streaming cancelled' },
    ...writeErrorResponses,
  },
});

messages.openapi(cancelStreamingRoute, (c) => {
  const { chatId } = c.req.valid('param');
  const result = cancelStreamingMessagesForChat(chatId);
  return c.json(result);
});

// Streaming endpoints - mounted separately at /api/v1/messages/:messageId/*
const messageActions = createRouter();

// Register optional complete body schema for OpenAPI docs only.
messageActions.openAPIRegistry.register('CompleteInput', CompleteBodySchema);

const chunksRoute = createRoute({
  operationId: 'appendStreamingChunk',
  method: 'post',
  path: '/{messageId}/chunks',
  tags: ['Messages'],
  summary: 'Append a streaming chunk',
  security: [{ bearerAuth: [] }],
  middleware: [writeMiddleware] as const,
  request: {
    params: MessageIdParamSchema,
    body: { content: { 'application/json': { schema: ChunkBodySchema } }, required: true },
  },
  responses: {
    200: { content: { 'application/json': { schema: MessageSchema } }, description: 'Chunk appended' },
    ...writeErrorResponses,
  },
});

messageActions.openapi(chunksRoute, (c) => {
  ensureStreamingTimeoutSweeperStarted();
  const { messageId } = c.req.valid('param');
  const body = c.req.valid('json');
  const message = appendStreamingChunk(messageId, body.deltaText);
  return c.json(message);
});

const completeRoute = createRoute({
  operationId: 'completeStreamingMessage',
  method: 'post',
  path: '/{messageId}/complete',
  tags: ['Messages'],
  summary: 'Complete a streaming message',
  security: [{ bearerAuth: [] }],
  middleware: [writeMiddleware] as const,
  description: 'Body is optional. If provided, must be JSON with an optional `finalText` field.',
  request: {
    params: MessageIdParamSchema,
    body: {
      required: false,
      content: {
        'application/json': {
          // Reference-only schema to document the payload without triggering zod-openapi body parsing.
          schema: { $ref: '#/components/schemas/CompleteInput' },
        },
      },
    },
  },
  responses: {
    200: { content: { 'application/json': { schema: MessageSchema } }, description: 'Message completed' },
    ...writeErrorResponses,
  },
});

messageActions.openapi(completeRoute, async (c) => {
  ensureStreamingTimeoutSweeperStarted();
  const { messageId } = c.req.valid('param');
  // The body is optional — handle empty body gracefully
  const raw = await c.req.raw.text();
  let body: { finalText?: string } = {};
  if (raw.trim()) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw) as unknown;
    } catch {
      throw validationError('Invalid JSON body.');
    }

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw validationError('JSON body must be an object.');
    }

    body = parsed as { finalText?: string };
  }
  const message = completeStreamingMessage(messageId, body);
  return c.json(message);
});

const cancelMessageRoute = createRoute({
  operationId: 'cancelStreamingMessage',
  method: 'post',
  path: '/{messageId}/cancel',
  tags: ['Messages'],
  summary: 'Cancel a streaming message',
  security: [{ bearerAuth: [] }],
  middleware: [writeMiddleware] as const,
  request: {
    params: MessageIdParamSchema,
  },
  responses: {
    200: { content: { 'application/json': { schema: MessageSchema } }, description: 'Message cancelled' },
    ...writeErrorResponses,
  },
});

messageActions.openapi(cancelMessageRoute, (c) => {
  ensureStreamingTimeoutSweeperStarted();
  const { messageId } = c.req.valid('param');
  const message = cancelStreamingMessage(messageId);
  return c.json(message);
});

export { messages as chatMessages, messageActions };
