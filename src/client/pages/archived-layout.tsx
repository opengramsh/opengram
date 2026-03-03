import { Outlet, useMatch } from "react-router";

import { ChatListPage } from "@/src/components/chats/chat-list-page";
import { useChatList } from "@/src/components/chats/use-chat-list";
import { cn } from "@/src/lib/utils";

export default function ArchivedLayout() {
  const chatList = useChatList({
    archived: true,
    chatsErrorMessage: "Failed to load archived chats.",
  });

  const isChatSelected = !useMatch("/archived");
  const chatMatch = useMatch("/archived/chats/:chatId");
  const activeChatId = chatMatch?.params.chatId;

  return (
    <div className="flex h-[100dvh] w-full overflow-hidden bg-background">
      <div
        className={cn(
          "flex flex-col border-r border-border/70",
          "w-full md:w-[380px] md:min-w-[380px]",
          isChatSelected ? "hidden md:flex" : "flex",
        )}
      >
        <ChatListPage
          chatList={chatList}
          activeChatId={activeChatId}
          chatPathPrefix="/archived"
          headerContent={
            <>
              <h1 className="text-sm font-semibold tracking-wide text-foreground">
                Archived chats
              </h1>
              <p className="text-xs text-muted-foreground">
                {chatList.appName}
              </p>
            </>
          }
          emptyLabel="No archived chats match the current filters."
          rowActionLabel="Unarchive"
          searchPlaceholder="Search archived chats"
          sidebarMode
        />
      </div>

      <div
        className={cn(
          "flex-1 min-w-0",
          isChatSelected
            ? "flex"
            : "hidden md:flex md:items-center md:justify-center",
        )}
        style={{ transform: "translateZ(0)" }}
      >
        <Outlet />
        {!isChatSelected && (
          <p className="text-sm text-muted-foreground">
            Select a chat to view
          </p>
        )}
      </div>
    </div>
  );
}
