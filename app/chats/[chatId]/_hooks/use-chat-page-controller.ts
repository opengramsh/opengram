'use client';

import { useChatPageData } from '@/app/chats/[chatId]/_hooks/use-chat-page-data';
import { useChatPageEffects } from '@/app/chats/[chatId]/_hooks/use-chat-page-effects';
import type { Chat } from '@/app/chats/[chatId]/_lib/types';

export function useChatPageController(chatId?: string, initialChat?: Chat | null, scrollToMessageId?: string, fromPath?: string) {
  const data = useChatPageData({ chatId, initialChat, scrollToMessageId, fromPath });
  useChatPageEffects(data);
  return data;
}
