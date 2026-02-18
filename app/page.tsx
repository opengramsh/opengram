'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Facehash } from 'facehash';
import { Menu, Pin, Plus } from 'lucide-react';

import {
  buildChatsQuery,
  formatInboxTimestamp,
  sortInboxChats,
} from '@/src/lib/inbox';

type Agent = {
  id: string;
  name: string;
  description: string;
  avatarUrl?: string;
  defaultModelId?: string;
};

type ConfigResponse = {
  appName: string;
  customStates: string[];
  agents: Agent[];
  models: Model[];
  defaultModelIdForNewChats: string;
};

type Model = {
  id: string;
  name: string;
  description: string;
};

type Chat = {
  id: string;
  is_archived: boolean;
  custom_state: string | null;
  title: string;
  tags: string[];
  pinned: boolean;
  agent_ids: string[];
  model_id: string;
  last_message_preview: string | null;
  last_message_role: string | null;
  pending_requests_count: number;
  last_read_at: string | null;
  unread_count: number;
  created_at: string;
  updated_at: string;
  last_message_at: string | null;
};

type ChatsResponse = {
  data: Chat[];
  cursor: {
    next: string | null;
    hasMore: boolean;
  };
};

type ContextMenuState = {
  chatId: string;
  x: number;
  y: number;
};

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
  const [appName, setAppName] = useState('OpenGram');
  const [agents, setAgents] = useState<Agent[]>([]);
  const [models, setModels] = useState<Model[]>([]);
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
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
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
    const fallbackAgentId = config.agents[0]?.id ?? '';
    const fallbackModelId = config.defaultModelIdForNewChats || config.models[0]?.id || '';
    setNewChatAgentId((current) => current || fallbackAgentId);
    setNewChatModelId((current) => current || fallbackModelId);
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
    const fallbackAgentId = agents[0]?.id ?? '';
    const fallbackModelId = models[0]?.id ?? '';
    setNewChatAgentId((current) => current || fallbackAgentId);
    setNewChatModelId((current) => current || fallbackModelId);
    setNewChatError(null);
    setIsNewChatOpen(true);
  }, [agents, models]);

  const createNewChat = useCallback(async () => {
    if (!newChatAgentId || !newChatModelId || isCreatingNewChat) {
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
          firstMessage: newChatFirstMessage.trim() || undefined,
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
  }, [isCreatingNewChat, newChatAgentId, newChatModelId, newChatFirstMessage, refreshChats]);

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

  const unarchiveChat = useCallback(
    async (chat: Chat) => {
      await mutateChat(
        chat.id,
        (current) => ({
          ...current,
          is_archived: false,
        }),
        () =>
          fetch(`/api/v1/chats/${chat.id}/unarchive`, {
            method: 'POST',
          }),
      );
    },
    [mutateChat],
  );

  const chatForMenu = contextMenu ? chats.find((chat) => chat.id === contextMenu.chatId) : undefined;

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-3xl flex-col bg-background pb-36">
      <header className="sticky top-0 z-20 border-b border-border/70 bg-background/95 px-4 py-3 backdrop-blur-md">
        <div className="grid grid-cols-[36px_1fr_36px] items-center">
          <button
            type="button"
            className="grid h-9 w-9 place-items-center rounded-xl border border-border bg-card text-muted-foreground"
            aria-label="Open menu"
          >
            <Menu size={16} />
          </button>
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

      <main className="flex-1 overflow-y-auto px-2 py-2">
        {loading && <p className="px-4 py-6 text-sm text-muted-foreground">Loading inbox...</p>}
        {!loading && error && <p className="px-4 py-6 text-sm text-red-300">{error}</p>}
        {!loading && !error && chats.length === 0 && (
          <p className="px-4 py-8 text-sm text-muted-foreground">No chats match the current filters.</p>
        )}
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
                onArchive={() => archiveChat(chat)}
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
          <button
            type="button"
            className="w-full rounded-xl px-3 py-2 text-left text-sm text-foreground hover:bg-muted"
            onClick={() => {
              setContextMenu(null);
              if (chatForMenu.unread_count > 0) {
                void markChatRead(chatForMenu);
              } else {
                void markChatUnread(chatForMenu);
              }
            }}
          >
            {chatForMenu.unread_count > 0 ? 'Mark as read' : 'Mark as unread'}
          </button>
          <button
            type="button"
            className="w-full rounded-xl px-3 py-2 text-left text-sm text-foreground hover:bg-muted"
            onClick={() => {
              setContextMenu(null);
              void togglePin(chatForMenu);
            }}
          >
            {chatForMenu.pinned ? 'Unpin' : 'Pin'}
          </button>
          <button
            type="button"
            className="w-full rounded-xl px-3 py-2 text-left text-sm text-foreground hover:bg-muted"
            onClick={() => {
              setContextMenu(null);
              if (chatForMenu.is_archived) {
                void unarchiveChat(chatForMenu);
              } else {
                void archiveChat(chatForMenu);
              }
            }}
          >
            {chatForMenu.is_archived ? 'Unarchive' : 'Archive'}
          </button>
        </div>
      )}

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
            <p className="mt-1 text-xs text-muted-foreground">Choose agent, model, and optional first message.</p>
            <div className="mt-4 space-y-3">
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-muted-foreground">Agent</span>
                <select
                  className="h-10 w-full rounded-xl border border-border bg-card px-3 text-sm text-foreground outline-none focus:border-primary/70"
                  value={newChatAgentId}
                  onChange={(event) => setNewChatAgentId(event.target.value)}
                >
                  {agents.map((agent) => (
                    <option key={agent.id} value={agent.id}>
                      {agent.name}
                    </option>
                  ))}
                </select>
              </label>
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
                <span className="mb-1 block text-xs font-medium text-muted-foreground">First message (optional)</span>
                <textarea
                  rows={3}
                  value={newChatFirstMessage}
                  onChange={(event) => setNewChatFirstMessage(event.target.value)}
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
                  disabled={isCreatingNewChat || !newChatAgentId || !newChatModelId}
                >
                  {isCreatingNewChat ? 'Creating...' : 'Create'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

type ChatRowProps = {
  chat: Chat;
  agentName: string;
  onArchive: () => void;
  onLongPress: (point: { x: number; y: number }) => void;
};

function ChatRow({ chat, agentName, onArchive, onLongPress }: ChatRowProps) {
  const [offsetX, setOffsetX] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const dragStartXRef = useRef(0);
  const dragStartYRef = useRef(0);
  const dragBaseOffsetRef = useRef(0);
  const pointerIdRef = useRef<number | null>(null);
  const longPressTimerRef = useRef<number | null>(null);

  const clearLongPressTimer = useCallback(() => {
    if (longPressTimerRef.current !== null) {
      window.clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  }, []);

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (event.pointerType === 'mouse' && event.button !== 0) {
        return;
      }

      pointerIdRef.current = event.pointerId;
      dragStartXRef.current = event.clientX;
      dragStartYRef.current = event.clientY;
      dragBaseOffsetRef.current = offsetX;
      setIsDragging(false);
      event.currentTarget.setPointerCapture(event.pointerId);
      clearLongPressTimer();
      longPressTimerRef.current = window.setTimeout(() => {
        if (!isDragging) {
          onLongPress({ x: event.clientX, y: event.clientY });
        }
      }, 520);
    },
    [clearLongPressTimer, isDragging, offsetX, onLongPress],
  );

  const handlePointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (pointerIdRef.current !== event.pointerId) {
        return;
      }

      const deltaX = event.clientX - dragStartXRef.current;
      const deltaY = event.clientY - dragStartYRef.current;
      const isHorizontal = Math.abs(deltaX) > Math.abs(deltaY) + 6;
      if (!isDragging) {
        if (!isHorizontal) {
          return;
        }

        if (deltaX > 0) {
          clearLongPressTimer();
          return;
        }

        setIsDragging(true);
        clearLongPressTimer();
      }

      const next = Math.max(-132, Math.min(0, dragBaseOffsetRef.current + deltaX));
      setOffsetX(next);
    },
    [clearLongPressTimer, isDragging],
  );

  const handlePointerEnd = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (pointerIdRef.current !== event.pointerId) {
        return;
      }

      pointerIdRef.current = null;
      clearLongPressTimer();
      if (!isDragging) {
        return;
      }

      setIsDragging(false);
      if (offsetX <= -112) {
        setOffsetX(0);
        onArchive();
        return;
      }

      if (offsetX <= -46) {
        setOffsetX(-86);
        return;
      }

      setOffsetX(0);
    },
    [clearLongPressTimer, isDragging, offsetX, onArchive],
  );

  useEffect(() => {
    return () => {
      clearLongPressTimer();
    };
  }, [clearLongPressTimer]);

  const unread = chat.unread_count > 0;
  const unreadBadge =
    chat.unread_count > 1 ? (
      <span className="rounded-full bg-primary px-2 py-0.5 text-[10px] font-semibold text-primary-foreground">
        {chat.unread_count}
      </span>
    ) : chat.unread_count === 1 ? (
      <span className="h-2.5 w-2.5 rounded-full bg-primary" />
    ) : null;

  return (
    <div className="relative mx-2 mb-2 overflow-hidden rounded-2xl">
      <button
        type="button"
        className="absolute inset-y-1 right-1 z-0 rounded-xl bg-red-500/90 px-4 text-xs font-semibold text-white"
        onClick={onArchive}
      >
        Archive
      </button>
      <div
        className="relative z-10 flex cursor-default items-center gap-3 rounded-2xl border border-border/80 bg-card px-3 py-3 transition-transform duration-150"
        style={{ transform: `translateX(${offsetX}px)` }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerEnd}
        onPointerCancel={handlePointerEnd}
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
              <p className="truncate text-xs text-muted-foreground">{agentName}</p>
            </div>
            <div className="flex flex-col items-end gap-1 pt-0.5">
              <p className="text-[11px] text-muted-foreground">{formatInboxTimestamp(chat.last_message_at)}</p>
              {chat.pinned && <Pin size={11} className="text-primary" />}
            </div>
          </div>
          <div className="mt-1 flex items-center justify-between gap-2">
            <p className="truncate text-xs text-muted-foreground">
              {chat.last_message_preview?.trim() || 'No messages yet'}
            </p>
            {unreadBadge}
          </div>
        </div>
      </div>
    </div>
  );
}
