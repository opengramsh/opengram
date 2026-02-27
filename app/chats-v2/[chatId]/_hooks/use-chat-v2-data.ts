import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router';

import { apiFetch, setApiSecret } from '@/src/lib/api-fetch';
import { getFrontendConfigCache, setFrontendConfigCache } from '@/src/lib/frontend-config-cache';
import { sortMessagesForFeed, upsertFeedMessage, applyStreamingChunk, applyStreamingComplete, shouldStartEdgeSwipeBack, resolveEdgeSwipeBack } from '@/src/lib/chat';
import { subscribeToEventsStream, type FrontendStreamEvent } from '@/src/lib/events-stream';
import { subscribeToKeyboardLayout } from '@/src/lib/keyboard-layout';
import { setActiveChatId } from '../_lib/active-chat-idb';

import { buildInlineMessageMedia, mediaSortAsc } from '../_lib/chat-utils';
import { fetchChat, fetchMessages, fetchPendingRequests, fetchAllMedia, markChatRead as apiMarkRead } from '../_lib/api';
import type { Agent, Chat, ConfigResponse, MediaFilter, MediaItem, Message, Model, RequestItem } from '../_lib/types';

const TYPING_EXPIRY_MS = 12_000;
const TITLE_TYPING_SPEED_MS = 40;

type UseChatV2DataArgs = {
  chatId?: string;
  initialChat?: Chat | null;
};

export function useChatV2Data({ chatId, initialChat = null }: UseChatV2DataArgs) {
  const navigate = useNavigate();
  const cachedConfig = getFrontendConfigCache();

  const [agents, setAgents] = useState<Agent[]>(cachedConfig?.agents ?? []);
  const [models, setModels] = useState<Model[]>(cachedConfig?.models ?? []);
  const [chat, setChat] = useState<Chat | null>(initialChat);
  const [messages, setMessages] = useState<Message[]>([]);
  const [media, setMedia] = useState<MediaItem[]>([]);
  const [pendingRequests, setPendingRequests] = useState<RequestItem[]>([]);
  const [loading, setLoading] = useState(!initialChat);
  const [messagesLoading, setMessagesLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pendingReply, setPendingReply] = useState(false);
  const [keyboardOffset, setKeyboardOffset] = useState(0);
  const [typingTitle, setTypingTitle] = useState<string | null>(null);

  // Media gallery state
  const [isMediaGalleryOpen, setIsMediaGalleryOpen] = useState(false);
  const [mediaFilter, setMediaFilter] = useState<MediaFilter>('all');
  const [viewerMediaId, setViewerMediaId] = useState<string | null>(null);
  const [previewFileId, setPreviewFileId] = useState<string | null>(null);

  // Settings state
  const [isChatSettingsOpen, setIsChatSettingsOpen] = useState(false);

  const feedRef = useRef<HTMLDivElement | null>(null);
  const knownMessageIdsRef = useRef<Set<string>>(new Set());
  const hasOptimisticChatRef = useRef(Boolean(initialChat));
  const markReadInFlightRef = useRef<string | null>(null);
  const typingExpiryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const titleTypingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const refreshMediaTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const keyboardOffsetRef = useRef(0);
  const swipeRef = useRef({ active: false, startX: 0, startY: 0, startAt: 0, triggered: false, moved: false });
  const chatTitleRef = useRef<string | undefined>(chat?.title);
  chatTitleRef.current = chat?.title;

  // Computed values
  const agentsById = useMemo(() => {
    const map = new Map<string, Agent>();
    for (const agent of agents) map.set(agent.id, agent);
    return map;
  }, [agents]);

  const primaryAgent = chat?.agent_ids[0] ? agentsById.get(chat.agent_ids[0]) : undefined;

  const mediaByMessageId = useMemo(() => {
    const map = new Map<string, MediaItem[]>();
    for (const item of media) {
      if (!item.message_id) continue;
      const current = map.get(item.message_id) ?? [];
      current.push(item);
      map.set(item.message_id, current);
    }
    return map;
  }, [media]);

  const mediaById = useMemo(() => {
    const map = new Map<string, MediaItem>();
    for (const item of media) map.set(item.id, item);
    return map;
  }, [media]);

  const inlineMessageMedia = useMemo(
    () => buildInlineMessageMedia(messages, mediaByMessageId, mediaById),
    [messages, mediaById, mediaByMessageId],
  );

  const sortedMedia = useMemo(() => [...media].sort(mediaSortAsc), [media]);

  const filteredGalleryMedia = useMemo(() => {
    if (mediaFilter === 'all') return sortedMedia;
    return sortedMedia.filter((item) => item.kind === mediaFilter);
  }, [mediaFilter, sortedMedia]);

  const galleryImageMedia = useMemo(
    () => filteredGalleryMedia.filter((item) => item.kind === 'image'),
    [filteredGalleryMedia],
  );

  const galleryListMedia = useMemo(
    () => filteredGalleryMedia.filter((item) => item.kind === 'audio' || item.kind === 'file'),
    [filteredGalleryMedia],
  );

  const viewerMedia = useMemo(
    () => (viewerMediaId ? mediaById.get(viewerMediaId) : undefined),
    [mediaById, viewerMediaId],
  );

  const previewFile = useMemo(
    () => (previewFileId ? mediaById.get(previewFileId) : undefined),
    [mediaById, previewFileId],
  );

  // Actions
  const scrollToBottom = useCallback((smooth = false) => {
    const feed = feedRef.current;
    if (!feed) return;
    feed.scrollTo({ top: feed.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
  }, []);

  const goBack = useCallback(() => {
    navigate('/v2');
  }, [navigate]);

  const refreshMessages = useCallback(async () => {
    if (!chatId) return;
    const fetched = sortMessagesForFeed(await fetchMessages(chatId));
    setMessages((current) => {
      const fetchedIds = new Set(fetched.map((m) => m.id));
      const streamingToKeep = current.filter((m) => m.stream_state === 'streaming' && !fetchedIds.has(m.id));
      return streamingToKeep.length > 0 ? sortMessagesForFeed([...fetched, ...streamingToKeep]) : fetched;
    });
  }, [chatId]);

  const refreshPendingRequests = useCallback(async () => {
    if (!chatId) return;
    const requests = await fetchPendingRequests(chatId);
    setPendingRequests(requests);
    setChat((current) => (current ? { ...current, pending_requests_count: requests.length } : current));
  }, [chatId]);

  const refreshMedia = useCallback(async () => {
    if (!chatId) return;
    const allItems = await fetchAllMedia(chatId);
    setMedia((current) => {
      const byId = new Map<string, MediaItem>();
      for (const item of current) byId.set(item.id, item);
      for (const item of allItems) byId.set(item.id, item);
      return Array.from(byId.values());
    });
  }, [chatId]);

  const markRead = useCallback(async () => {
    if (!chatId) return;
    await apiMarkRead(chatId).catch(() => {});
  }, [chatId]);

  // Data loading
  const loadData = useCallback(async () => {
    if (!chatId) return;
    if (!hasOptimisticChatRef.current) setLoading(true);
    setError(null);

    try {
      const configPromise = (async () => {
        const existing = getFrontendConfigCache();
        if (existing) return { agents: existing.agents, models: existing.models, security: existing.security } as ConfigResponse;
        const response = await apiFetch('/api/v1/config', { cache: 'no-store' });
        if (!response.ok) throw new Error(`Config request failed with status ${response.status}`);
        return (await response.json()) as ConfigResponse;
      })();

      const [config, chatData, messagesData, requestsData, mediaData] = await Promise.all([
        configPromise,
        fetchChat(chatId),
        fetchMessages(chatId),
        fetchPendingRequests(chatId),
        fetchAllMedia(chatId),
      ]);

      setFrontendConfigCache({
        agents: config.agents ?? [],
        models: config.models ?? [],
        security: { instanceSecret: config.security?.instanceSecret ?? null },
      });
      setApiSecret(config.security?.instanceSecret ?? null);
      setAgents(config.agents ?? []);
      setModels(config.models ?? []);
      setChat(chatData);
      setMessages((current) => {
        const fetched = sortMessagesForFeed(messagesData);
        const fetchedIds = new Set(fetched.map((m) => m.id));
        const streamingToKeep = current.filter((m) => m.stream_state === 'streaming' && !fetchedIds.has(m.id));
        return streamingToKeep.length > 0 ? sortMessagesForFeed([...fetched, ...streamingToKeep]) : fetched;
      });
      setPendingRequests(requestsData);
      setMedia(mediaData);
    } catch {
      setError('Failed to load chat.');
    } finally {
      hasOptimisticChatRef.current = false;
      setLoading(false);
      setMessagesLoading(false);
    }
  }, [chatId]);

  // Effect: load data
  useEffect(() => { void loadData(); }, [loadData]);

  // Effect: track active chat
  useEffect(() => {
    if (!chatId) return;
    const update = () => {
      if (document.visibilityState === 'visible') void setActiveChatId(chatId);
      else void setActiveChatId(null);
    };
    update();
    document.addEventListener('visibilitychange', update);
    return () => {
      document.removeEventListener('visibilitychange', update);
      void setActiveChatId(null);
    };
  }, [chatId]);

  // Effect: mark as read
  useEffect(() => {
    if (!chatId || !chat || chat.id !== chatId) return;
    const unreadCount = Math.max(0, chat.unread_count ?? 0);
    if (unreadCount === 0 || markReadInFlightRef.current === chatId) return;

    markReadInFlightRef.current = chatId;
    void apiFetch(`/api/v1/chats/${chatId}/mark-read`, { method: 'POST' })
      .then((response) => {
        if (!response.ok) throw new Error('Failed to mark chat as read');
        setChat((current) => {
          if (!current || current.id !== chatId) return current;
          return { ...current, unread_count: 0, last_read_at: new Date().toISOString() };
        });
      })
      .catch(() => {})
      .finally(() => {
        if (markReadInFlightRef.current === chatId) markReadInFlightRef.current = null;
      });
  }, [chat, chatId]);

  // Effect: known message IDs tracking
  useEffect(() => {
    knownMessageIdsRef.current = new Set(messages.map((m) => m.id));
  }, [messages]);

  // Effect: SSE subscription
  useEffect(() => {
    if (!chatId) return;

    const unsubscribe = subscribeToEventsStream((event: FrontendStreamEvent) => {
      if (event.payload.chatId !== chatId) return;

      if (event.type === 'chat.typing') {
        setPendingReply(true);
        if (typingExpiryTimerRef.current) clearTimeout(typingExpiryTimerRef.current);
        typingExpiryTimerRef.current = setTimeout(() => {
          setPendingReply(false);
          typingExpiryTimerRef.current = null;
          setMessages((current) => {
            if (!current.some((m) => m.stream_state === 'streaming')) return current;
            return current
              .filter((m) => !(m.stream_state === 'streaming' && !m.content_partial?.trim() && !m.content_final?.trim()))
              .map((m) => m.stream_state === 'streaming' ? { ...m, stream_state: 'cancelled' as const } : m);
          });
        }, TYPING_EXPIRY_MS);
        return;
      }

      if (event.type === 'message.created') {
        const messageId = typeof event.payload.messageId === 'string' ? event.payload.messageId : null;
        const senderId = typeof event.payload.senderId === 'string' ? event.payload.senderId : 'agent:unknown';
        const role = event.payload.role === 'agent' || event.payload.role === 'system' || event.payload.role === 'tool' || event.payload.role === 'user'
          ? event.payload.role : 'agent';
        const streamState = event.payload.streamState === 'streaming' || event.payload.streamState === 'complete' || event.payload.streamState === 'cancelled'
          ? event.payload.streamState : 'none';
        const contentFinal = typeof event.payload.contentFinal === 'string' ? event.payload.contentFinal : null;
        const createdAt = typeof event.payload.createdAt === 'string' ? event.payload.createdAt : event.timestamp;

        if (messageId) {
          knownMessageIdsRef.current.add(messageId);
          setMessages((current) => upsertFeedMessage(current, {
            id: messageId, role, sender_id: senderId, created_at: createdAt,
            content_final: streamState === 'streaming' ? null : contentFinal,
            content_partial: streamState === 'streaming' ? '' : null,
            stream_state: streamState,
          }));
        } else {
          void refreshMessages();
        }

        if (role !== 'user') {
          setPendingReply(false);
          if (typingExpiryTimerRef.current) { clearTimeout(typingExpiryTimerRef.current); typingExpiryTimerRef.current = null; }
        }

        if (role !== 'user' && streamState !== 'streaming' && markReadInFlightRef.current !== chatId) {
          markReadInFlightRef.current = chatId;
          void apiFetch(`/api/v1/chats/${chatId}/mark-read`, { method: 'POST' })
            .catch(() => {})
            .finally(() => { if (markReadInFlightRef.current === chatId) markReadInFlightRef.current = null; });
        }
        return;
      }

      if (event.type === 'message.streaming.chunk') {
        const messageId = typeof event.payload.messageId === 'string' ? event.payload.messageId : null;
        const deltaText = typeof event.payload.deltaText === 'string' ? event.payload.deltaText : null;
        if (messageId && deltaText !== null) {
          if (!knownMessageIdsRef.current.has(messageId)) { void refreshMessages(); return; }
          setMessages((current) => applyStreamingChunk(current, messageId, deltaText));
        } else {
          void refreshMessages();
        }
        return;
      }

      if (event.type === 'message.streaming.complete') {
        const messageId = typeof event.payload.messageId === 'string' ? event.payload.messageId : null;
        const finalText = typeof event.payload.finalText === 'string' ? event.payload.finalText : undefined;
        const streamState = event.payload.streamState === 'cancelled' ? 'cancelled' : 'complete';
        setPendingReply(false);
        if (typingExpiryTimerRef.current) { clearTimeout(typingExpiryTimerRef.current); typingExpiryTimerRef.current = null; }
        if (messageId) {
          if (!knownMessageIdsRef.current.has(messageId)) { void refreshMessages(); return; }
          setMessages((current) => applyStreamingComplete(current, messageId, finalText, streamState));
          if (markReadInFlightRef.current !== chatId) {
            markReadInFlightRef.current = chatId;
            void apiFetch(`/api/v1/chats/${chatId}/mark-read`, { method: 'POST' })
              .catch(() => {})
              .finally(() => { if (markReadInFlightRef.current === chatId) markReadInFlightRef.current = null; });
          }
        } else {
          void refreshMessages();
        }
        return;
      }

      if (event.type === 'chat.updated') {
        void apiFetch(`/api/v1/chats/${chatId}`, { cache: 'no-store' })
          .then(async (res) => {
            if (!res.ok) return;
            const newChat = (await res.json()) as Chat;
            const prevTitle = chatTitleRef.current;
            setChat(newChat);
            if (newChat.title_source === 'auto' && newChat.title !== prevTitle) {
              if (titleTypingIntervalRef.current) clearInterval(titleTypingIntervalRef.current);
              const fullTitle = newChat.title;
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
          })
          .catch(() => {});
        return;
      }

      if (event.type === 'request.created' || event.type === 'request.resolved' || event.type === 'request.cancelled') {
        void refreshPendingRequests();
        return;
      }

      if (event.type === 'media.attached') {
        if (refreshMediaTimerRef.current) clearTimeout(refreshMediaTimerRef.current);
        refreshMediaTimerRef.current = setTimeout(() => {
          refreshMediaTimerRef.current = null;
          void refreshMedia();
        }, 200);
      }
    });

    return () => {
      unsubscribe();
      if (typingExpiryTimerRef.current) { clearTimeout(typingExpiryTimerRef.current); typingExpiryTimerRef.current = null; }
      if (refreshMediaTimerRef.current) { clearTimeout(refreshMediaTimerRef.current); refreshMediaTimerRef.current = null; }
    };
  }, [chatId, refreshMedia, refreshMessages, refreshPendingRequests]);

  // Effect: auto-scroll on new messages
  useEffect(() => {
    const frame = window.requestAnimationFrame(() => scrollToBottom());
    return () => window.cancelAnimationFrame(frame);
  }, [messages.length, scrollToBottom]);

  // Effect: keyboard layout
  useEffect(() => {
    const unsubscribe = subscribeToKeyboardLayout(window, document, ({ keyboardOffset: offset }) => {
      const feed = feedRef.current;
      const nearBottom = feed ? (feed.scrollHeight - feed.scrollTop - feed.clientHeight) <= 80 : false;
      if (offset !== keyboardOffsetRef.current) {
        keyboardOffsetRef.current = offset;
        setKeyboardOffset(offset);
        document.documentElement.style.setProperty('--keyboard-offset', `${offset}px`);
      }
      if (nearBottom) window.requestAnimationFrame(() => scrollToBottom());
    });
    return () => { unsubscribe(); document.documentElement.style.removeProperty('--keyboard-offset'); };
  }, [scrollToBottom]);

  // Effect: edge swipe back (mobile)
  useEffect(() => {
    const handleTouchStart = (e: TouchEvent) => {
      const touch = e.touches[0];
      if (!touch) return;
      if (!shouldStartEdgeSwipeBack(touch.clientX)) { swipeRef.current.active = false; return; }
      swipeRef.current = { active: true, startX: touch.clientX, startY: touch.clientY, startAt: e.timeStamp, triggered: false, moved: false };
    };
    const handleTouchMove = (e: TouchEvent) => {
      if (!swipeRef.current.active || swipeRef.current.triggered) return;
      const touch = e.touches[0];
      if (!touch) return;
      const deltaX = touch.clientX - swipeRef.current.startX;
      const deltaY = touch.clientY - swipeRef.current.startY;
      if (Math.abs(deltaX) > 8) swipeRef.current.moved = true;
      if (swipeRef.current.moved && Math.abs(deltaX) > Math.abs(deltaY)) e.preventDefault();
      const result = resolveEdgeSwipeBack(deltaX, deltaY, e.timeStamp - swipeRef.current.startAt);
      if (result.shouldNavigateBack) {
        swipeRef.current.triggered = true;
        swipeRef.current.active = false;
        goBack();
      }
    };
    const handleTouchEnd = () => { swipeRef.current.active = false; swipeRef.current.moved = false; swipeRef.current.triggered = false; };

    window.addEventListener('touchstart', handleTouchStart, { passive: true });
    window.addEventListener('touchmove', handleTouchMove, { passive: false });
    window.addEventListener('touchend', handleTouchEnd, { passive: true });
    window.addEventListener('touchcancel', handleTouchEnd, { passive: true });
    return () => {
      window.removeEventListener('touchstart', handleTouchStart);
      window.removeEventListener('touchmove', handleTouchMove);
      window.removeEventListener('touchend', handleTouchEnd);
      window.removeEventListener('touchcancel', handleTouchEnd);
    };
  }, [goBack]);

  // Effect: cleanup
  useEffect(() => {
    return () => {
      if (titleTypingIntervalRef.current) clearInterval(titleTypingIntervalRef.current);
    };
  }, []);

  return {
    chatId,
    chat,
    agents,
    models,
    loading,
    messagesLoading,
    error,
    primaryAgent,
    messages,
    media,
    inlineMessageMedia,
    pendingRequests,
    pendingReply,
    keyboardOffset,
    typingTitle,
    feedRef,

    // Gallery / media viewer
    isMediaGalleryOpen, setIsMediaGalleryOpen,
    mediaFilter, setMediaFilter,
    viewerMediaId, setViewerMediaId,
    previewFileId, setPreviewFileId,
    filteredGalleryMedia,
    galleryImageMedia,
    galleryListMedia,
    viewerMedia,
    previewFile,

    // Settings
    isChatSettingsOpen, setIsChatSettingsOpen,

    // Actions
    goBack,
    markRead,
    refreshMessages,
    refreshPendingRequests,
    refreshMedia,
    scrollToBottom,

    // Internals for other hooks
    setMessages,
    setMedia,
    setPendingRequests,
    setPendingReply,
    setChat,
    setError,
  };
}

export type ChatV2DataReturn = ReturnType<typeof useChatV2Data>;
