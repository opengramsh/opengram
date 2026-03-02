import { createRoute, z } from '@hono/zod-openapi';

import { executeWithIdempotency, getIdempotencyKey } from '@/src/api/idempotency';
import {
  ChatRequestStatusSchema,
  ChatSchema,
  CreateChatBodySchema,
  ListChatsQuerySchema,
  PendingSummarySchema,
  SummaryFilterQuerySchema,
  TypingBodySchema,
  UnreadSummarySchema,
  UpdateChatBodySchema,
} from '@/src/api/schemas/chats';
import { ChatIdParamSchema, IdempotencyKeyHeaderSchema, readErrorResponses, writeErrorResponses, createRouter, SuccessOkSchema, paginatedSchema } from '@/src/api/schemas/common';
import { CreateRequestBodySchema, RequestListSchema, RequestSchema } from '@/src/api/schemas/requests';
import { readMiddleware, writeMiddleware } from '@/src/api/write-controls';
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
import { recordDispatchUserTyping } from '@/src/services/dispatch-service';
import { emitEvent } from '@/src/services/events-service';
import { createRequest, listChatRequests, type CreateRequestInput } from '@/src/services/requests-service';

const chats = createRouter();

// POST /
const createChatRoute = createRoute({
  operationId: 'createChat',
  method: 'post',
  path: '/',
  tags: ['Chats'],
  summary: 'Create a chat',
  security: [{ bearerAuth: [] }],
  middleware: [writeMiddleware] as const,
  request: {
    headers: IdempotencyKeyHeaderSchema,
    body: { content: { 'application/json': { schema: CreateChatBodySchema } }, required: true },
  },
  responses: {
    201: { content: { 'application/json': { schema: ChatSchema } }, description: 'Chat created' },
    ...writeErrorResponses,
  },
});

chats.openapi(createChatRoute, async (c) => {
  const body = c.req.valid('json');
  const idempotencyKey = getIdempotencyKey(c.req.raw);
  // eslint-disable-next-line @typescript-eslint/no-unsafe-return -- executeWithIdempotency returns a raw Response; incompatible with zod-openapi's TypedResponse
  return await executeWithIdempotency(idempotencyKey, body, 201, () => createChat(body)) as any;
});

// GET /
const listChatsRoute = createRoute({
  operationId: 'listChats',
  method: 'get',
  path: '/',
  tags: ['Chats'],
  summary: 'List chats',
  security: [{ bearerAuth: [] }],
  middleware: [readMiddleware] as const,
  request: { query: ListChatsQuerySchema },
  responses: {
    200: { content: { 'application/json': { schema: paginatedSchema(ChatSchema, 'ChatList') } }, description: 'Chat list' },
    ...readErrorResponses,
  },
});

chats.openapi(listChatsRoute, (c) => {
  const query = c.req.valid('query');
  const result = listChats(query);
  return c.json({
    data: result.data,
    cursor: {
      next: result.nextCursor,
      hasMore: result.hasMore,
    },
  });
});

// GET /pending-summary
const pendingSummaryRoute = createRoute({
  operationId: 'getPendingSummary',
  method: 'get',
  path: '/pending-summary',
  tags: ['Chats'],
  summary: 'Get pending requests summary',
  security: [{ bearerAuth: [] }],
  middleware: [readMiddleware] as const,
  request: { query: SummaryFilterQuerySchema },
  responses: {
    200: { content: { 'application/json': { schema: PendingSummarySchema } }, description: 'Pending summary' },
    ...readErrorResponses,
  },
});

chats.openapi(pendingSummaryRoute, (c) => {
  const query = c.req.valid('query');
  const result = getPendingSummary(query);
  return c.json({ pending_requests_total: result.pendingRequestsTotal });
});

// GET /unread-summary
const unreadSummaryRoute = createRoute({
  operationId: 'getUnreadSummary',
  method: 'get',
  path: '/unread-summary',
  tags: ['Chats'],
  summary: 'Get unread messages summary',
  security: [{ bearerAuth: [] }],
  middleware: [readMiddleware] as const,
  request: { query: SummaryFilterQuerySchema },
  responses: {
    200: { content: { 'application/json': { schema: UnreadSummarySchema } }, description: 'Unread summary' },
    ...readErrorResponses,
  },
});

chats.openapi(unreadSummaryRoute, (c) => {
  const query = c.req.valid('query');
  const result = getUnreadSummary(query);
  return c.json({ total_unread: result.totalUnread, unread_by_agent: result.unreadByAgent });
});

// GET /:chatId
const getChatRoute = createRoute({
  operationId: 'getChat',
  method: 'get',
  path: '/{chatId}',
  tags: ['Chats'],
  summary: 'Get a chat',
  security: [{ bearerAuth: [] }],
  middleware: [readMiddleware] as const,
  request: { params: ChatIdParamSchema },
  responses: {
    200: { content: { 'application/json': { schema: ChatSchema } }, description: 'Chat details' },
    ...readErrorResponses,
  },
});

chats.openapi(getChatRoute, (c) => {
  const { chatId } = c.req.valid('param');
  const chat = getChat(chatId);
  return c.json(chat);
});

// PATCH /:chatId
const updateChatRoute = createRoute({
  operationId: 'updateChat',
  method: 'patch',
  path: '/{chatId}',
  tags: ['Chats'],
  summary: 'Update a chat',
  security: [{ bearerAuth: [] }],
  middleware: [writeMiddleware] as const,
  request: {
    params: ChatIdParamSchema,
    body: { content: { 'application/json': { schema: UpdateChatBodySchema } }, required: true },
  },
  responses: {
    200: { content: { 'application/json': { schema: ChatSchema } }, description: 'Chat updated' },
    ...writeErrorResponses,
  },
});

chats.openapi(updateChatRoute, (c) => {
  const { chatId } = c.req.valid('param');
  const body = c.req.valid('json');
  const updated = updateChat(chatId, body);
  return c.json(updated);
});

// POST /:chatId/archive
const archiveChatRoute = createRoute({
  operationId: 'archiveChat',
  method: 'post',
  path: '/{chatId}/archive',
  tags: ['Chats'],
  summary: 'Archive a chat',
  security: [{ bearerAuth: [] }],
  middleware: [writeMiddleware] as const,
  request: { params: ChatIdParamSchema },
  responses: {
    200: { content: { 'application/json': { schema: SuccessOkSchema } }, description: 'Chat archived' },
    ...writeErrorResponses,
  },
});

chats.openapi(archiveChatRoute, (c) => {
  const { chatId } = c.req.valid('param');
  archiveChat(chatId);
  return c.json({ ok: true as const });
});

// POST /:chatId/unarchive
const unarchiveChatRoute = createRoute({
  operationId: 'unarchiveChat',
  method: 'post',
  path: '/{chatId}/unarchive',
  tags: ['Chats'],
  summary: 'Unarchive a chat',
  security: [{ bearerAuth: [] }],
  middleware: [writeMiddleware] as const,
  request: { params: ChatIdParamSchema },
  responses: {
    200: { content: { 'application/json': { schema: SuccessOkSchema } }, description: 'Chat unarchived' },
    ...writeErrorResponses,
  },
});

chats.openapi(unarchiveChatRoute, (c) => {
  const { chatId } = c.req.valid('param');
  unarchiveChat(chatId);
  return c.json({ ok: true as const });
});

// POST /:chatId/mark-read
const markReadRoute = createRoute({
  operationId: 'markChatRead',
  method: 'post',
  path: '/{chatId}/mark-read',
  tags: ['Chats'],
  summary: 'Mark a chat as read',
  security: [{ bearerAuth: [] }],
  middleware: [writeMiddleware] as const,
  request: { params: ChatIdParamSchema },
  responses: {
    200: { content: { 'application/json': { schema: SuccessOkSchema } }, description: 'Chat marked read' },
    ...writeErrorResponses,
  },
});

chats.openapi(markReadRoute, (c) => {
  const { chatId } = c.req.valid('param');
  markChatRead(chatId);
  return c.json({ ok: true as const });
});

// POST /:chatId/mark-unread
const markUnreadRoute = createRoute({
  operationId: 'markChatUnread',
  method: 'post',
  path: '/{chatId}/mark-unread',
  tags: ['Chats'],
  summary: 'Mark a chat as unread',
  security: [{ bearerAuth: [] }],
  middleware: [writeMiddleware] as const,
  request: { params: ChatIdParamSchema },
  responses: {
    200: { content: { 'application/json': { schema: SuccessOkSchema } }, description: 'Chat marked unread' },
    ...writeErrorResponses,
  },
});

chats.openapi(markUnreadRoute, (c) => {
  const { chatId } = c.req.valid('param');
  markChatUnread(chatId);
  return c.json({ ok: true as const });
});

// GET /:chatId/requests
const ChatRequestsQuerySchema = z.object({
  status: ChatRequestStatusSchema.optional().openapi({ param: { name: 'status', in: 'query' } }),
});

const listChatRequestsRoute = createRoute({
  operationId: 'listChatRequests',
  method: 'get',
  path: '/{chatId}/requests',
  tags: ['Chats'],
  summary: 'List requests for a chat',
  security: [{ bearerAuth: [] }],
  middleware: [readMiddleware] as const,
  request: {
    params: ChatIdParamSchema,
    query: ChatRequestsQuerySchema,
  },
  responses: {
    200: { content: { 'application/json': { schema: RequestListSchema } }, description: 'Chat requests' },
    ...readErrorResponses,
  },
});

chats.openapi(listChatRequestsRoute, (c) => {
  const { chatId } = c.req.valid('param');
  const { status } = c.req.valid('query');
  const requests = listChatRequests(chatId, status ?? 'pending');
  return c.json({ data: requests });
});

// POST /:chatId/typing
const typingRoute = createRoute({
  operationId: 'sendTypingIndicator',
  method: 'post',
  path: '/{chatId}/typing',
  tags: ['Chats'],
  summary: 'Send typing indicator',
  security: [{ bearerAuth: [] }],
  middleware: [writeMiddleware] as const,
  request: {
    params: ChatIdParamSchema,
    body: { content: { 'application/json': { schema: TypingBodySchema } }, required: true },
  },
  responses: {
    204: { description: 'Typing indicator sent' },
    ...writeErrorResponses,
  },
});

chats.openapi(typingRoute, (c) => {
  const { chatId } = c.req.valid('param');
  const body = c.req.valid('json');
  getChat(chatId); // validate chat exists
  emitEvent('chat.typing', { chatId, agentId: body.agentId }, { ephemeral: true });
  return c.body(null, 204);
});

// POST /:chatId/user-typing
const userTypingRoute = createRoute({
  operationId: 'sendUserTypingIndicator',
  method: 'post',
  path: '/{chatId}/user-typing',
  tags: ['Chats'],
  summary: 'Send user typing indicator',
  security: [{ bearerAuth: [] }],
  middleware: [writeMiddleware] as const,
  request: { params: ChatIdParamSchema },
  responses: {
    204: { description: 'User typing indicator sent' },
    ...writeErrorResponses,
  },
});

chats.openapi(userTypingRoute, (c) => {
  const { chatId } = c.req.valid('param');
  getChat(chatId); // validate chat exists
  recordDispatchUserTyping(chatId);
  emitEvent('chat.user_typing', { chatId, senderId: 'user:primary' }, { ephemeral: true });
  return c.body(null, 204);
});

// POST /:chatId/requests
const createChatRequestRoute = createRoute({
  operationId: 'createChatRequest',
  method: 'post',
  path: '/{chatId}/requests',
  tags: ['Chats'],
  summary: 'Create a request in a chat',
  security: [{ bearerAuth: [] }],
  middleware: [writeMiddleware] as const,
  request: {
    headers: IdempotencyKeyHeaderSchema,
    params: ChatIdParamSchema,
    body: { content: { 'application/json': { schema: CreateRequestBodySchema } }, required: true },
  },
  responses: {
    201: { content: { 'application/json': { schema: RequestSchema } }, description: 'Request created' },
    ...writeErrorResponses,
  },
});

chats.openapi(createChatRequestRoute, async (c) => {
  const { chatId } = c.req.valid('param');
  const body = c.req.valid('json') as CreateRequestInput;
  const idempotencyKey = getIdempotencyKey(c.req.raw);
  // eslint-disable-next-line @typescript-eslint/no-unsafe-return -- executeWithIdempotency returns a raw Response; incompatible with zod-openapi's TypedResponse
  return await executeWithIdempotency(idempotencyKey, { chatId, body }, 201, () => createRequest(chatId, body)) as any;
});

export default chats;
