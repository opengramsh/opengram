
import { useCallback, useEffect, useState, useRef } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { Facehash } from 'facehash';
import { Archive, Inbox, Mail, MailOpen, Pin, PinOff } from 'lucide-react';

import { formatInboxTimestamp, resolveInboxSwipeEnd, shouldStartInboxSwipeDrag } from '@/src/lib/inbox';
import type { Agent, Chat } from '@/src/components/chats/types';
import { FACEHASH_COLORS } from '@/src/lib/utils';
import { Badge } from '@/src/components/ui/badge';
import { Button } from '@/src/components/ui/button';
import { UnreadBadge } from '@/src/components/chats/unread-badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/src/components/ui/dropdown-menu';
import { cn } from '@/src/lib/utils';

function Spinner() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 14 14"
      fill="none"
      style={{ animation: 'spin 0.8s linear infinite' }}
    >
      <circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeWidth="2" opacity="0.25" />
      <path d="M12.5 7a5.5 5.5 0 0 0-5.5-5.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

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
  activeChatId?: string;
  streamingChatIds?: Set<string>;
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
  activeChatId,
  streamingChatIds,
}: ChatListProps) {
  const [activeContextChatId, setActiveContextChatId] = useState<string | null>(null);

  return (
    <main className="flex-1 overflow-y-auto px-2 pt-2" style={{ paddingBottom: 'calc(8px + env(safe-area-inset-bottom, 0px))' }}>
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
              agentName={agent?.name ?? chat.title}
              actionLabel={rowActionLabel}
              isActive={activeChatId === chat.id}
              isStreaming={streamingChatIds?.has(chat.id) ?? false}
              isContextMenuOpen={activeContextChatId === chat.id}
              onOpen={() => onOpenChat(chat)}
              onAction={() => void onToggleArchive(chat)}
              onLongPress={() => setActiveContextChatId(chat.id)}
              onContextMenuOpenChange={(open) => setActiveContextChatId(open ? chat.id : null)}
              onMarkReadToggle={() => {
                if (chat.unread_count > 0) void onMarkRead(chat);
                else void onMarkUnread(chat);
              }}
              onTogglePin={() => void onTogglePin(chat)}
            />
          );
        })}
    </main>
  );
}

type ChatRowProps = {
  chat: Chat;
  agentName: string;
  actionLabel: 'Archive' | 'Unarchive';
  isActive?: boolean;
  isStreaming?: boolean;
  isContextMenuOpen: boolean;
  onOpen: () => void;
  onAction: () => void;
  onLongPress: () => void;
  onContextMenuOpenChange: (open: boolean) => void;
  onMarkReadToggle: () => void;
  onTogglePin: () => void;
};

const TITLE_TYPING_SPEED_MS = 40;

function ChatRow({ chat, agentName, actionLabel, isActive = false, isStreaming = false, isContextMenuOpen, onOpen, onAction, onLongPress, onContextMenuOpenChange, onMarkReadToggle, onTogglePin }: ChatRowProps) {
  const [offsetX, setOffsetX] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [typingTitle, setTypingTitle] = useState<string | null>(null);
  const prevTitleRef = useRef(chat.title);
  const titleTypingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const dragStartXRef = useRef(0);
  const dragStartYRef = useRef(0);
  const dragBaseOffsetRef = useRef(0);
  const pointerIdRef = useRef<number | null>(null);
  const longPressTimerRef = useRef<number | null>(null);
  const longPressTriggeredRef = useRef(false);
  const scrolledRef = useRef(false);

  useEffect(() => {
    if (chat.title !== prevTitleRef.current && chat.title_source === 'auto') {
      if (titleTypingIntervalRef.current) clearInterval(titleTypingIntervalRef.current);
      const fullTitle = chat.title;
      let i = 0;
      setTypingTitle('');
      titleTypingIntervalRef.current = setInterval(() => {
        i++;
        setTypingTitle(fullTitle.slice(0, i));
        if (i >= fullTitle.length) {
          clearInterval(titleTypingIntervalRef.current!);
          titleTypingIntervalRef.current = null;
          setTimeout(() => setTypingTitle(null), 1200);
        }
      }, TITLE_TYPING_SPEED_MS);
    }
    prevTitleRef.current = chat.title;
    return () => {
      if (titleTypingIntervalRef.current) clearInterval(titleTypingIntervalRef.current);
    };
  }, [chat.title, chat.title_source]);

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
      scrolledRef.current = false;
      if (typeof event.currentTarget.setPointerCapture === 'function') {
        event.currentTarget.setPointerCapture(event.pointerId);
      }
      clearLongPressTimer();
      longPressTimerRef.current = window.setTimeout(() => {
        if (!isDragging) {
          longPressTriggeredRef.current = true;
          onLongPress();
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
      if (!scrolledRef.current && Math.abs(deltaY) > 10) {
        scrolledRef.current = true;
      }
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

      if (!isDragging && !longPressTriggeredRef.current && !scrolledRef.current) {
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

  const unread = chat.unread_count > 0 && !isActive;
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
    <div className="relative overflow-hidden">
      {offsetX < 0 && (
        <button
          type="button"
          className={cn(
            'absolute inset-y-0 right-0 z-0 w-[86px] cursor-pointer flex flex-col items-center justify-center gap-1 rounded-l-xl text-white',
            actionLabel === 'Archive' ? 'bg-red-500' : 'bg-blue-500',
          )}
          onClick={onAction}
        >
          {actionLabel === 'Archive' ? <Archive size={20} /> : <Inbox size={20} />}
          <span className="text-[11px] font-semibold uppercase tracking-wide">{actionLabel}</span>
        </button>
      )}
      <button
        type="button"
        className={cn(
          'facehash-hover-group relative z-10 flex w-full cursor-pointer items-center gap-3 border-b px-3 py-3.5 md:py-2.5 text-left transition-all duration-150',
          isActive
            ? 'bg-muted border-border/30'
            : 'bg-background border-border/30 hover:bg-muted',
        )}
        style={{ transform: `translateX(${offsetX}px)` }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerEnd}
        onPointerCancel={handlePointerEnd}
        onKeyDown={handleKeyDown}
        onContextMenu={(event) => {
          event.preventDefault();
          onLongPress();
        }}
      >
        <div className="shrink-0">
          <Facehash name={agentName} size={36} interactive colors={FACEHASH_COLORS} intensity3d="dramatic" variant="gradient" gradientOverlayClass="facehash-gradient" className="rounded-full text-black" enableBlink={isStreaming} onRenderMouth={isStreaming ? () => <Spinner /> : undefined} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <p
              className={`line-clamp-1 text-[13px] ${unread ? 'font-semibold text-foreground' : 'font-medium text-foreground'}`}
            >
              {typingTitle != null ? (
                <>{typingTitle}<span className="animate-pulse opacity-70">|</span></>
              ) : (
                chat.title
              )}
            </p>
            <div className="flex items-center gap-1.5 shrink-0">
              {chat.pinned && <Pin className="h-3 w-3 text-muted-foreground/60 fill-muted-foreground/60" />}
              <span className="text-[11px] text-muted-foreground/60">{formatInboxTimestamp(chat.last_message_at)}</span>
              {pendingBadge}
              {!isActive && <UnreadBadge count={chat.unread_count} />}
            </div>
          </div>
          <p className="text-[11px] font-semibold text-primary/60 truncate">{agentName}{isStreaming ? ' · typing...' : ''}</p>
          <p className="truncate text-xs text-muted-foreground/50">
            {chat.last_message_preview?.trim() || 'No messages yet'}
          </p>
        </div>
      </button>

      <DropdownMenu open={isContextMenuOpen} onOpenChange={onContextMenuOpenChange}>
        <DropdownMenuTrigger className="pointer-events-none absolute bottom-0 left-0 opacity-0" tabIndex={-1} aria-hidden="true" />
        <DropdownMenuContent align="start" className="min-w-48">
          <DropdownMenuItem
            onClick={() => {
              onContextMenuOpenChange(false);
              onMarkReadToggle();
            }}
          >
            {chat.unread_count > 0 ? <><MailOpen size={16} /> Mark as read</> : <><Mail size={16} /> Mark as unread</>}
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => {
              onContextMenuOpenChange(false);
              onTogglePin();
            }}
          >
            {chat.pinned ? <><PinOff size={16} /> Unpin</> : <><Pin size={16} /> Pin</>}
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => {
              onContextMenuOpenChange(false);
              onAction();
            }}
          >
            {chat.is_archived ? <><Inbox size={16} /> Unarchive</> : <><Archive size={16} /> Archive</>}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
