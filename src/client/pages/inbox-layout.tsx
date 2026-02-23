import { useCallback, useEffect, useState } from "react";
import { Outlet, useMatch } from "react-router";

import logoSm from "/opengram-logo-sm.webp";
import { sortInboxChats } from "@/src/lib/inbox";
import { ChatListPage } from "@/src/components/chats/chat-list-page";
import type { Chat } from "@/src/components/chats/types";
import { useChatList } from "@/src/components/chats/use-chat-list";
import {
  subscribeToEventsStream,
  type FrontendStreamEvent,
} from "@/src/lib/events-stream";
import { cn } from "@/src/lib/utils";

function pendingLabel(total: number) {
  return total === 1 ? "1 pending request" : `${total} pending requests`;
}

type UnreadSummaryPayload = {
  total_unread?: number;
  unread_by_agent?: Record<string, number>;
};

export default function InboxLayout() {
  const [pendingRequestsTotal, setPendingRequestsTotal] = useState(0);
  const [totalUnread, setTotalUnread] = useState(0);
  const [unreadByAgent, setUnreadByAgent] = useState<Record<string, number>>({});
  const [streamingChatIds, setStreamingChatIds] = useState<Set<string>>(new Set());
  const isChatSelected = !useMatch("/");
  const chatMatch = useMatch("/chats/:chatId");
  const activeChatId = chatMatch?.params.chatId;

  const loadPendingSummary = useCallback(async () => {
    const response = await fetch(
      "/api/v1/chats/pending-summary?archived=false",
      { cache: "no-store" },
    );
    if (!response.ok) {
      throw new Error(
        `Pending summary request failed with status ${response.status}`,
      );
    }

    const payload = (await response.json()) as {
      pending_requests_total?: number;
    };
    setPendingRequestsTotal(Math.max(0, payload.pending_requests_total ?? 0));
  }, []);

  const loadUnreadSummary = useCallback(async () => {
    const response = await fetch(
      "/api/v1/chats/unread-summary?archived=false",
      { cache: "no-store" },
    );
    if (!response.ok) {
      throw new Error(
        `Unread summary request failed with status ${response.status}`,
      );
    }

    const payload = (await response.json()) as UnreadSummaryPayload;
    setTotalUnread(Math.max(0, payload.total_unread ?? 0));
    setUnreadByAgent(payload.unread_by_agent ?? {});
  }, []);

  const loadExtras = useCallback(async () => {
    await Promise.all([loadPendingSummary(), loadUnreadSummary()]);
  }, [loadPendingSummary, loadUnreadSummary]);

  const chatList = useChatList({
    archived: false,
    chatsErrorMessage: "Failed to load inbox data.",
    onRefreshExtras: loadExtras,
    onMutationSuccess: loadExtras,
  });

  const { setChats, loadChats, refreshChats, matchesActiveFilters } = chatList;

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadPendingSummary().catch(() => setPendingRequestsTotal(0));
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadUnreadSummary().catch(() => { setTotalUnread(0); setUnreadByAgent({}); });
  }, [loadPendingSummary, loadUnreadSummary]);

  const refreshSingleInboxChat = useCallback(
    async (incomingChatId: string) => {
      const response = await fetch(`/api/v1/chats/${incomingChatId}`, {
        cache: "no-store",
      });
      if (!response.ok) {
        throw new Error("Failed to load changed chat");
      }

      const updated = (await response.json()) as Chat;
      setChats((current) => {
        const withoutChat = current.filter((chat) => chat.id !== updated.id);

        if (!matchesActiveFilters(updated)) {
          return withoutChat;
        }

        return sortInboxChats([...withoutChat, updated]);
      });
    },
    [matchesActiveFilters, setChats],
  );

  useEffect(() => {
    const unsubscribe = subscribeToEventsStream(
      (event: FrontendStreamEvent) => {
        const chatIdFromEvent =
          typeof event.payload.chatId === "string"
            ? event.payload.chatId
            : null;
        const refreshesPendingSummary =
          event.type === "request.created" ||
          event.type === "request.resolved" ||
          event.type === "request.cancelled";

        if (event.type === "message.created" && chatIdFromEvent) {
          if (event.payload.role === "user") {
            // User sent a message → agent reply is expected; show typing immediately (mirrors pendingReply in chat header).
            setStreamingChatIds((prev) => { const next = new Set(prev); next.add(chatIdFromEvent); return next; });
          } else if (event.payload.streamState !== "streaming") {
            // Non-streaming agent/system message arrived → no pending reply for this chat.
            setStreamingChatIds((prev) => { if (!prev.has(chatIdFromEvent)) return prev; const next = new Set(prev); next.delete(chatIdFromEvent); return next; });
          }
        }
        if (event.type === "message.streaming.complete" && chatIdFromEvent) {
          setStreamingChatIds((prev) => { if (!prev.has(chatIdFromEvent)) return prev; const next = new Set(prev); next.delete(chatIdFromEvent); return next; });
        }

        if (
          event.type === "chat.created" ||
          event.type === "chat.updated" ||
          event.type === "chat.unarchived" ||
          event.type === "chat.read" ||
          event.type === "chat.unread" ||
          event.type === "message.created" ||
          event.type === "message.streaming.complete" ||
          event.type === "request.created" ||
          event.type === "request.resolved" ||
          event.type === "request.cancelled"
        ) {
          if (!chatIdFromEvent) {
            if (refreshesPendingSummary) {
              void refreshChats();
              return;
            }

            void loadChats();
            return;
          }

          if (refreshesPendingSummary) {
            void Promise.all([
              refreshSingleInboxChat(chatIdFromEvent).catch(loadChats),
              loadPendingSummary().catch(() => setPendingRequestsTotal(0)),
              loadUnreadSummary().catch(() => { setTotalUnread(0); setUnreadByAgent({}); }),
            ]);
            return;
          }

          void Promise.all([
            refreshSingleInboxChat(chatIdFromEvent).catch(() => { void loadChats(); }),
            loadUnreadSummary().catch(() => { setTotalUnread(0); setUnreadByAgent({}); }),
          ]);
          return;
        }

        if (event.type === "chat.archived") {
          if (!chatIdFromEvent) {
            void refreshChats();
            return;
          }

          setChats((current) =>
            current.filter((chat) => chat.id !== chatIdFromEvent),
          );
          void Promise.all([
            loadPendingSummary().catch(() => setPendingRequestsTotal(0)),
            loadUnreadSummary().catch(() => { setTotalUnread(0); setUnreadByAgent({}); }),
          ]);
        }
      },
    );

    return () => {
      unsubscribe();
    };
  }, [
    loadChats,
    loadPendingSummary,
    loadUnreadSummary,
    refreshChats,
    refreshSingleInboxChat,
    setChats,
  ]);

  return (
    <div className="flex h-[100dvh] w-full bg-background">
      {/* Left sidebar: always visible on md+, only visible on mobile when no chat is selected */}
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
          streamingChatIds={streamingChatIds}
          totalUnread={totalUnread}
          unreadByAgent={unreadByAgent}
          headerContent={
            <div className="flex items-center justify-center gap-3">
              <img src={logoSm} alt="" className="h-10 w-10 shrink-0" />
              <div className="flex flex-col items-start">
                <h1 className="text-sm font-semibold tracking-wide text-foreground leading-tight">
                  {chatList.appName}
                </h1>
                <p className="text-xs text-muted-foreground leading-tight">
                  {pendingLabel(pendingRequestsTotal)}
                </p>
              </div>
            </div>
          }
          emptyLabel="No chats match the current filters."
          rowActionLabel="Archive"
          searchPlaceholder="Search chats"
          sidebarMode
        />
      </div>

      {/* Right panel: active chat or empty state placeholder.
          transform: translateZ(0) creates a new containing block so that
          position:fixed children (composer, request widget) are scoped to this
          panel instead of the full viewport. */}
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
            Select a chat to get started
          </p>
        )}
      </div>
    </div>
  );
}
