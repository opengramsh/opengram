
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { toast } from 'sonner';

import { buildChatsQuery, sortInboxChats } from '@/src/lib/inbox';
import {
  normalizeFirstMessageForNewChat,
  selectNewChatAgentId,
  selectNewChatModelId,
} from '@/src/lib/new-chat';
import type { Agent, Chat, ChatsResponse, ConfigResponse, Model, SearchResponse } from '@/src/components/chats/types';

type ChatListFilters = {
  searchQuery: string;
  selectedAgentId: string;
};

export type UseChatListOptions = {
  archived: boolean;
  chatsErrorMessage: string;
  onRefreshExtras?: () => Promise<void>;
  onMutationSuccess?: () => Promise<void>;
};

function emptyAsync() {
  return Promise.resolve();
}

export function chatMatchesListFilters(chat: Chat, filters: ChatListFilters, archived: boolean) {
  if (chat.is_archived !== archived) {
    return false;
  }

  if (filters.selectedAgentId && !chat.agent_ids.includes(filters.selectedAgentId)) {
    return false;
  }

  if (filters.searchQuery) {
    return chat.title.toLowerCase().includes(filters.searchQuery.toLowerCase());
  }

  return true;
}

export function useChatList(options: UseChatListOptions) {
  const { archived, chatsErrorMessage, onRefreshExtras = emptyAsync, onMutationSuccess = emptyAsync } = options;
  const [appName, setAppName] = useState('OpenGram');
  const [agents, setAgents] = useState<Agent[]>([]);
  const [models, setModels] = useState<Model[]>([]);
  const [defaultModelIdForNewChats, setDefaultModelIdForNewChats] = useState('');
  const [chats, setChats] = useState<Chat[]>([]);
  const [searchInput, setSearchInput] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedAgentId, setSelectedAgentId] = useState('');
  const [isNewChatOpen, setIsNewChatOpen] = useState(false);
  const [newChatAgentId, setNewChatAgentId] = useState('');
  const [newChatModelId, setNewChatModelId] = useState('');
  const [newChatFirstMessage, setNewChatFirstMessage] = useState('');
  const [newChatError, setNewChatError] = useState<string | null>(null);
  const [isCreatingNewChat, setIsCreatingNewChat] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchResults, setSearchResults] = useState<SearchResponse | null>(null);
  const [isSearchResultsLoading, setIsSearchResultsLoading] = useState(false);
  const fetchIdRef = useRef(0);
  const filtersRef = useRef<ChatListFilters>({
    searchQuery: '',
    selectedAgentId: '',
  });

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

  useEffect(() => {
    filtersRef.current = {
      searchQuery,
      selectedAgentId,
    };
  }, [searchQuery, selectedAgentId]);

  useEffect(() => {
    if (!searchQuery) {
      setSearchResults(null);
      return;
    }

    const controller = new AbortController();
    setIsSearchResultsLoading(true);

    fetch(`/api/v1/search?q=${encodeURIComponent(searchQuery)}&scope=all`, {
      cache: 'no-store',
      signal: controller.signal,
    })
      .then((res) => res.json())
      .then((data: SearchResponse) => setSearchResults(data))
      .catch(() => {/* aborted or failed — leave existing results */})
      .finally(() => setIsSearchResultsLoading(false));

    return () => controller.abort();
  }, [searchQuery]);

  const matchesActiveFilters = useCallback(
    (chat: Chat) => chatMatchesListFilters(chat, filtersRef.current, archived),
    [archived],
  );

  const loadConfig = useCallback(async () => {
    const response = await fetch('/api/v1/config', { cache: 'no-store' });
    if (!response.ok) {
      throw new Error(`Config request failed with status ${response.status}`);
    }

    const config = (await response.json()) as ConfigResponse;
    setAppName(config.appName || 'OpenGram');
    setAgents(config.agents ?? []);
    setModels(config.models ?? []);
    const resolvedDefaultModelId = config.defaultModelIdForNewChats || config.models[0]?.id || '';
    setDefaultModelIdForNewChats(resolvedDefaultModelId);
    setNewChatAgentId((current) => selectNewChatAgentId(config.agents ?? [], current));
    setNewChatModelId((current) =>
      selectNewChatModelId(config.models ?? [], resolvedDefaultModelId, current),
    );
  }, []);

  const loadChats = useCallback(async () => {
    const currentFetchId = ++fetchIdRef.current;
    setLoading(true);
    setError(null);

    try {
      const query = buildChatsQuery({
        archived,
        agentId: selectedAgentId || null,
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
        setError(chatsErrorMessage);
      }
    } finally {
      if (currentFetchId === fetchIdRef.current) {
        setLoading(false);
      }
    }
  }, [archived, chatsErrorMessage, selectedAgentId]);

  useEffect(() => {
    loadConfig().catch(() => setError('Failed to load app config.'));
  }, [loadConfig]);

  useEffect(() => {
    loadChats().catch(() => setError(chatsErrorMessage));
  }, [chatsErrorMessage, loadChats]);

  const refreshChats = useCallback(async () => {
    await Promise.all([loadChats(), onRefreshExtras()]);
  }, [loadChats, onRefreshExtras]);

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
        await onMutationSuccess();
      } catch {
        await refreshChats();
      }
    },
    [onMutationSuccess, refreshChats],
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

  const toggleArchive = useCallback(
    async (chat: Chat) => {
      const endpoint = archived ? 'unarchive' : 'archive';
      const reverseEndpoint = archived ? 'archive' : 'unarchive';
      const label = archived ? 'Chat unarchived' : 'Chat archived';

      setChats((current) => sortInboxChats(current.filter((c) => c.id !== chat.id)));

      toast(label, {
        action: {
          label: 'Undo',
          onClick: () => {
            setChats((current) => sortInboxChats([...current, chat]));
            void fetch(`/api/v1/chats/${chat.id}/${reverseEndpoint}`, { method: 'POST' })
              .then((res) => {
                if (!res.ok) throw new Error('undo failed');
                return onMutationSuccess();
              })
              .catch(() => {
                void refreshChats();
              });
          },
        },
      });

      try {
        const response = await fetch(`/api/v1/chats/${chat.id}/${endpoint}`, { method: 'POST' });
        if (!response.ok) throw new Error('archive failed');
        await onMutationSuccess();
      } catch {
        await refreshChats();
      }
    },
    [archived, onMutationSuccess, refreshChats, setChats],
  );

  const openNewChatSheet = useCallback(() => {
    setNewChatAgentId(selectNewChatAgentId(agents));
    setNewChatModelId(selectNewChatModelId(models, defaultModelIdForNewChats));
    setNewChatFirstMessage('');
    setNewChatError(null);
    setIsNewChatOpen(true);
  }, [agents, defaultModelIdForNewChats, models]);

  const closeNewChatSheet = useCallback(() => {
    setIsNewChatOpen(false);
  }, []);

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

  return {
    appName,
    agents,
    models,
    chats,
    setChats,
    loading,
    error,
    searchInput,
    setSearchInput,
    selectedAgentId,
    setSelectedAgentId,
    agentsById,
    loadChats,
    refreshChats,
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
    matchesActiveFilters,
    searchQuery,
    searchResults,
    isSearchResultsLoading,
  };
}

export type UseChatListReturn = ReturnType<typeof useChatList>;
