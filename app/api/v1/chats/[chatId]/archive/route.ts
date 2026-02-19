import { successOk, toErrorResponse } from '@/src/api/http';
import { applyWriteMiddlewares } from '@/src/api/write-controls';
import { archiveChat } from '@/src/services/chats-service';

type RouteContext = {
  params: Promise<{ chatId: string }> | { chatId: string };
};

export async function POST(request: Request, context: RouteContext) {
  try {
    applyWriteMiddlewares(request);
    const { chatId } = await context.params;
    archiveChat(chatId);
    return successOk();
  } catch (error) {
    return toErrorResponse(error);
  }
}
