import { parseJsonBody, successCollection, toErrorResponse } from '@/src/api/http';
import {
  executeWithIdempotency,
  getIdempotencyKey,
} from '@/src/api/idempotency';
import { applyWriteMiddlewares } from '@/src/api/write-controls';
import { createChat, listChats } from '@/src/services/chats-service';

type CreateChatRequest = {
  agentIds: string[];
  modelId: string;
  title?: string;
  tags?: string[];
  customState?: string;
  firstMessage?: string;
};

export async function POST(request: Request) {
  try {
    applyWriteMiddlewares(request);
    const body = await parseJsonBody<CreateChatRequest>(request);
    const idempotencyKey = getIdempotencyKey(request);
    return await executeWithIdempotency(idempotencyKey, body, 201, () => createChat(body));
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function GET(request: Request) {
  try {
    const result = listChats(new URL(request.url));
    return successCollection(result.data, result.nextCursor, result.hasMore);
  } catch (error) {
    return toErrorResponse(error);
  }
}
