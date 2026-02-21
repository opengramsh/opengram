import { ChatListPage } from '@/src/components/chats/chat-list-page';
import { useChatList } from '@/src/components/chats/use-chat-list';

export default function ArchivedPage() {
  const chatList = useChatList({
    archived: true,
    chatsErrorMessage: 'Failed to load archived chats.',
  });

  return (
    <ChatListPage
      chatList={chatList}
      headerContent={
        <>
          <h1 className="text-sm font-semibold tracking-wide text-foreground">Archived chats</h1>
          <p className="text-xs text-muted-foreground">{chatList.appName}</p>
        </>
      }
      emptyLabel="No archived chats match the current filters."
      rowActionLabel="Unarchive"
      searchPlaceholder="Search archived chats"
    />
  );
}
