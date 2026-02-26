import { useLocation, useParams } from 'react-router';

import { ChatV2PageProvider } from '@/app/chats-v2/[chatId]/_components/chat-v2-provider';
import { ChatV2PageSections } from '@/app/chats-v2/[chatId]/_components/chat-v2-sections';
import type { Chat } from '@/app/chats/[chatId]/_lib/types';

type ChatLocationState = {
  chat?: Partial<Chat> & { id: string };
};

function normalizeInitialChat(raw: ChatLocationState['chat'], expectedChatId?: string): Chat | null {
  if (!raw || !expectedChatId || raw.id !== expectedChatId) return null;
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

export default function ChatV2Page() {
  const { chatId } = useParams<{ chatId: string }>();
  const location = useLocation();
  const initialChat = normalizeInitialChat((location.state as ChatLocationState | null)?.chat, chatId);

  return (
    <ChatV2PageProvider key={chatId} chatId={chatId} initialChat={initialChat}>
      <div className="flex h-[100dvh] w-full flex-col bg-background">
        <ChatV2PageSections />
      </div>
    </ChatV2PageProvider>
  );
}
