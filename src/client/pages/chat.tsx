import { useParams } from 'react-router';

import { ChatPageProvider } from '@/app/chats/[chatId]/_components/chat-page-provider';
import { ChatPageSections } from '@/app/chats/[chatId]/_components/chat-page-sections';

export default function ChatPage() {
  const { chatId } = useParams<{ chatId: string }>();

  return (
    <ChatPageProvider chatId={chatId}>
      <div className="flex min-h-[100dvh] w-full flex-col bg-background">
        <ChatPageSections />
      </div>
    </ChatPageProvider>
  );
}
