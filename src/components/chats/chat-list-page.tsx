import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { Facehash } from 'facehash';
import { MessageCirclePlus, Search, X } from 'lucide-react';

import { cn, FACEHASH_COLORS } from '@/src/lib/utils';

import { ChatList } from '@/src/components/chats/chat-list';
import { NewChatSheet } from '@/src/components/chats/new-chat-sheet';
import { SearchResultsList } from '@/src/components/chats/search-results-list';
import { UnreadBadge } from '@/src/components/chats/unread-badge';
import type { UseChatListReturn } from '@/src/components/chats/use-chat-list';
import { HamburgerMenu } from '@/src/components/navigation/hamburger-menu';
import { Button } from '@/src/components/ui/button';
import { Input } from '@/src/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger } from '@/src/components/ui/select';

type ChatListPageProps = {
  chatList: UseChatListReturn;
  headerContent: ReactNode;
  emptyLabel: string;
  rowActionLabel: 'Archive' | 'Unarchive';
  searchPlaceholder: string;
  sidebarMode?: boolean;
  activeChatId?: string;
  streamingChatIds?: Set<string>;
  totalUnread?: number;
  unreadByAgent?: Record<string, number>;
};

export function ChatListPage({
  chatList,
  headerContent,
  emptyLabel,
  rowActionLabel,
  searchPlaceholder,
  sidebarMode = false,
  activeChatId,
  streamingChatIds,
  totalUnread,
  unreadByAgent,
}: ChatListPageProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isSearchOpen) {
      searchInputRef.current?.focus();
    }
  }, [isSearchOpen]);

  const {
    agents,
    models,
    chats,
    loading,
    error,
    searchInput,
    setSearchInput,
    selectedAgentId,
    setSelectedAgentId,
    agentsById,
    markChatRead,
    markChatUnread,
    togglePin,
    toggleArchive,
    renameChat,
    isNewChatOpen,
    closeNewChatSheet,
    newChatAgentId,
    setNewChatAgentId,
    newChatModelId,
    setNewChatModelId,
    newChatFirstMessage,
    setNewChatFirstMessage,
    newChatError,
    setNewChatError,
    isCreatingNewChat,
    canSendNewChat,
    createNewChat,
    searchQuery,
    searchResults,
    isSearchResultsLoading,
  } = chatList;

  return (
    <div className={cn('flex w-full flex-col bg-background', sidebarMode ? 'h-full overflow-hidden' : 'min-h-screen')}>
      <header className="sticky top-0 z-20 h-[68px] md:h-[61px] border-b border-border/70 bg-background/95 px-4 py-1.5 backdrop-blur-md">
        {isSearchOpen ? (
          <div className="flex h-full items-center gap-2">
            <div className="relative flex-1">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                ref={searchInputRef}
                type="search"
                value={searchInput}
                onChange={(event) => setSearchInput(event.target.value)}
                placeholder={searchPlaceholder}
                className="h-9 pl-9 text-sm"
              />
            </div>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Close search"
              className="size-10 md:size-9"
              onClick={() => {
                setSearchInput('');
                setIsSearchOpen(false);
              }}
            >
              <X size={18} />
            </Button>
          </div>
        ) : (
          <div className="grid h-full grid-cols-[42px_1fr_42px_42px] md:grid-cols-[36px_1fr_36px_36px] items-center">
            <HamburgerMenu />
            <div className="text-center">{headerContent}</div>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Search chats"
              className="size-10 md:size-9"
              onClick={() => setIsSearchOpen(true)}
            >
              <Search size={18} />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              aria-label="New chat"
              className="size-10 md:size-9"
              onClick={() => navigate('/chats/new')}
            >
              <MessageCirclePlus size={18} strokeWidth={2} />
            </Button>
          </div>
        )}
      </header>

      {!isSearchOpen && <section className="border-b border-border/60 px-4 py-3">
        <Select
          value={selectedAgentId || 'all'}
          onValueChange={(value) => setSelectedAgentId(value === 'all' ? '' : value)}
        >
          <SelectTrigger className="w-full">
            {selectedAgentId && agentsById.get(selectedAgentId) ? (
              <span className="flex items-center gap-2">
                <Facehash name={agentsById.get(selectedAgentId)!.name} size={16} interactive={false} colors={FACEHASH_COLORS} intensity3d="none" variant="gradient" gradientOverlayClass="facehash-gradient" className="shrink-0 rounded-sm text-black [&_svg]:!text-black" />
                {agentsById.get(selectedAgentId)!.name}
              </span>
            ) : (
              <span>All agents</span>
            )}
          </SelectTrigger>
          <SelectContent position="popper">
            <SelectItem value="all" className="py-2.5">
              <span className="flex-1 text-base font-medium">All agents</span>
              <UnreadBadge count={totalUnread ?? 0} />
            </SelectItem>
            {agents.map((agent) => (
              <SelectItem key={agent.id} value={agent.id} className="py-2.5">
                <Facehash name={agent.name} size={24} interactive={false} colors={FACEHASH_COLORS} intensity3d="none" variant="gradient" gradientOverlayClass="facehash-gradient" className="shrink-0 rounded-md text-black [&_svg]:!text-black" />
                <span className="flex-1 text-base font-medium">{agent.name}</span>
                <UnreadBadge count={unreadByAgent?.[agent.id] ?? 0} />
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </section>}

      {searchQuery ? (
        <SearchResultsList
          searchResults={searchResults}
          loading={isSearchResultsLoading}
          query={searchQuery}
          agentsById={agentsById}
          onOpenChat={(chatId, chatSeed, messageId) =>
            navigate(`/chats/${chatId}`, {
              state: {
                chat: chatSeed
                  ? {
                    id: chatSeed.id,
                    title: chatSeed.title,
                    title_source: 'default',
                    tags: [],
                    model_id: '',
                    pinned: false,
                    is_archived: false,
                    notifications_muted: false,
                    agent_ids: chatSeed.agent_ids,
                    pending_requests_count: 0,
                  }
                  : undefined,
                scrollToMessageId: messageId,
                fromPath: location.pathname,
              },
            })}
        />
      ) : (
        <ChatList
          chats={chats}
          agentsById={agentsById}
          loading={loading}
          error={error}
          emptyLabel={emptyLabel}
          rowActionLabel={rowActionLabel}
          activeChatId={activeChatId}
          streamingChatIds={streamingChatIds}
          onOpenChat={(chat) => navigate(`/chats/${chat.id}`, { state: { chat, fromPath: location.pathname } })}
          onMarkRead={markChatRead}
          onMarkUnread={markChatUnread}
          onTogglePin={togglePin}
          onToggleArchive={toggleArchive}
          onRenameChat={renameChat}
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
        onSelectAgent={(agentId) => {
          setNewChatAgentId(agentId);
          setNewChatError(null);
        }}
        onSelectModel={setNewChatModelId}
        onChangeFirstMessage={(value) => {
          setNewChatFirstMessage(value);
          if (newChatError) {
            setNewChatError(null);
          }
        }}
        onSubmit={() => void createNewChat()}
      />
    </div>
  );
}
