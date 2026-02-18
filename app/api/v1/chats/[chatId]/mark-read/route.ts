import { successOk, toErrorResponse } from '@/src/api/http';
import { enforceWriteGuards } from '@/src/api/write-controls';
import { markChatRead } from '@/src/services/chats-service';

type RouteContext = {
  params: Promise<{ chatId: string }> | { chatId: string };
};

export async function POST(request: Request, context: RouteContext) {
  try {
    enforceWriteGuards(request);
    const { chatId } = await context.params;
    markChatRead(chatId);
    return successOk();
  } catch (error) {
    return toErrorResponse(error);
  }
}
