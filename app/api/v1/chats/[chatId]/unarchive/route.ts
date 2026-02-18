import { successOk, toErrorResponse } from '@/src/api/http';
import { unarchiveChat } from '@/src/services/chats-service';

type RouteContext = {
  params: Promise<{ chatId: string }> | { chatId: string };
};

export async function POST(_: Request, context: RouteContext) {
  try {
    const { chatId } = await context.params;
    unarchiveChat(chatId);
    return successOk();
  } catch (error) {
    return toErrorResponse(error);
  }
}
