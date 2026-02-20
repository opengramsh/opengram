'use client';

import { useChatPageData } from '@/app/chats/[chatId]/_hooks/use-chat-page-data';
import { useChatPageEffects } from '@/app/chats/[chatId]/_hooks/use-chat-page-effects';

export function useChatPageController(chatId?: string) {
  const data = useChatPageData({ chatId });
  useChatPageEffects(data);
  return data;
}
