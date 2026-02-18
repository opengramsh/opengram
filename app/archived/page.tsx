'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

import { buildChatsQuery, sortInboxChats } from '@/src/lib/inbox';
import { ChatList } from '@/src/components/chats/chat-list';
import type { Agent, Chat, ChatsResponse, ConfigResponse } from '@/src/components/chats/types';
import { HamburgerMenu } from '@/src/components/navigation/hamburger-menu';

function chipClass(active: boolean) {
  if (active) {
    return 'rounded-full border border-primary/50 bg-primary/20 px-3 py-1 text-xs font-semibold text-foreground';
  }

  return 'rounded-full border border-border bg-card px-3 py-1 text-xs font-medium text-muted-foreground hover:text-foreground';
}

export default function ArchivedPage() {
  const router = useRouter();
  const [appName, setAppName] = useState('OpenGram');
  const [agents, setAgents] = useState<Agent[]>([]);
  const [customStates, setCustomStates] = useState<string[]>([]);
  const [chats, setChats] = useState<Chat[]>([]);
  const [searchInput, setSearchInput] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedAgentId, setSelectedAgentId] = useState('');
  const [selectedState, setSelectedState] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const fetchIdRef = useRef(0);

  const agentsById = useMemo(() => {
    const map = new Map<string, Agent>();
    for (const agent of agents) {
      map.set(agent.id, agent);
    }
    return map;
  }, [agents]);

  useEffect(() => {
    const timer = setTimeout(() => {
      setSearchQuery(searchInput.trim());
    }, 220);

    return () => {
      clearTimeout(timer);
    };
  }, [searchInput]);

  const loadConfig = useCallback(async () => {
    const response = await fetch('/api/v1/config', { cache: 'no-store' });
    if (!response.ok) {
      throw new Error(`Config request failed with status ${response.status}`);
    }

    const config = (await response.json()) as ConfigResponse;
    setAppName(config.appName || 'OpenGram');
    setAgents(config.agents ?? []);
    setCustomStates(config.customStates ?? []);
  }, []);

  const loadChats = useCallback(async () => {
    const currentFetchId = ++fetchIdRef.current;
    setLoading(true);
    setError(null);

    try {
      const query = buildChatsQuery({
        archived: true,
        query: searchQuery,
        agentId: selectedAgentId || null,
        state: selectedState || null,
      });
      const response = await fetch(`/api/v1/chats${query}`, { cache: 'no-store' });
      if (!response.ok) {
        throw new Error(`Chats request failed with status ${response.status}`);
      }

      const payload = (await response.json()) as ChatsResponse;
      if (currentFetchId !== fetchIdRef.current) {
        return;
      }

      setChats(sortInboxChats(payload.data ?? []));
    } catch {
      if (currentFetchId === fetchIdRef.current) {
        setError('Failed to load archived chats.');
      }
    } finally {
      if (currentFetchId === fetchIdRef.current) {
        setLoading(false);
      }
    }
  }, [searchQuery, selectedAgentId, selectedState]);

  useEffect(() => {
    loadConfig().catch(() => setError('Failed to load app config.'));
  }, [loadConfig]);

  useEffect(() => {
    loadChats().catch(() => setError('Failed to load archived chats.'));
  }, [loadChats]);

  const refreshChats = useCallback(async () => {
    await loadChats();
  }, [loadChats]);

  const mutateChat = useCallback(
    async (chatId: string, updater: (chat: Chat) => Chat | null, request: () => Promise<Response>) => {
      setChats((current) => {
        const next = current
          .map((chat) => {
            if (chat.id !== chatId) {
              return chat;
            }
            return updater(chat);
          })
          .filter((chat): chat is Chat => chat !== null);

        return sortInboxChats(next);
      });

      try {
        const response = await request();
        if (!response.ok) {
          throw new Error('mutation failed');
        }
      } catch {
        await refreshChats();
      }
    },
    [refreshChats],
  );

  const markChatRead = useCallback(
    async (chat: Chat) => {
      await mutateChat(
        chat.id,
        (current) => ({
          ...current,
          unread_count: 0,
          last_read_at: new Date().toISOString(),
        }),
        () =>
          fetch(`/api/v1/chats/${chat.id}/mark-read`, {
            method: 'POST',
          }),
      );
    },
    [mutateChat],
  );

  const markChatUnread = useCallback(
    async (chat: Chat) => {
      await mutateChat(
        chat.id,
        (current) => ({
          ...current,
          unread_count: Math.max(1, current.unread_count),
          last_read_at: null,
        }),
        () =>
          fetch(`/api/v1/chats/${chat.id}/mark-unread`, {
            method: 'POST',
          }),
      );
    },
    [mutateChat],
  );

  const togglePin = useCallback(
    async (chat: Chat) => {
      await mutateChat(
        chat.id,
        (current) => ({
          ...current,
          pinned: !current.pinned,
        }),
        () =>
          fetch(`/api/v1/chats/${chat.id}`, {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ pinned: !chat.pinned }),
          }),
      );
    },
    [mutateChat],
  );

  const unarchiveChat = useCallback(
    async (chat: Chat) => {
      await mutateChat(
        chat.id,
        () => null,
        () =>
          fetch(`/api/v1/chats/${chat.id}/unarchive`, {
            method: 'POST',
          }),
      );
    },
    [mutateChat],
  );

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-3xl flex-col bg-background pb-20">
      <header className="sticky top-0 z-20 border-b border-border/70 bg-background/95 px-4 py-3 backdrop-blur-md">
        <div className="grid grid-cols-[36px_1fr_36px] items-center">
          <HamburgerMenu />
          <div className="text-center">
            <h1 className="text-sm font-semibold tracking-wide text-foreground">Archived chats</h1>
            <p className="text-xs text-muted-foreground">{appName}</p>
          </div>
          <div />
        </div>
      </header>

      <section className="space-y-2 border-b border-border/60 px-4 py-3">
        <div className="flex items-center justify-between">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Agents</p>
          {(selectedAgentId || selectedState) && (
            <button
              type="button"
              className="text-xs font-medium text-primary"
              onClick={() => {
                setSelectedAgentId('');
                setSelectedState('');
              }}
            >
              Clear filters
            </button>
          )}
        </div>
        <div className="flex gap-2 overflow-x-auto pb-1">
          <button type="button" className={chipClass(!selectedAgentId)} onClick={() => setSelectedAgentId('')}>
            All agents
          </button>
          {agents.map((agent) => (
            <button
              key={agent.id}
              type="button"
              className={chipClass(selectedAgentId === agent.id)}
              onClick={() => setSelectedAgentId((current) => (current === agent.id ? '' : agent.id))}
            >
              {agent.name}
            </button>
          ))}
        </div>
        {customStates.length > 1 && (
          <div className="flex gap-2 overflow-x-auto pb-1">
            <button type="button" className={chipClass(!selectedState)} onClick={() => setSelectedState('')}>
              All states
            </button>
            {customStates.map((state) => (
              <button
                key={state}
                type="button"
                className={chipClass(selectedState === state)}
                onClick={() => setSelectedState((current) => (current === state ? '' : state))}
              >
                {state}
              </button>
            ))}
          </div>
        )}
      </section>

      <ChatList
        chats={chats}
        agentsById={agentsById}
        loading={loading}
        error={error}
        emptyLabel="No archived chats match the current filters."
        rowActionLabel="Unarchive"
        onOpenChat={(chat) => router.push(`/chats/${chat.id}`)}
        onMarkRead={markChatRead}
        onMarkUnread={markChatUnread}
        onTogglePin={togglePin}
        onToggleArchive={unarchiveChat}
      />

      <div className="liquid-glass fixed inset-x-0 bottom-0 z-30 mx-auto flex w-full max-w-3xl items-center gap-3 px-4 py-3">
        <input
          type="search"
          value={searchInput}
          onChange={(event) => setSearchInput(event.target.value)}
          placeholder="Search archived chats"
          className="h-11 flex-1 rounded-2xl border border-border/70 bg-background/70 px-4 text-sm outline-none placeholder:text-muted-foreground focus:border-primary/70"
        />
      </div>
    </div>
  );
}
