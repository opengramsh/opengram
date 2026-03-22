import { useLocation, useParams } from 'react-router';

import { ChatPageProvider } from '@/app/chats/[chatId]/_components/chat-page-provider';
import { ChatPageSections } from '@/app/chats/[chatId]/_components/chat-page-sections';
import type { Chat } from '@/app/chats/[chatId]/_lib/types';

type ChatLocationState = {
  chat?: Partial<Chat> & { id: string };
  scrollToMessageId?: string;
  fromPath?: string;
};

function normalizeInitialChat(raw: ChatLocationState['chat'], expectedChatId?: string): Chat | null {
  if (!raw || !expectedChatId || raw.id !== expectedChatId) {
    return null;
  }

  return {
    id: raw.id,
    title: raw.title ?? 'Chat',
    title_source: raw.title_source ?? 'default',
    tags: raw.tags ?? [],
    model_id: raw.model_id ?? '',
    pinned: raw.pinned ?? false,
    is_archived: raw.is_archived ?? false,
    last_read_at: raw.last_read_at ?? null,
    unread_count: raw.unread_count ?? 0,
    notifications_muted: raw.notifications_muted ?? false,
    agent_ids: raw.agent_ids ?? [],
    pending_requests_count: raw.pending_requests_count ?? 0,
  };
}

export default function ChatPage() {
  const { chatId } = useParams<{ chatId: string }>();
  const location = useLocation();
  const locationState = location.state as ChatLocationState | null;
  const initialChat = normalizeInitialChat(locationState?.chat, chatId);
  const scrollToMessageId = locationState?.scrollToMessageId;
  const fromPath = locationState?.fromPath;

  return (
    <ChatPageProvider key={chatId} chatId={chatId} initialChat={initialChat} scrollToMessageId={scrollToMessageId} fromPath={fromPath}>
      <div
        className="flex min-h-0 w-full flex-col overflow-hidden bg-background"
        style={{ height: 'calc(100dvh - var(--keyboard-offset, 0px))' }}
      >
        <ChatPageSections />
      </div>
    </ChatPageProvider>
  );
}
