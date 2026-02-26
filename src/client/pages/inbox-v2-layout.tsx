import { useCallback, useEffect, useRef, useState } from 'react';
import { Outlet, useMatch, useNavigate } from 'react-router';
import { Facehash } from 'facehash';
import { MessageCirclePlus, Search, X } from 'lucide-react';

import logoSm from '/opengram-logo-sm.webp';
import { apiFetch } from '@/src/lib/api-fetch';
import { sortInboxChats } from '@/src/lib/inbox';
import type { Chat } from '@/src/components/chats/types';
import { useChatList } from '@/src/components/chats/use-chat-list';
import {
  subscribeToEventsStream,
  type FrontendStreamEvent,
} from '@/src/lib/events-stream';
import { cn, FACEHASH_COLORS } from '@/src/lib/utils';
import { isSoundEnabled } from '@/src/lib/notification-preferences';
import { playNotificationSound } from '@/src/lib/notification-sound';
import { applyKeyboardCssVars, subscribeToKeyboardLayout } from '@/src/lib/keyboard-layout';
import { ChatList } from '@/src/components/chats/chat-list';
import { NewChatSheet } from '@/src/components/chats/new-chat-sheet';
import { SearchResultsList } from '@/src/components/chats/search-results-list';
import { UnreadBadge } from '@/src/components/chats/unread-badge';
import { HamburgerMenu } from '@/src/components/navigation/hamburger-menu';
import { Button } from '@/src/components/ui/button';
import { Input } from '@/src/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger } from '@/src/components/ui/select';

type UnreadSummaryPayload = {
  total_unread?: number;
  unread_by_agent?: Record<string, number>;
};

function useGlobalKeyboardReset() {
  useEffect(() => {
    return subscribeToKeyboardLayout(window, document, (layout) => {
      applyKeyboardCssVars(document.documentElement, layout);
    });
  }, []);
}

export default function InboxV2Layout() {
  useGlobalKeyboardReset();
  const navigate = useNavigate();
  const [totalUnread, setTotalUnread] = useState(0);
  const [unreadByAgent, setUnreadByAgent] = useState<Record<string, number>>({});
  const [streamingChatIds, setStreamingChatIds] = useState<Set<string>>(new Set());
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const isChatSelected = !useMatch('/v2');
  const chatMatch = useMatch('/v2/chats/:chatId');
  const activeChatId = chatMatch?.params.chatId;

  useEffect(() => {
    if (isSearchOpen) searchInputRef.current?.focus();
  }, [isSearchOpen]);

  const loadUnreadSummary = useCallback(async () => {
    const response = await apiFetch('/api/v1/chats/unread-summary?archived=false', { cache: 'no-store' });
    if (!response.ok) return;
    const payload = (await response.json()) as UnreadSummaryPayload;
    setTotalUnread(Math.max(0, payload.total_unread ?? 0));
    setUnreadByAgent(payload.unread_by_agent ?? {});
  }, []);

  const chatList = useChatList({
    archived: false,
    chatsErrorMessage: 'Failed to load inbox data.',
    onRefreshExtras: loadUnreadSummary,
    onMutationSuccess: loadUnreadSummary,
  });

  const typingTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const chatsRef = useRef<Chat[]>([]);
  useEffect(() => { chatsRef.current = chatList.chats; }, [chatList.chats]);

  const { setChats, loadChats, refreshChats, matchesActiveFilters } = chatList;

  useEffect(() => {
    loadUnreadSummary().catch(() => { setTotalUnread(0); setUnreadByAgent({}); });
  }, [loadUnreadSummary]);

  const refreshSingleInboxChat = useCallback(
    async (incomingChatId: string) => {
      const response = await apiFetch(`/api/v1/chats/${incomingChatId}`, { cache: 'no-store' });
      if (!response.ok) throw new Error('Failed to load changed chat');
      const updated = (await response.json()) as Chat;
      setChats((current) => {
        const withoutChat = current.filter((c) => c.id !== updated.id);
        if (!matchesActiveFilters(updated)) return withoutChat;
        return sortInboxChats([...withoutChat, updated]);
      });
    },
    [matchesActiveFilters, setChats],
  );

  // SSE subscription for real-time updates (mirrors InboxLayout)
  useEffect(() => {
    const unsubscribe = subscribeToEventsStream((event: FrontendStreamEvent) => {
      const chatIdFromEvent = typeof event.payload.chatId === 'string' ? event.payload.chatId : null;
      const refreshesPendingSummary =
        event.type === 'request.created' || event.type === 'request.resolved' || event.type === 'request.cancelled';

      // Typing indicator
      if (event.type === 'chat.typing' && chatIdFromEvent) {
        setStreamingChatIds((prev) => new Set(prev).add(chatIdFromEvent));
        const existing = typingTimersRef.current.get(chatIdFromEvent);
        if (existing) clearTimeout(existing);
        typingTimersRef.current.set(chatIdFromEvent, setTimeout(() => {
          typingTimersRef.current.delete(chatIdFromEvent);
          setStreamingChatIds((prev) => {
            if (!prev.has(chatIdFromEvent)) return prev;
            const next = new Set(prev); next.delete(chatIdFromEvent); return next;
          });
        }, 12_000));
      }

      if (event.type === 'message.created' && chatIdFromEvent &&
        event.payload.role !== 'user' && event.payload.streamState !== 'streaming') {
        const timer = typingTimersRef.current.get(chatIdFromEvent);
        if (timer) { clearTimeout(timer); typingTimersRef.current.delete(chatIdFromEvent); }
        setStreamingChatIds((prev) => {
          if (!prev.has(chatIdFromEvent)) return prev;
          const next = new Set(prev); next.delete(chatIdFromEvent); return next;
        });
      }

      if (event.type === 'message.streaming.complete' && chatIdFromEvent) {
        const timer = typingTimersRef.current.get(chatIdFromEvent);
        if (timer) { clearTimeout(timer); typingTimersRef.current.delete(chatIdFromEvent); }
        setStreamingChatIds((prev) => {
          if (!prev.has(chatIdFromEvent)) return prev;
          const next = new Set(prev); next.delete(chatIdFromEvent); return next;
        });
      }

      // Notification sounds
      if (
        (event.type === 'message.created' || event.type === 'message.streaming.complete') &&
        chatIdFromEvent && event.payload.role !== 'user' && event.payload.streamState !== 'streaming'
      ) {
        const chat = chatsRef.current.find((c) => c.id === chatIdFromEvent);
        if (!chat?.notifications_muted && isSoundEnabled()) playNotificationSound();
      }

      const isStreamingStart = event.type === 'message.created' && event.payload.streamState === 'streaming';
      const isUserMessage = event.type === 'message.created' && event.payload.role === 'user';

      if (isUserMessage && chatIdFromEvent) {
        const content = typeof event.payload.contentFinal === 'string' ? event.payload.contentFinal : null;
        const preview = content ? content.trim().slice(0, 180) : null;
        const createdAt = typeof event.payload.createdAt === 'string' ? event.payload.createdAt : null;
        setChats((current) => sortInboxChats(current.map((c) =>
          c.id === chatIdFromEvent
            ? { ...c, ...(preview != null && { last_message_preview: preview }), last_message_role: 'user', ...(createdAt != null && { last_message_at: createdAt }) }
            : c,
        )));
        return;
      }

      if (!isStreamingStart && !isUserMessage &&
        (event.type === 'chat.created' || event.type === 'chat.updated' || event.type === 'chat.unarchived' ||
          event.type === 'chat.read' || event.type === 'chat.unread' || event.type === 'message.created' ||
          event.type === 'message.streaming.complete' || event.type === 'request.created' ||
          event.type === 'request.resolved' || event.type === 'request.cancelled')) {
        if (!chatIdFromEvent) { void (refreshesPendingSummary ? refreshChats() : loadChats()); return; }
        void Promise.all([
          refreshSingleInboxChat(chatIdFromEvent).catch(() => void loadChats()),
          loadUnreadSummary().catch(() => { setTotalUnread(0); setUnreadByAgent({}); }),
        ]);
        return;
      }

      if (event.type === 'chat.archived') {
        if (!chatIdFromEvent) { void refreshChats(); return; }
        setChats((current) => current.filter((c) => c.id !== chatIdFromEvent));
        void loadUnreadSummary().catch(() => { setTotalUnread(0); setUnreadByAgent({}); });
      }
    });

    return () => {
      unsubscribe();
      for (const timer of typingTimersRef.current.values()) clearTimeout(timer);
      typingTimersRef.current.clear();
    };
  }, [loadChats, loadUnreadSummary, refreshChats, refreshSingleInboxChat, setChats]);

  const {
    agents, models, chats, loading, error,
    searchInput, setSearchInput, selectedAgentId, setSelectedAgentId, agentsById,
    markChatRead, markChatUnread, togglePin, toggleArchive,
    isNewChatOpen, openNewChatSheet, closeNewChatSheet,
    newChatAgentId, setNewChatAgentId, newChatModelId, setNewChatModelId,
    newChatFirstMessage, setNewChatFirstMessage, newChatError, setNewChatError,
    isCreatingNewChat, canSendNewChat, createNewChat,
    searchQuery, searchResults, isSearchResultsLoading,
  } = chatList;

  return (
    <div className="flex h-[100dvh] w-full overflow-hidden bg-background">
      {/* Left sidebar: inbox list */}
      <div
        className={cn(
          'flex flex-col border-r border-border/70',
          'w-full md:w-[380px] md:min-w-[380px]',
          isChatSelected ? 'hidden md:flex' : 'flex',
        )}
      >
        <div className="flex w-full flex-col bg-background h-full overflow-hidden">
          {/* Header */}
          <header className="sticky top-0 z-20 h-[68px] md:h-[61px] border-b border-border/70 bg-background/95 px-4 py-1.5 backdrop-blur-md">
            {isSearchOpen ? (
              <div className="flex h-full items-center gap-2">
                <div className="relative flex-1">
                  <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    ref={searchInputRef}
                    type="search"
                    value={searchInput}
                    onChange={(e) => setSearchInput(e.target.value)}
                    placeholder="Search chats"
                    className="h-9 pl-9 text-sm"
                  />
                </div>
                <Button variant="ghost" size="icon" aria-label="Close search" className="size-10 md:size-9"
                  onClick={() => { setSearchInput(''); setIsSearchOpen(false); }}>
                  <X size={18} />
                </Button>
              </div>
            ) : (
              <div className="grid h-full grid-cols-[42px_1fr_42px_42px] md:grid-cols-[36px_1fr_36px_36px] items-center">
                <HamburgerMenu />
                <div className="flex items-center justify-center gap-3 text-center">
                  <img src={logoSm} alt="" className="h-12 w-12 shrink-0" />
                  <div className="flex flex-col items-start">
                    <h1 className="text-sm font-semibold tracking-wide text-foreground leading-tight">{chatList.appName}</h1>
                    <p className="text-xs text-muted-foreground leading-tight">v2 Preview</p>
                  </div>
                </div>
                <Button variant="ghost" size="icon" aria-label="Search chats" className="size-10 md:size-9"
                  onClick={() => setIsSearchOpen(true)}>
                  <Search size={18} />
                </Button>
                <Button variant="ghost" size="icon" aria-label="New chat" className="size-10 md:size-9"
                  onClick={openNewChatSheet}>
                  <MessageCirclePlus size={18} strokeWidth={2} />
                </Button>
              </div>
            )}
          </header>

          {/* Agent filter */}
          {!isSearchOpen && (
            <section className="border-b border-border/60 px-4 py-3">
              <Select value={selectedAgentId || 'all'} onValueChange={(v) => setSelectedAgentId(v === 'all' ? '' : v)}>
                <SelectTrigger className="w-full">
                  {selectedAgentId && agentsById.get(selectedAgentId) ? (
                    <span className="flex items-center gap-2">
                      <Facehash name={agentsById.get(selectedAgentId)!.name} size={16} interactive={false} colors={FACEHASH_COLORS} intensity3d="none" variant="gradient" gradientOverlayClass="facehash-gradient" className="shrink-0 rounded-sm text-black [&_svg]:!text-black" />
                      {agentsById.get(selectedAgentId)!.name}
                    </span>
                  ) : <span>All agents</span>}
                </SelectTrigger>
                <SelectContent position="popper">
                  <SelectItem value="all" className="py-2.5">
                    <span className="flex-1 text-base font-medium">All agents</span>
                    <UnreadBadge count={totalUnread} />
                  </SelectItem>
                  {agents.map((agent) => (
                    <SelectItem key={agent.id} value={agent.id} className="py-2.5">
                      <Facehash name={agent.name} size={24} interactive={false} colors={FACEHASH_COLORS} intensity3d="none" variant="gradient" gradientOverlayClass="facehash-gradient" className="shrink-0 rounded-md text-black [&_svg]:!text-black" />
                      <span className="flex-1 text-base font-medium">{agent.name}</span>
                      <UnreadBadge count={unreadByAgent[agent.id] ?? 0} />
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </section>
          )}

          {/* Chat list or search results */}
          {searchQuery ? (
            <SearchResultsList
              searchResults={searchResults}
              loading={isSearchResultsLoading}
              query={searchQuery}
              agentsById={agentsById}
              onOpenChat={(chatId, chatSeed) =>
                navigate(`/v2/chats/${chatId}`, {
                  state: chatSeed ? { chat: { id: chatSeed.id, title: chatSeed.title, title_source: 'default', tags: [], model_id: '', pinned: false, is_archived: false, notifications_muted: false, agent_ids: chatSeed.agent_ids, pending_requests_count: 0 } } : undefined,
                })
              }
            />
          ) : (
            <ChatList
              chats={chats}
              agentsById={agentsById}
              loading={loading}
              error={error}
              emptyLabel="No chats match the current filters."
              rowActionLabel="Archive"
              activeChatId={activeChatId}
              streamingChatIds={streamingChatIds}
              onOpenChat={(chat) => navigate(`/v2/chats/${chat.id}`, { state: { chat } })}
              onMarkRead={markChatRead}
              onMarkUnread={markChatUnread}
              onTogglePin={togglePin}
              onToggleArchive={toggleArchive}
            />
          )}

          <NewChatSheet
            open={isNewChatOpen}
            agents={agents}
            models={models}
            selectedAgentId={newChatAgentId}
            selectedModelId={newChatModelId}
            firstMessage={newChatFirstMessage}
            error={newChatError}
            isSubmitting={isCreatingNewChat}
            canSubmit={canSendNewChat}
            onClose={closeNewChatSheet}
            onSelectAgent={(id) => { setNewChatAgentId(id); setNewChatError(null); }}
            onSelectModel={setNewChatModelId}
            onChangeFirstMessage={(v) => { setNewChatFirstMessage(v); if (newChatError) setNewChatError(null); }}
            onSubmit={() => void createNewChat()}
          />
        </div>
      </div>

      {/* Right panel: active chat or empty state */}
      <div
        className={cn(
          'flex-1 min-w-0',
          isChatSelected ? 'flex' : 'hidden md:flex md:items-center md:justify-center',
        )}
        style={{ transform: 'translateZ(0)' }}
      >
        <Outlet />
        {!isChatSelected && (
          <p className="text-sm text-muted-foreground">Select a chat to get started</p>
        )}
      </div>
    </div>
  );
}
