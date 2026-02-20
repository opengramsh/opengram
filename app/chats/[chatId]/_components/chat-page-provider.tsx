'use client';

import { createContext, useContext, type ReactNode } from 'react';

import { useChatPageController } from '@/app/chats/[chatId]/_hooks/use-chat-page-controller';
import type { ChatPageData } from '@/app/chats/[chatId]/_hooks/use-chat-page-data';

type ChatPageProviderProps = {
  chatId?: string;
  children: ReactNode;
};

const ChatPageContext = createContext<ChatPageData | null>(null);

export function ChatPageProvider({ chatId, children }: ChatPageProviderProps) {
  const controller = useChatPageController(chatId);

  return <ChatPageContext.Provider value={controller}>{children}</ChatPageContext.Provider>;
}

export function useChatPageContext() {
  const context = useContext(ChatPageContext);
  if (!context) {
    throw new Error('useChatPageContext must be used within ChatPageProvider');
  }
  return context;
}
