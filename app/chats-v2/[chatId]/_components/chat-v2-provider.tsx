import { createContext, useCallback, useContext, useMemo, type ReactNode } from 'react';
import { useNavigate } from 'react-router';

import { useChatPageData, type ChatPageData } from '@/app/chats/[chatId]/_hooks/use-chat-page-data';
import { useChatPageEffects } from '@/app/chats/[chatId]/_hooks/use-chat-page-effects';
import type { Chat } from '@/app/chats/[chatId]/_lib/types';

type ChatV2PageProviderProps = {
  chatId?: string;
  initialChat?: Chat | null;
  children: ReactNode;
};

const ChatV2PageContext = createContext<ChatPageData | null>(null);

export function ChatV2PageProvider({ chatId, initialChat, children }: ChatV2PageProviderProps) {
  const navigate = useNavigate();
  const data = useChatPageData({ chatId, initialChat });

  // Override goBack to navigate to /v2 instead of /
  const goBackV2 = useCallback(() => {
    navigate('/v2');
  }, [navigate]);

  // Create a merged data object with overridden goBack
  const v2Data = useMemo(
    () => ({ ...data, goBack: goBackV2 }),
    [data, goBackV2],
  );

  useChatPageEffects(v2Data);

  return <ChatV2PageContext.Provider value={v2Data}>{children}</ChatV2PageContext.Provider>;
}

export function useChatV2PageContext() {
  const context = useContext(ChatV2PageContext);
  if (!context) {
    throw new Error('useChatV2PageContext must be used within ChatV2PageProvider');
  }
  return context;
}
