import { useEffect, useRef, useState } from 'react';

import { sortInboxChats } from '@/src/lib/inbox';
import { isSoundEnabled } from '@/src/lib/notification-preferences';
import { playNotificationSound } from '@/src/lib/notification-sound';
import {
  subscribeToEventsStream,
  type FrontendStreamEvent,
} from '@/src/lib/events-stream';
import type { Chat } from '@/src/components/chats/types';

type UseInboxV2SseOptions = {
  chatsRef: React.RefObject<Chat[]>;
  loadChats: () => void;
  refreshChats: () => void;
  loadUnreadSummary: () => Promise<void>;
  refreshSingleInboxChat: (chatId: string) => Promise<void>;
  setChats: React.Dispatch<React.SetStateAction<Chat[]>>;
  setTotalUnread: React.Dispatch<React.SetStateAction<number>>;
  setUnreadByAgent: React.Dispatch<React.SetStateAction<Record<string, number>>>;
};

/**
 * Manages the SSE subscription for the v2 inbox:
 * - Typing / streaming indicators per chat
 * - Real-time chat-list refreshes on message/request/chat events
 * - Notification sounds
 *
 * Returns `streamingChatIds` — the set of chat IDs where an agent is currently typing.
 */
export function useInboxV2Sse({
  chatsRef,
  loadChats,
  refreshChats,
  loadUnreadSummary,
  refreshSingleInboxChat,
  setChats,
  setTotalUnread,
  setUnreadByAgent,
}: UseInboxV2SseOptions): Set<string> {
  const [streamingChatIds, setStreamingChatIds] = useState<Set<string>>(new Set());
  const typingTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const clearTypingFor = (chatId: string) => {
    const timer = typingTimersRef.current.get(chatId);
    if (timer) {
      clearTimeout(timer);
      typingTimersRef.current.delete(chatId);
    }
    setStreamingChatIds((prev) => {
      if (!prev.has(chatId)) return prev;
      const next = new Set(prev);
      next.delete(chatId);
      return next;
    });
  };

  useEffect(() => {
    const unsubscribe = subscribeToEventsStream((event: FrontendStreamEvent) => {
      const chatId = typeof event.payload.chatId === 'string' ? event.payload.chatId : null;
      const refreshesPendingSummary =
        event.type === 'request.created' ||
        event.type === 'request.resolved' ||
        event.type === 'request.cancelled';

      // ── Typing indicator ──────────────────────────────────────────────────
      if (event.type === 'chat.typing' && chatId) {
        setStreamingChatIds((prev) => new Set(prev).add(chatId));
        const existing = typingTimersRef.current.get(chatId);
        if (existing) clearTimeout(existing);
        typingTimersRef.current.set(
          chatId,
          setTimeout(() => clearTypingFor(chatId), 12_000),
        );
      }

      if (
        event.type === 'message.created' &&
        chatId &&
        event.payload.role !== 'user' &&
        event.payload.streamState !== 'streaming'
      ) {
        clearTypingFor(chatId);
      }

      if (event.type === 'message.streaming.complete' && chatId) {
        clearTypingFor(chatId);
      }

      // ── Notification sound ────────────────────────────────────────────────
      if (
        (event.type === 'message.created' || event.type === 'message.streaming.complete') &&
        chatId &&
        event.payload.role !== 'user' &&
        event.payload.streamState !== 'streaming'
      ) {
        const chat = chatsRef.current.find((c) => c.id === chatId);
        if (!chat?.notifications_muted && isSoundEnabled()) {
          playNotificationSound();
        }
      }

      // ── Chat list updates ─────────────────────────────────────────────────
      const isStreamingStart =
        event.type === 'message.created' && event.payload.streamState === 'streaming';
      const isUserMessage =
        event.type === 'message.created' && event.payload.role === 'user';

      if (isUserMessage && chatId) {
        // Optimistically update last message preview without a network fetch
        const content =
          typeof event.payload.contentFinal === 'string' ? event.payload.contentFinal : null;
        const preview = content ? content.trim().slice(0, 180) : null;
        const createdAt =
          typeof event.payload.createdAt === 'string' ? event.payload.createdAt : null;
        setChats((current) =>
          sortInboxChats(
            current.map((c) =>
              c.id === chatId
                ? {
                    ...c,
                    ...(preview != null && { last_message_preview: preview }),
                    last_message_role: 'user' as const,
                    ...(createdAt != null && { last_message_at: createdAt }),
                  }
                : c,
            ),
          ),
        );
        return;
      }

      if (
        !isStreamingStart &&
        !isUserMessage &&
        (event.type === 'chat.created' ||
          event.type === 'chat.updated' ||
          event.type === 'chat.unarchived' ||
          event.type === 'chat.read' ||
          event.type === 'chat.unread' ||
          event.type === 'message.created' ||
          event.type === 'message.streaming.complete' ||
          event.type === 'request.created' ||
          event.type === 'request.resolved' ||
          event.type === 'request.cancelled')
      ) {
        if (!chatId) {
          void (refreshesPendingSummary ? refreshChats() : loadChats());
          return;
        }
        void Promise.all([
          refreshSingleInboxChat(chatId).catch(() => void loadChats()),
          loadUnreadSummary().catch(() => {
            setTotalUnread(0);
            setUnreadByAgent({});
          }),
        ]);
        return;
      }

      if (event.type === 'chat.archived') {
        if (!chatId) {
          void refreshChats();
          return;
        }
        setChats((current) => current.filter((c) => c.id !== chatId));
        void loadUnreadSummary().catch(() => {
          setTotalUnread(0);
          setUnreadByAgent({});
        });
      }
    });

    return () => {
      unsubscribe();
      for (const timer of typingTimersRef.current.values()) clearTimeout(timer);
      typingTimersRef.current.clear();
    };
  }, [
    chatsRef,
    loadChats,
    loadUnreadSummary,
    refreshChats,
    refreshSingleInboxChat,
    setChats,
    setTotalUnread,
    setUnreadByAgent,
  ]);

  return streamingChatIds;
}
