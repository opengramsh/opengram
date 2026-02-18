'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Facehash } from 'facehash';
import { Plus } from 'lucide-react';

import {
  buildChatsQuery,
  sortInboxChats,
} from '@/src/lib/inbox';
import {
  normalizeFirstMessageForNewChat,
  selectNewChatAgentId,
  selectNewChatModelId,
} from '@/src/lib/new-chat';
import { ChatList } from '@/src/components/chats/chat-list';
import type { Agent, Chat, ChatsResponse, ConfigResponse } from '@/src/components/chats/types';
import { HamburgerMenu } from '@/src/components/navigation/hamburger-menu';

function chipClass(active: boolean) {
  if (active) {
    return 'rounded-full border border-primary/50 bg-primary/20 px-3 py-1 text-xs font-semibold text-foreground';
  }

  return 'rounded-full border border-border bg-card px-3 py-1 text-xs font-medium text-muted-foreground hover:text-foreground';
}

function pendingLabel(total: number) {
  return total === 1 ? '1 pending request' : `${total} pending requests`;
}

export default function Home() {
  const router = useRouter();
  const [appName, setAppName] = useState('OpenGram');
  const [agents, setAgents] = useState<Agent[]>([]);
  const [models, setModels] = useState<Model[]>([]);
  const [defaultModelIdForNewChats, setDefaultModelIdForNewChats] = useState('');
  const [customStates, setCustomStates] = useState<string[]>([]);
  const [chats, setChats] = useState<Chat[]>([]);
  const [pendingRequestsTotal, setPendingRequestsTotal] = useState(0);
  const [searchInput, setSearchInput] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedAgentId, setSelectedAgentId] = useState('');
  const [selectedState, setSelectedState] = useState('');
  const [isNewChatOpen, setIsNewChatOpen] = useState(false);
  const [newChatAgentId, setNewChatAgentId] = useState('');
  const [newChatModelId, setNewChatModelId] = useState('');
  const [newChatFirstMessage, setNewChatFirstMessage] = useState('');
  const [newChatError, setNewChatError] = useState<string | null>(null);
  const [isCreatingNewChat, setIsCreatingNewChat] = useState(false);
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

  const normalizedNewChatFirstMessage = useMemo(
    () => normalizeFirstMessageForNewChat(newChatFirstMessage),
    [newChatFirstMessage],
  );

  const canSendNewChat = Boolean(newChatAgentId && newChatModelId && normalizedNewChatFirstMessage);

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
    setModels(config.models ?? []);
    setCustomStates(config.customStates ?? []);
    const resolvedDefaultModelId = config.defaultModelIdForNewChats || config.models[0]?.id || '';
    setDefaultModelIdForNewChats(resolvedDefaultModelId);
    setNewChatAgentId((current) => selectNewChatAgentId(config.agents ?? [], current));
    setNewChatModelId((current) =>
      selectNewChatModelId(config.models ?? [], resolvedDefaultModelId, current),
    );
  }, []);

  const loadPendingSummary = useCallback(async () => {
    const response = await fetch('/api/v1/chats/pending-summary?archived=false', { cache: 'no-store' });
    if (!response.ok) {
      throw new Error(`Pending summary request failed with status ${response.status}`);
    }

    const payload = (await response.json()) as { pending_requests_total?: number };
    setPendingRequestsTotal(Math.max(0, payload.pending_requests_total ?? 0));
  }, []);

  const loadChats = useCallback(async () => {
    const currentFetchId = ++fetchIdRef.current;
    setLoading(true);
    setError(null);

    try {
      const query = buildChatsQuery({
        archived: false,
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
        setError('Failed to load inbox data.');
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
    loadPendingSummary().catch(() => setPendingRequestsTotal(0));
  }, [loadPendingSummary]);

  useEffect(() => {
    loadChats().catch(() => setError('Failed to load inbox data.'));
  }, [loadChats]);

  const refreshChats = useCallback(async () => {
    await Promise.all([loadChats(), loadPendingSummary()]);
  }, [loadChats, loadPendingSummary]);

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
        await loadPendingSummary();
      } catch {
        await refreshChats();
      }
    },
    [loadPendingSummary, refreshChats],
  );

  const openNewChatSheet = useCallback(() => {
    setNewChatAgentId(selectNewChatAgentId(agents));
    setNewChatModelId(selectNewChatModelId(models, defaultModelIdForNewChats));
    setNewChatFirstMessage('');
    setNewChatError(null);
    setIsNewChatOpen(true);
  }, [agents, defaultModelIdForNewChats, models]);

  const createNewChat = useCallback(async () => {
    if (!newChatAgentId || !newChatModelId || isCreatingNewChat) {
      return;
    }

    if (!normalizedNewChatFirstMessage) {
      setNewChatError('Enter a first message to create chat.');
      return;
    }

    setIsCreatingNewChat(true);
    setNewChatError(null);
    try {
      const response = await fetch('/api/v1/chats', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          agentIds: [newChatAgentId],
          modelId: newChatModelId,
          firstMessage: normalizedNewChatFirstMessage,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to create chat');
      }

      setIsNewChatOpen(false);
      setNewChatFirstMessage('');
      await refreshChats();
    } catch {
      setNewChatError('Failed to create chat.');
    } finally {
      setIsCreatingNewChat(false);
    }
  }, [
    isCreatingNewChat,
    newChatAgentId,
    newChatModelId,
    normalizedNewChatFirstMessage,
    refreshChats,
  ]);

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

  const archiveChat = useCallback(
    async (chat: Chat) => {
      await mutateChat(
        chat.id,
        () => null,
        () =>
          fetch(`/api/v1/chats/${chat.id}/archive`, {
            method: 'POST',
          }),
      );
    },
    [mutateChat],
  );

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-3xl flex-col bg-background pb-36">
      <header className="sticky top-0 z-20 border-b border-border/70 bg-background/95 px-4 py-3 backdrop-blur-md">
        <div className="grid grid-cols-[36px_1fr_36px] items-center">
          <HamburgerMenu />
          <div className="text-center">
            <h1 className="text-sm font-semibold tracking-wide text-foreground">{appName}</h1>
            <p className="text-xs text-muted-foreground">{pendingLabel(pendingRequestsTotal)}</p>
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
        emptyLabel="No chats match the current filters."
        rowActionLabel="Archive"
        onOpenChat={(chat) => router.push(`/chats/${chat.id}`)}
        onMarkRead={markChatRead}
        onMarkUnread={markChatUnread}
        onTogglePin={togglePin}
        onToggleArchive={archiveChat}
      />

      <div className="liquid-glass fixed inset-x-0 bottom-0 z-30 mx-auto flex w-full max-w-3xl items-center gap-3 px-4 py-3">
        <input
          type="search"
          value={searchInput}
          onChange={(event) => setSearchInput(event.target.value)}
          placeholder="Search chats"
          className="h-11 flex-1 rounded-2xl border border-border/70 bg-background/70 px-4 text-sm outline-none placeholder:text-muted-foreground focus:border-primary/70"
        />
        <button
          type="button"
          aria-label="New chat"
          className="grid h-11 w-11 place-items-center rounded-2xl bg-[hsl(151,100%,43%)] text-black shadow-lg shadow-[hsl(151,100%,43%)]/30"
          onClick={openNewChatSheet}
        >
          <Plus size={19} strokeWidth={2.5} />
        </button>
      </div>

      {isNewChatOpen && (
        <div className="fixed inset-0 z-50 bg-black/50" onClick={() => setIsNewChatOpen(false)}>
          <div
            className="liquid-glass absolute inset-x-0 bottom-0 rounded-t-3xl border-x border-t border-border p-4"
            onClick={(event) => event.stopPropagation()}
          >
            <h2 className="text-sm font-semibold text-foreground">New Chat</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Choose an agent and model, then send your first message.
            </p>
            <div className="mt-4 space-y-3">
              <div>
                <p className="mb-1 text-xs font-medium text-muted-foreground">Agent</p>
                <div className="space-y-2">
                  {agents.map((agent) => {
                    const selected = newChatAgentId === agent.id;
                    return (
                      <button
                        key={agent.id}
                        type="button"
                        className={`flex w-full items-center gap-3 rounded-xl border px-3 py-2 text-left transition ${
                          selected
                            ? 'border-primary/70 bg-primary/10'
                            : 'border-border bg-card hover:border-primary/40'
                        }`}
                        onClick={() => {
                          setNewChatAgentId(agent.id);
                          setNewChatError(null);
                        }}
                      >
                        <Facehash
                          name={agent.id}
                          size={34}
                          interactive={false}
                          className="shrink-0 rounded-lg text-black"
                        />
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-medium text-foreground">{agent.name}</span>
                          <span className="line-clamp-2 text-xs text-muted-foreground">{agent.description}</span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-muted-foreground">Model</span>
                <select
                  className="h-10 w-full rounded-xl border border-border bg-card px-3 text-sm text-foreground outline-none focus:border-primary/70"
                  value={newChatModelId}
                  onChange={(event) => setNewChatModelId(event.target.value)}
                >
                  {models.map((model) => (
                    <option key={model.id} value={model.id}>
                      {model.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-muted-foreground">First message</span>
                <textarea
                  rows={3}
                  value={newChatFirstMessage}
                  onChange={(event) => {
                    setNewChatFirstMessage(event.target.value);
                    if (newChatError) {
                      setNewChatError(null);
                    }
                  }}
                  className="w-full rounded-xl border border-border bg-card px-3 py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-primary/70"
                  placeholder="Start with a message..."
                />
              </label>
              {newChatError && <p className="text-xs text-red-300">{newChatError}</p>}
              <div className="flex gap-2">
                <button
                  type="button"
                  className="h-10 flex-1 rounded-xl border border-border bg-card text-sm font-medium text-foreground"
                  onClick={() => setIsNewChatOpen(false)}
                  disabled={isCreatingNewChat}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="h-10 flex-1 rounded-xl bg-primary text-sm font-semibold text-primary-foreground disabled:opacity-60"
                  onClick={() => void createNewChat()}
                  disabled={isCreatingNewChat || !canSendNewChat}
                >
                  {isCreatingNewChat ? 'Sending...' : 'Send'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
