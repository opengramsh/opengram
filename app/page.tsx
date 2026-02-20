'use client';

import { useCallback, useEffect, useState } from 'react';

import { sortInboxChats } from '@/src/lib/inbox';
import { ChatListPage } from '@/src/components/chats/chat-list-page';
import type { Chat } from '@/src/components/chats/types';
import { useChatList } from '@/src/components/chats/use-chat-list';
import { subscribeToEventsStream, type FrontendStreamEvent } from '@/src/lib/events-stream';

function pendingLabel(total: number) {
  return total === 1 ? '1 pending request' : `${total} pending requests`;
}

export default function Home() {
  const [pendingRequestsTotal, setPendingRequestsTotal] = useState(0);

  const loadPendingSummary = useCallback(async () => {
    const response = await fetch('/api/v1/chats/pending-summary?archived=false', { cache: 'no-store' });
    if (!response.ok) {
      throw new Error(`Pending summary request failed with status ${response.status}`);
    }

    const payload = (await response.json()) as { pending_requests_total?: number };
    setPendingRequestsTotal(Math.max(0, payload.pending_requests_total ?? 0));
  }, []);

  const chatList = useChatList({
    archived: false,
    chatsErrorMessage: 'Failed to load inbox data.',
    onRefreshExtras: loadPendingSummary,
    onMutationSuccess: loadPendingSummary,
  });

  const { setChats, loadChats, refreshChats, matchesActiveFilters } = chatList;

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial data load, not a cascading render
    loadPendingSummary().catch(() => setPendingRequestsTotal(0));
  }, [loadPendingSummary]);

  const refreshSingleInboxChat = useCallback(
    async (incomingChatId: string) => {
      const response = await fetch(`/api/v1/chats/${incomingChatId}`, { cache: 'no-store' });
      if (!response.ok) {
        throw new Error('Failed to load changed chat');
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
    const unsubscribe = subscribeToEventsStream((event: FrontendStreamEvent) => {
      const chatIdFromEvent = typeof event.payload.chatId === 'string' ? event.payload.chatId : null;
      const refreshesPendingSummary = (
        event.type === 'request.created'
        || event.type === 'request.resolved'
        || event.type === 'request.cancelled'
      );

      if (
        event.type === 'chat.created'
        || event.type === 'chat.updated'
        || event.type === 'chat.unarchived'
        || event.type === 'chat.read'
        || event.type === 'chat.unread'
        || event.type === 'message.created'
        || event.type === 'message.streaming.complete'
        || event.type === 'request.created'
        || event.type === 'request.resolved'
        || event.type === 'request.cancelled'
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
          ]);
          return;
        }

        void refreshSingleInboxChat(chatIdFromEvent).catch(() => {
          void loadChats();
        });
        return;
      }

      if (event.type === 'chat.archived') {
        if (!chatIdFromEvent) {
          void refreshChats();
          return;
        }

        setChats((current) => current.filter((chat) => chat.id !== chatIdFromEvent));
        void loadPendingSummary().catch(() => setPendingRequestsTotal(0));
      }
    });

    return () => {
      unsubscribe();
    };
  }, [loadChats, loadPendingSummary, refreshChats, refreshSingleInboxChat, setChats]);

  return (
    <ChatListPage
      chatList={chatList}
      headerContent={
        <>
          <div className="flex items-center justify-center gap-1.5">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/opengram-logo.png" alt="" width={20} height={20} className="shrink-0" />
            <h1 className="text-sm font-semibold tracking-wide text-foreground">{chatList.appName}</h1>
          </div>
          <p className="text-xs text-muted-foreground">{pendingLabel(pendingRequestsTotal)}</p>
        </>
      }
      emptyLabel="No chats match the current filters."
      rowActionLabel="Archive"
      searchPlaceholder="Search chats"
    />
  );
}
