import { createRoute } from '@hono/zod-openapi';

import { writeErrorResponses, createRouter } from '@/src/api/schemas/common';
import {
  RequestIdParamSchema,
  RequestSchema,
  ResolveRequestBodySchema,
  UpdateRequestBodySchema,
} from '@/src/api/schemas/requests';
import { writeMiddleware } from '@/src/api/write-controls';
import { cancelRequest, resolveRequest, updateRequest } from '@/src/services/requests-service';

const requests = createRouter();

const updateRequestRoute = createRoute({
  operationId: 'updateRequest',
  method: 'patch',
  path: '/{requestId}',
  tags: ['Requests'],
  summary: 'Update a request',
  security: [{ bearerAuth: [] }],
  middleware: [writeMiddleware] as const,
  request: {
    params: RequestIdParamSchema,
    body: { content: { 'application/json': { schema: UpdateRequestBodySchema } }, required: true },
  },
  responses: {
    200: { content: { 'application/json': { schema: RequestSchema } }, description: 'Request updated' },
    ...writeErrorResponses,
  },
});

requests.openapi(updateRequestRoute, (c) => {
  const { requestId } = c.req.valid('param');
  const body = c.req.valid('json');
  const updated = updateRequest(requestId, body);
  return c.json(updated);
});

const resolveRequestRoute = createRoute({
  operationId: 'resolveRequest',
  method: 'post',
  path: '/{requestId}/resolve',
  tags: ['Requests'],
  summary: 'Resolve a request',
  security: [{ bearerAuth: [] }],
  middleware: [writeMiddleware] as const,
  request: {
    params: RequestIdParamSchema,
    body: { content: { 'application/json': { schema: ResolveRequestBodySchema } }, required: true },
  },
  responses: {
    200: { content: { 'application/json': { schema: RequestSchema } }, description: 'Request resolved' },
    ...writeErrorResponses,
  },
});

requests.openapi(resolveRequestRoute, (c) => {
  const { requestId } = c.req.valid('param');
  const payload = c.req.valid('json');
  const resolved = resolveRequest(requestId, payload);
  return c.json(resolved);
});

const cancelRequestRoute = createRoute({
  operationId: 'cancelRequest',
  method: 'post',
  path: '/{requestId}/cancel',
  tags: ['Requests'],
  summary: 'Cancel a request',
  security: [{ bearerAuth: [] }],
  middleware: [writeMiddleware] as const,
  request: {
    params: RequestIdParamSchema,
  },
  responses: {
    200: { content: { 'application/json': { schema: RequestSchema } }, description: 'Request cancelled' },
    ...writeErrorResponses,
  },
});

requests.openapi(cancelRequestRoute, (c) => {
  const { requestId } = c.req.valid('param');
  const cancelled = cancelRequest(requestId);
  return c.json(cancelled);
});

export default requests;
