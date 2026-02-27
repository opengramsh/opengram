import { createContext, useContext, type ReactNode } from 'react';

import { useChatV2Data, type ChatV2DataReturn } from '../_hooks/use-chat-v2-data';
import { useChatV2Send, type ChatV2SendReturn } from '../_hooks/use-chat-v2-send';
import { useChatV2Attachments, type ChatV2AttachmentsReturn } from '../_hooks/use-chat-v2-attachments';
import { useChatV2Requests, type ChatV2RequestsReturn } from '../_hooks/use-chat-v2-requests';
import type { Chat } from '../_lib/types';

export type ChatV2ContextValue = {
  data: ChatV2DataReturn;
  send: ChatV2SendReturn;
  attachments: ChatV2AttachmentsReturn;
  requests: ChatV2RequestsReturn;
};

const ChatV2Context = createContext<ChatV2ContextValue | null>(null);

type ChatV2PageProviderProps = {
  chatId?: string;
  initialChat?: Chat | null;
  children: ReactNode;
};

export function ChatV2PageProvider({ chatId, initialChat, children }: ChatV2PageProviderProps) {
  const safeChatId = chatId ?? '';
  const data = useChatV2Data({ chatId, initialChat });
  const attachments = useChatV2Attachments(safeChatId);
  const send = useChatV2Send({
    chatId: safeChatId,
    pendingAttachmentIds: attachments.readyIds,
    onSendStart: () => data.setPendingReply(true),
    onSendComplete: () => data.scrollToBottom(true),
    clearAttachments: attachments.clearAll,
  });
  const requests = useChatV2Requests({
    pendingRequests: data.pendingRequests,
    setPendingRequests: data.setPendingRequests,
    setChat: data.setChat,
    setError: data.setError,
    refreshPendingRequests: data.refreshPendingRequests,
  });

  return (
    <ChatV2Context.Provider value={{ data, send, attachments, requests }}>
      {children}
    </ChatV2Context.Provider>
  );
}

export function useChatV2Context() {
  const ctx = useContext(ChatV2Context);
  if (!ctx) throw new Error('useChatV2Context must be inside ChatV2PageProvider');
  return ctx;
}
