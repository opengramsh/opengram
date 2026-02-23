import { Hono } from 'hono';

import { parseJsonBody, successCollection, successOk, toErrorResponse, validationError } from '@/src/api/http';
import { executeWithIdempotency, getIdempotencyKey } from '@/src/api/idempotency';
import { applyReadMiddlewares, applyWriteMiddlewares } from '@/src/api/write-controls';
import {
  archiveChat,
  createChat,
  getChat,
  getPendingSummary,
  getUnreadSummary,
  listChats,
  markChatRead,
  markChatUnread,
  unarchiveChat,
  updateChat,
} from '@/src/services/chats-service';
import { createRequest, listChatRequests } from '@/src/services/requests-service';

type CreateChatRequest = {
  agentIds: string[];
  modelId: string;
  title?: string;
  tags?: string[];
  firstMessage?: string;
};

type UpdateChatRequest = {
  title?: string;
  tags?: string[];
  pinned?: boolean;
  modelId?: string;
  notificationsMuted?: boolean;
};

const chats = new Hono();

chats.post('/', async (c) => {
  try {
    applyWriteMiddlewares(c.req.raw);
    const body = await parseJsonBody<CreateChatRequest>(c.req.raw);
    const idempotencyKey = getIdempotencyKey(c.req.raw);
    return await executeWithIdempotency(idempotencyKey, body, 201, () => createChat(body));
  } catch (error) {
    return toErrorResponse(error);
  }
});

chats.get('/', (c) => {
  try {
    applyReadMiddlewares(c.req.raw);
    const result = listChats(new URL(c.req.url));
    return successCollection(result.data, result.nextCursor, result.hasMore);
  } catch (error) {
    return toErrorResponse(error);
  }
});

chats.get('/pending-summary', (c) => {
  try {
    applyReadMiddlewares(c.req.raw);
    const result = getPendingSummary(new URL(c.req.url));
    return c.json({ pending_requests_total: result.pendingRequestsTotal });
  } catch (error) {
    return toErrorResponse(error);
  }
});

chats.get('/unread-summary', (c) => {
  try {
    applyReadMiddlewares(c.req.raw);
    const result = getUnreadSummary(new URL(c.req.url));
    return c.json({ total_unread: result.totalUnread, unread_by_agent: result.unreadByAgent });
  } catch (error) {
    return toErrorResponse(error);
  }
});

chats.get('/:chatId', (c) => {
  try {
    applyReadMiddlewares(c.req.raw);
    const chatId = c.req.param('chatId');
    const chat = getChat(chatId);
    return c.json(chat);
  } catch (error) {
    return toErrorResponse(error);
  }
});

chats.patch('/:chatId', async (c) => {
  try {
    applyWriteMiddlewares(c.req.raw);
    const chatId = c.req.param('chatId');
    const body = await parseJsonBody<UpdateChatRequest>(c.req.raw);
    const updated = updateChat(chatId, body);
    return c.json(updated);
  } catch (error) {
    return toErrorResponse(error);
  }
});

chats.post('/:chatId/archive', (c) => {
  try {
    applyWriteMiddlewares(c.req.raw);
    const chatId = c.req.param('chatId');
    archiveChat(chatId);
    return successOk();
  } catch (error) {
    return toErrorResponse(error);
  }
});

chats.post('/:chatId/unarchive', (c) => {
  try {
    applyWriteMiddlewares(c.req.raw);
    const chatId = c.req.param('chatId');
    unarchiveChat(chatId);
    return successOk();
  } catch (error) {
    return toErrorResponse(error);
  }
});

chats.post('/:chatId/mark-read', (c) => {
  try {
    applyWriteMiddlewares(c.req.raw);
    const chatId = c.req.param('chatId');
    markChatRead(chatId);
    return successOk();
  } catch (error) {
    return toErrorResponse(error);
  }
});

chats.post('/:chatId/mark-unread', (c) => {
  try {
    applyWriteMiddlewares(c.req.raw);
    const chatId = c.req.param('chatId');
    markChatUnread(chatId);
    return successOk();
  } catch (error) {
    return toErrorResponse(error);
  }
});

chats.get('/:chatId/requests', (c) => {
  try {
    applyReadMiddlewares(c.req.raw);
    const chatId = c.req.param('chatId');
    const statusParam = new URL(c.req.url).searchParams.get('status') ?? 'pending';

    if (statusParam !== 'pending' && statusParam !== 'resolved' && statusParam !== 'cancelled' && statusParam !== 'all') {
      throw validationError('status must be one of pending, resolved, cancelled, all.', {
        field: 'status',
      });
    }

    const status = statusParam as 'pending' | 'resolved' | 'cancelled' | 'all';
    const requests = listChatRequests(chatId, status);
    return c.json({ data: requests });
  } catch (error) {
    return toErrorResponse(error);
  }
});

chats.post('/:chatId/requests', async (c) => {
  try {
    applyWriteMiddlewares(c.req.raw);
    const chatId = c.req.param('chatId');
    const body = await parseJsonBody<Record<string, unknown>>(c.req.raw);
    const idempotencyKey = getIdempotencyKey(c.req.raw);
    return await executeWithIdempotency(idempotencyKey, { chatId, body }, 201, () => createRequest(chatId, body));
  } catch (error) {
    return toErrorResponse(error);
  }
});

export default chats;
