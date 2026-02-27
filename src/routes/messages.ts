import { Hono } from 'hono';

import { parseJsonBody, successCollection, toErrorResponse, validationError } from '@/src/api/http';
import { applyReadMiddlewares, applyWriteMiddlewares } from '@/src/api/write-controls';
import {
  appendStreamingChunk,
  cancelStreamingMessage,
  cancelStreamingMessagesForChat,
  completeStreamingMessage,
  createMessage,
  ensureStreamingTimeoutSweeperStarted,
  listMessages,
} from '@/src/services/messages-service';

type CreateMessageRequest = {
  role: 'user' | 'agent' | 'system' | 'tool';
  senderId: string;
  content?: string;
  streaming?: boolean;
  modelId?: string;
  trace?: Record<string, unknown>;
};

type ChunkRequest = {
  deltaText: string;
};

type CompleteRequest = {
  finalText?: string;
};

const messages = new Hono();

// POST /chats/:chatId/messages - mounted at /api/v1/chats/:chatId/messages from server.ts
messages.post('/', async (c) => {
  try {
    applyWriteMiddlewares(c.req.raw);
    const chatId = c.req.param('chatId')!;
    const body = await parseJsonBody<CreateMessageRequest>(c.req.raw);
    const message = createMessage(chatId, body);
    return c.json(message, 201);
  } catch (error) {
    return toErrorResponse(error);
  }
});

messages.get('/', (c) => {
  try {
    applyReadMiddlewares(c.req.raw);
    const chatId = c.req.param('chatId')!;
    const result = listMessages(chatId, new URL(c.req.url));
    return successCollection(result.data, result.nextCursor, result.hasMore);
  } catch (error) {
    return toErrorResponse(error);
  }
});

// Streaming endpoints - mounted separately at /api/v1/messages/:messageId/*
const messageActions = new Hono();

messageActions.post('/:messageId/chunks', async (c) => {
  try {
    applyWriteMiddlewares(c.req.raw);
    ensureStreamingTimeoutSweeperStarted();
    const messageId = c.req.param('messageId');
    const body = await parseJsonBody<ChunkRequest>(c.req.raw);
    const message = appendStreamingChunk(messageId, body.deltaText);
    return c.json(message);
  } catch (error) {
    return toErrorResponse(error);
  }
});

messageActions.post('/:messageId/complete', async (c) => {
  try {
    applyWriteMiddlewares(c.req.raw);
    ensureStreamingTimeoutSweeperStarted();
    const messageId = c.req.param('messageId');
    const raw = await c.req.raw.text();
    let body: CompleteRequest = {};
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

      body = parsed as CompleteRequest;
    }
    const message = completeStreamingMessage(messageId, body);
    return c.json(message);
  } catch (error) {
    return toErrorResponse(error);
  }
});

messageActions.post('/:messageId/cancel', (c) => {
  try {
    applyWriteMiddlewares(c.req.raw);
    ensureStreamingTimeoutSweeperStarted();
    const messageId = c.req.param('messageId');
    const message = cancelStreamingMessage(messageId);
    return c.json(message);
  } catch (error) {
    return toErrorResponse(error);
  }
});

// POST /chats/:chatId/cancel-streaming - bulk-cancel all streaming messages for a chat
messages.post('/cancel-streaming', (c) => {
  try {
    applyWriteMiddlewares(c.req.raw);
    const chatId = c.req.param('chatId')!;
    const result = cancelStreamingMessagesForChat(chatId);
    return c.json(result);
  } catch (error) {
    return toErrorResponse(error);
  }
});

export { messages as chatMessages, messageActions };
