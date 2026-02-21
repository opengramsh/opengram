import type { ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { Facehash } from 'facehash';
import { Plus } from 'lucide-react';

import { cn } from '@/src/lib/utils';

import { ChatList } from '@/src/components/chats/chat-list';
import { NewChatSheet } from '@/src/components/chats/new-chat-sheet';
import type { UseChatListReturn } from '@/src/components/chats/use-chat-list';
import { HamburgerMenu } from '@/src/components/navigation/hamburger-menu';
import { Badge } from '@/src/components/ui/badge';
import { Button } from '@/src/components/ui/button';
import { Input } from '@/src/components/ui/input';

type ChatListPageProps = {
  chatList: UseChatListReturn;
  headerContent: ReactNode;
  emptyLabel: string;
  rowActionLabel: 'Archive' | 'Unarchive';
  searchPlaceholder: string;
  sidebarMode?: boolean;
  activeChatId?: string;
};

export function ChatListPage({
  chatList,
  headerContent,
  emptyLabel,
  rowActionLabel,
  searchPlaceholder,
  sidebarMode = false,
  activeChatId,
}: ChatListPageProps) {
  const navigate = useNavigate();
  const {
    agents,
    models,
    customStates,
    chats,
    loading,
    error,
    searchInput,
    setSearchInput,
    selectedAgentId,
    setSelectedAgentId,
    selectedState,
    setSelectedState,
    agentsById,
    markChatRead,
    markChatUnread,
    togglePin,
    toggleArchive,
    isNewChatOpen,
    openNewChatSheet,
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
  } = chatList;

  return (
    <div className={cn('flex w-full flex-col bg-background', sidebarMode ? 'h-full overflow-hidden' : 'min-h-screen pb-36')}>
      <header className="sticky top-0 z-20 h-[61px] border-b border-border/70 bg-background/95 px-4 py-3 backdrop-blur-md">
        <div className="grid grid-cols-[36px_1fr_36px] items-center">
          <HamburgerMenu />
          <div className="text-center">{headerContent}</div>
          <div />
        </div>
      </header>

      <section className="space-y-2 border-b border-border/60 px-4 py-3">
        <div className="flex items-center justify-between">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Agents</p>
          {(selectedAgentId || selectedState) && (
            <Button
              variant="link"
              size="xs"
              onClick={() => {
                setSelectedAgentId('');
                setSelectedState('');
              }}
            >
              Clear filters
            </Button>
          )}
        </div>
        <div className="flex gap-2 overflow-x-auto pb-1">
          <Badge
            variant="filter"
            data-active={!selectedAgentId}
            role="button"
            tabIndex={0}
            className="cursor-pointer"
            onClick={() => setSelectedAgentId('')}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelectedAgentId(''); } }}
          >
            All agents
          </Badge>
          {agents.map((agent) => (
            <Badge
              key={agent.id}
              variant="filter"
              data-active={selectedAgentId === agent.id}
              role="button"
              tabIndex={0}
              className="cursor-pointer"
              onClick={() => setSelectedAgentId((current) => (current === agent.id ? '' : agent.id))}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelectedAgentId((current) => (current === agent.id ? '' : agent.id)); } }}
            >
              <Facehash name={agent.name} size={16} interactive={false} className="shrink-0 rounded-sm text-black" />
              {agent.name}
            </Badge>
          ))}
        </div>
        {customStates.length > 1 && (
          <div className="flex gap-2 overflow-x-auto pb-1">
            <Badge
              variant="filter"
              data-active={!selectedState}
              role="button"
              tabIndex={0}
              className="cursor-pointer"
              onClick={() => setSelectedState('')}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelectedState(''); } }}
            >
              All states
            </Badge>
            {customStates.map((state) => (
              <Badge
                key={state}
                variant="filter"
                data-active={selectedState === state}
                role="button"
                tabIndex={0}
                className="cursor-pointer"
                onClick={() => setSelectedState((current) => (current === state ? '' : state))}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelectedState((current) => (current === state ? '' : state)); } }}
              >
                {state}
              </Badge>
            ))}
          </div>
        )}
      </section>

      <ChatList
        chats={chats}
        agentsById={agentsById}
        loading={loading}
        error={error}
        emptyLabel={emptyLabel}
        rowActionLabel={rowActionLabel}
        activeChatId={activeChatId}
        onOpenChat={(chat) => navigate(`/chats/${chat.id}`)}
        onMarkRead={markChatRead}
        onMarkUnread={markChatUnread}
        onTogglePin={togglePin}
        onToggleArchive={toggleArchive}
      />

      <div className={cn('liquid-glass z-30 flex h-[69px] w-full items-center gap-3 px-4 py-3', sidebarMode ? 'sticky bottom-0' : 'fixed inset-x-0 bottom-0')}>
        <Input
          type="search"
          value={searchInput}
          onChange={(event) => setSearchInput(event.target.value)}
          placeholder={searchPlaceholder}
          className="h-11 flex-1 rounded-2xl border-border/70 bg-background/70"
        />
        <Button
          aria-label="New chat"
          size="icon-xl"
          className="bg-[hsl(151,100%,43%)] text-black shadow-lg shadow-[hsl(151,100%,43%)]/30 hover:bg-[hsl(151,100%,38%)]"
          onClick={() => navigate('/chats/new')}
        >
          <Plus size={19} strokeWidth={2.5} />
        </Button>
      </div>

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
