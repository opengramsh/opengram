import { Facehash } from 'facehash';

import { cn, FACEHASH_COLORS } from '@/src/lib/utils';

import type { Agent, SearchResponse } from '@/src/components/chats/types';

type SearchResultsListProps = {
  searchResults: SearchResponse | null;
  loading: boolean;
  query: string;
  agentsById: Map<string, Agent>;
  onOpenChat: (chatId: string, chatSeed?: { id: string; title: string; agent_ids: string[] }, messageId?: string) => void;
};

function AgentAvatar({ agentIds, agentsById }: { agentIds: string[]; agentsById: Map<string, Agent> }) {
  const agent = agentIds[0] ? agentsById.get(agentIds[0]) : undefined;
  const agentName = agent?.name ?? 'Unknown Agent';

  return (
    <div className="flex shrink-0 items-center gap-2">
      <Facehash name={agentName} size={36} interactive colors={FACEHASH_COLORS} intensity3d="dramatic" variant="gradient" gradientOverlayClass="facehash-gradient" className="rounded-lg text-black" />
    </div>
  );
}

export function SearchResultsList({ searchResults, loading, query, agentsById, onOpenChat }: SearchResultsListProps) {
  if (loading) {
    return (
      <main className="flex-1 overflow-y-auto px-2 py-2">
        <p className="px-4 py-6 text-sm text-muted-foreground">Searching...</p>
      </main>
    );
  }

  if (!searchResults) {
    return (
      <main className="flex-1 overflow-y-auto px-2 py-2">
        <p className="px-4 py-6 text-sm text-muted-foreground">Type to search messages and chats.</p>
      </main>
    );
  }

  const hasChats = (searchResults.chats?.length ?? 0) > 0;
  const hasMessages = (searchResults.messages?.length ?? 0) > 0;
  const isEmpty = !hasChats && !hasMessages;

  return (
    <main className="flex-1 overflow-y-auto px-2 py-2">
      {isEmpty && (
        <p className="px-4 py-8 text-sm text-muted-foreground">
          No results for <span className="font-medium text-foreground">&ldquo;{query}&rdquo;</span>
        </p>
      )}

      {hasChats && (
        <>
          <p className="mb-1 px-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70">
            Chats
          </p>
          {searchResults.chats.map((chat) => {
            const agent = chat.agent_ids[0] ? agentsById.get(chat.agent_ids[0]) : undefined;
            const agentName = agent?.name ?? 'Unknown Agent';

            return (
              <button
                key={chat.id}
                type="button"
                className="facehash-hover-group mb-2 w-full cursor-pointer rounded-2xl border border-border/80 bg-card px-3 py-3 text-left transition-colors hover:bg-muted/60"
                onClick={() => onOpenChat(chat.id, { id: chat.id, title: chat.title, agent_ids: chat.agent_ids })}
              >
                <div className="flex items-center gap-3">
                  <AgentAvatar agentIds={chat.agent_ids} agentsById={agentsById} />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-foreground">{chat.title}</p>
                    <p className="text-xs text-muted-foreground/70">{agentName}</p>
                  </div>
                </div>
              </button>
            );
          })}
        </>
      )}

      {hasMessages && (
        <>
          <p className={cn('mb-1 px-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70', hasChats && 'mt-3')}>
            Messages
          </p>
          {searchResults.messages.map((msg) => {
            const agent = msg.agent_ids[0] ? agentsById.get(msg.agent_ids[0]) : undefined;
            const agentName = agent?.name ?? 'Unknown Agent';

            return (
              <button
                key={msg.id}
                type="button"
                className="facehash-hover-group mb-2 w-full cursor-pointer rounded-2xl border border-border/80 bg-card px-3 py-3 text-left transition-colors hover:bg-muted/60"
                onClick={() => onOpenChat(msg.chat_id, {
                  id: msg.chat_id,
                  title: msg.chat_title,
                  agent_ids: msg.agent_ids,
                }, msg.id)}
              >
                <div className="flex items-start gap-3">
                  <div className="mt-0.5">
                    <AgentAvatar agentIds={msg.agent_ids} agentsById={agentsById} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2">
                      <p className="text-[11px] font-semibold tracking-wide text-primary/60">{msg.chat_title}</p>
                      <p className="text-[10px] text-muted-foreground/50">{agentName}</p>
                    </div>
                    <p
                      className="mt-0.5 line-clamp-3 text-xs text-muted-foreground/80 [&_mark]:rounded-sm [&_mark]:bg-yellow-300/30 [&_mark]:text-foreground"
                      dangerouslySetInnerHTML={{ __html: msg.snippet }}
                    />
                  </div>
                </div>
              </button>
            );
          })}
        </>
      )}
    </main>
  );
}
