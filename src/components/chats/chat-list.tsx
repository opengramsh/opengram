
import { useCallback, useEffect, useState, useRef } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { Facehash } from 'facehash';
import { Pin } from 'lucide-react';

import { formatInboxTimestamp, resolveInboxSwipeEnd, shouldStartInboxSwipeDrag } from '@/src/lib/inbox';
import type { Agent, Chat } from '@/src/components/chats/types';
import { Badge } from '@/src/components/ui/badge';
import { Button } from '@/src/components/ui/button';

type ContextMenuState = {
  chatId: string;
  x: number;
  y: number;
};

type ChatListProps = {
  chats: Chat[];
  agentsById: Map<string, Agent>;
  loading: boolean;
  error: string | null;
  emptyLabel: string;
  onOpenChat: (chat: Chat) => void;
  onMarkRead: (chat: Chat) => Promise<void>;
  onMarkUnread: (chat: Chat) => Promise<void>;
  onTogglePin: (chat: Chat) => Promise<void>;
  onToggleArchive: (chat: Chat) => Promise<void>;
  rowActionLabel: 'Archive' | 'Unarchive';
};

export function ChatList({
  chats,
  agentsById,
  loading,
  error,
  emptyLabel,
  onOpenChat,
  onMarkRead,
  onMarkUnread,
  onTogglePin,
  onToggleArchive,
  rowActionLabel,
}: ChatListProps) {
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);

  useEffect(() => {
    function closeMenu() {
      setContextMenu(null);
    }

    window.addEventListener('pointerdown', closeMenu);
    window.addEventListener('scroll', closeMenu, true);
    return () => {
      window.removeEventListener('pointerdown', closeMenu);
      window.removeEventListener('scroll', closeMenu, true);
    };
  }, []);

  const chatForMenu = contextMenu ? chats.find((chat) => chat.id === contextMenu.chatId) : undefined;

  return (
    <>
      <main className="flex-1 overflow-y-auto px-2 py-2">
        {loading && <p className="px-4 py-6 text-sm text-muted-foreground">Loading chats...</p>}
        {!loading && error && <p className="px-4 py-6 text-sm text-red-300">{error}</p>}
        {!loading && !error && chats.length === 0 && <p className="px-4 py-8 text-sm text-muted-foreground">{emptyLabel}</p>}
        {!loading &&
          !error &&
          chats.map((chat) => {
            const firstAgentId = chat.agent_ids[0];
            const agent = firstAgentId ? agentsById.get(firstAgentId) : undefined;
            return (
              <ChatRow
                key={chat.id}
                chat={chat}
                agentName={agent?.name ?? 'Unknown Agent'}
                actionLabel={rowActionLabel}
                onOpen={() => onOpenChat(chat)}
                onAction={() => {
                  void onToggleArchive(chat);
                }}
                onLongPress={(point) => setContextMenu({ chatId: chat.id, ...point })}
              />
            );
          })}
      </main>

      {contextMenu && chatForMenu && (
        <div
          className="fixed z-40 min-w-48 rounded-2xl border border-border bg-card p-1 shadow-2xl shadow-black/40"
          style={{
            top: Math.min(contextMenu.y, window.innerHeight - 180),
            left: Math.min(contextMenu.x, window.innerWidth - 220),
          }}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <Button
            variant="ghost"
            className="w-full justify-start px-3 py-2 text-sm"
            onClick={() => {
              setContextMenu(null);
              if (chatForMenu.unread_count > 0) {
                void onMarkRead(chatForMenu);
              } else {
                void onMarkUnread(chatForMenu);
              }
            }}
          >
            {chatForMenu.unread_count > 0 ? 'Mark as read' : 'Mark as unread'}
          </Button>
          <Button
            variant="ghost"
            className="w-full justify-start px-3 py-2 text-sm"
            onClick={() => {
              setContextMenu(null);
              void onTogglePin(chatForMenu);
            }}
          >
            {chatForMenu.pinned ? 'Unpin' : 'Pin'}
          </Button>
          <Button
            variant="ghost"
            className="w-full justify-start px-3 py-2 text-sm"
            onClick={() => {
              setContextMenu(null);
              void onToggleArchive(chatForMenu);
            }}
          >
            {chatForMenu.is_archived ? 'Unarchive' : 'Archive'}
          </Button>
        </div>
      )}
    </>
  );
}

type ChatRowProps = {
  chat: Chat;
  agentName: string;
  actionLabel: 'Archive' | 'Unarchive';
  onOpen: () => void;
  onAction: () => void;
  onLongPress: (point: { x: number; y: number }) => void;
};

function ChatRow({ chat, agentName, actionLabel, onOpen, onAction, onLongPress }: ChatRowProps) {
  const [offsetX, setOffsetX] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const dragStartXRef = useRef(0);
  const dragStartYRef = useRef(0);
  const dragBaseOffsetRef = useRef(0);
  const pointerIdRef = useRef<number | null>(null);
  const longPressTimerRef = useRef<number | null>(null);
  const longPressTriggeredRef = useRef(false);

  const clearLongPressTimer = useCallback(() => {
    if (longPressTimerRef.current !== null) {
      window.clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  }, []);

  const handlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>) => {
      if (event.pointerType === 'mouse' && event.button !== 0) {
        return;
      }

      pointerIdRef.current = event.pointerId;
      dragStartXRef.current = event.clientX;
      dragStartYRef.current = event.clientY;
      dragBaseOffsetRef.current = offsetX;
      setIsDragging(false);
      longPressTriggeredRef.current = false;
      if (typeof event.currentTarget.setPointerCapture === 'function') {
        event.currentTarget.setPointerCapture(event.pointerId);
      }
      clearLongPressTimer();
      longPressTimerRef.current = window.setTimeout(() => {
        if (!isDragging) {
          longPressTriggeredRef.current = true;
          onLongPress({ x: event.clientX, y: event.clientY });
        }
      }, 520);
    },
    [clearLongPressTimer, isDragging, offsetX, onLongPress],
  );

  const handlePointerMove = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>) => {
      if (pointerIdRef.current !== event.pointerId) {
        return;
      }

      const deltaX = event.clientX - dragStartXRef.current;
      const deltaY = event.clientY - dragStartYRef.current;
      if (!isDragging) {
        if (!shouldStartInboxSwipeDrag(deltaX, deltaY, dragBaseOffsetRef.current)) {
          clearLongPressTimer();
          return;
        }

        setIsDragging(true);
        clearLongPressTimer();
      }

      const next = Math.max(-200, Math.min(0, dragBaseOffsetRef.current + deltaX));
      setOffsetX(next);
    },
    [clearLongPressTimer, isDragging],
  );

  const handlePointerEnd = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>) => {
      if (pointerIdRef.current !== event.pointerId) {
        return;
      }

      pointerIdRef.current = null;
      clearLongPressTimer();
      const swipeEnd = resolveInboxSwipeEnd(offsetX, isDragging);
      setOffsetX(swipeEnd.nextOffset);
      if (isDragging) {
        setIsDragging(false);
      }
      if (swipeEnd.shouldArchive) {
        onAction();
        return;
      }

      if (!isDragging && !longPressTriggeredRef.current) {
        if (offsetX < 0) {
          setOffsetX(0);
          return;
        }

        onOpen();
      }
    },
    [clearLongPressTimer, isDragging, offsetX, onAction, onOpen],
  );

  useEffect(() => {
    return () => {
      clearLongPressTimer();
    };
  }, [clearLongPressTimer]);

  const handleKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLButtonElement>) => {
      if (event.defaultPrevented) {
        return;
      }

      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        if (offsetX < 0) {
          setOffsetX(0);
          return;
        }

        onOpen();
        return;
      }

      if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault();
        onAction();
      }
    },
    [offsetX, onAction, onOpen],
  );

  const unread = chat.unread_count > 0;
  const unreadBadge =
    chat.unread_count > 1 ? (
      <Badge className="text-[10px]">
        {chat.unread_count}
      </Badge>
    ) : chat.unread_count === 1 ? (
      <span className="h-2.5 w-2.5 rounded-full bg-primary" />
    ) : null;
  const pendingBadge = chat.pending_requests_count > 0
    ? (
      <Badge
        variant="amber"
        aria-label={`${chat.pending_requests_count} pending requests`}
        className="text-[10px]"
      >
        {chat.pending_requests_count}
      </Badge>
    )
    : null;

  return (
    <div className="relative mb-2 overflow-hidden rounded-2xl">
      <button
        type="button"
        className="absolute inset-y-1 right-1 z-0 rounded-xl bg-red-500/90 px-4 text-xs font-semibold text-white"
        onClick={onAction}
      >
        {actionLabel}
      </button>
      <button
        type="button"
        className="relative z-10 flex w-full cursor-default items-center gap-3 rounded-2xl border border-border/80 bg-card px-3 py-3 text-left transition-transform duration-150"
        style={{ transform: `translateX(${offsetX}px)` }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerEnd}
        onPointerCancel={handlePointerEnd}
        onKeyDown={handleKeyDown}
        onContextMenu={(event) => {
          event.preventDefault();
          onLongPress({ x: event.clientX, y: event.clientY });
        }}
      >
        <div className="shrink-0">
          <Facehash name={agentName} size={44} interactive={false} className="rounded-xl text-black" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p
                className={`line-clamp-2 text-sm leading-5 ${unread ? 'font-semibold text-foreground' : 'font-medium text-foreground'}`}
              >
                {chat.title}
              </p>
              <p className="truncate text-[11px] font-semibold tracking-wide text-primary/60">{agentName}</p>
            </div>
            <div className="flex flex-col items-end gap-1 pt-0.5">
              <p className="text-[11px] text-muted-foreground">{formatInboxTimestamp(chat.last_message_at)}</p>
              {chat.pinned && <Pin size={11} className="text-primary" />}
            </div>
          </div>
          <div className="mt-1 flex items-center justify-between gap-2">
            <p className="truncate text-xs font-normal text-muted-foreground/70">
              {chat.last_message_preview?.trim() || 'No messages yet'}
            </p>
            <div className="flex items-center gap-1.5">
              {pendingBadge}
              {unreadBadge}
            </div>
          </div>
        </div>
      </button>
    </div>
  );
}
