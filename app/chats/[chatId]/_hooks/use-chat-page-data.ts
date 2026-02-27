import { useCallback, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router';

import { toast } from 'sonner';

import { apiFetch } from '@/src/lib/api-fetch';
import { getFrontendConfigCache, setFrontendConfigCache } from '@/src/lib/frontend-config-cache';
import { buildInlineMessageMedia, mediaSortAsc, normalizeTagInput } from '@/app/chats/[chatId]/_lib/chat-utils';
import type {
  Agent,
  Chat,
  ConfigResponse,
  MediaFilter,
  MediaItem,
  MediaResponse,
  Message,
  MessagesResponse,
  Model,
  PendingAttachment,
  RequestItem,
  RequestsResponse,
  TagSuggestion,
} from '@/app/chats/[chatId]/_lib/types';
import { useChatRecorder } from '@/app/chats/[chatId]/_hooks/use-chat-recorder';
import { useChatRequestActions } from '@/app/chats/[chatId]/_hooks/use-chat-request-actions';
import { useChatSettingsActions } from '@/app/chats/[chatId]/_hooks/use-chat-settings-actions';
import { sortMessagesForFeed, upsertFeedMessage } from '@/src/lib/chat';

type UseChatPageDataArgs = {
  chatId?: string;
  initialChat?: Chat | null;
};

export function useChatPageData({ chatId, initialChat = null }: UseChatPageDataArgs) {
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
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [titleInput, setTitleInput] = useState(initialChat?.title ?? '');
  const [titleError, setTitleError] = useState<string | null>(null);
  const [composerText, setComposerText] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [pendingReply, setPendingReply] = useState(false);
  const [isComposerMenuOpen, setIsComposerMenuOpen] = useState(false);
  const [isMediaGalleryOpen, setIsMediaGalleryOpen] = useState(false);
  const [mediaFilter, setMediaFilter] = useState<MediaFilter>('all');
  const [viewerMediaId, setViewerMediaId] = useState<string | null>(null);
  const [previewFileId, setPreviewFileId] = useState<string | null>(null);
  const [isChatSettingsOpen, setIsChatSettingsOpen] = useState(false);
  const [isChatMenuOpen, setIsChatMenuOpen] = useState(false);
  const [isCameraOpen, setIsCameraOpen] = useState(false);
  const [pendingAttachments, setPendingAttachments] = useState<PendingAttachment[]>([]);
  const [tagInput, setTagInput] = useState('');
  const [tagSuggestions, setTagSuggestions] = useState<TagSuggestion[]>([]);
  const [isLoadingTagSuggestions, setIsLoadingTagSuggestions] = useState(false);
  const [keyboardOffset, setKeyboardOffset] = useState(0);
  const [typingTitle, setTypingTitle] = useState<string | null>(null);

  const titleInputRef = useRef<HTMLInputElement | null>(null);
  const cameraInputRef = useRef<HTMLInputElement | null>(null);
  const photosInputRef = useRef<HTMLInputElement | null>(null);
  const filesInputRef = useRef<HTMLInputElement | null>(null);
  const tagSuggestionsTimerRef = useRef<number | null>(null);
  const feedRef = useRef<HTMLDivElement | null>(null);
  const knownMessageIdsRef = useRef<Set<string>>(new Set());
  const hasOptimisticChatRef = useRef(Boolean(initialChat));
  const swipeRef = useRef({
    active: false,
    startX: 0,
    startY: 0,
    startAt: 0,
    triggered: false,
    moved: false,
  });

  const agentsById = useMemo(() => {
    const map = new Map<string, Agent>();
    for (const agent of agents) {
      map.set(agent.id, agent);
    }
    return map;
  }, [agents]);

  const primaryAgent = chat?.agent_ids[0] ? agentsById.get(chat.agent_ids[0]) : undefined;

  const mediaByMessageId = useMemo(() => {
    const map = new Map<string, MediaItem[]>();
    for (const item of media) {
      if (!item.message_id) {
        continue;
      }

      const current = map.get(item.message_id) ?? [];
      current.push(item);
      map.set(item.message_id, current);
    }

    return map;
  }, [media]);

  const mediaById = useMemo(() => {
    const map = new Map<string, MediaItem>();
    for (const item of media) {
      map.set(item.id, item);
    }
    return map;
  }, [media]);

  const inlineMessageMedia = useMemo(
    () => buildInlineMessageMedia(messages, mediaByMessageId, mediaById),
    [messages, mediaById, mediaByMessageId],
  );

  const sortedMedia = useMemo(() => [...media].sort(mediaSortAsc), [media]);

  const filteredGalleryMedia = useMemo(() => {
    if (mediaFilter === 'all') {
      return sortedMedia;
    }

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

  const scrollToBottom = useCallback((smooth = false) => {
    const feed = feedRef.current;
    if (!feed) {
      return;
    }

    feed.scrollTo({ top: feed.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
  }, []);

  const refreshMessages = useCallback(async () => {
    if (!chatId) {
      return;
    }

    const response = await apiFetch(`/api/v1/chats/${chatId}/messages?limit=200`, { cache: 'no-store' });
    if (!response.ok) {
      throw new Error('Failed to refresh messages');
    }

    const payload = (await response.json()) as MessagesResponse;
    setMessages((current) => {
      const fetched = sortMessagesForFeed(payload.data ?? []);
      const fetchedIds = new Set(fetched.map((m) => m.id));
      const streamingToKeep = current.filter(
        (m) => m.stream_state === 'streaming' && !fetchedIds.has(m.id),
      );
      return streamingToKeep.length > 0
        ? sortMessagesForFeed([...fetched, ...streamingToKeep])
        : fetched;
    });
  }, [chatId]);

  const refreshPendingRequests = useCallback(async () => {
    if (!chatId) {
      return;
    }

    const response = await apiFetch(`/api/v1/chats/${chatId}/requests?status=pending`, { cache: 'no-store' });
    if (!response.ok) {
      throw new Error('Failed to load requests');
    }

    const payload = (await response.json()) as RequestsResponse;
    setPendingRequests(payload.data ?? []);
    setChat((current) => (current ? { ...current, pending_requests_count: payload.data?.length ?? 0 } : current));
  }, [chatId]);

  const refreshMedia = useCallback(async () => {
    if (!chatId) {
      return;
    }

    const allItems: MediaItem[] = [];
    let cursor: string | undefined;

    // Paginate to fetch all media
    for (;;) {
      const url = cursor
        ? `/api/v1/chats/${chatId}/media?cursor=${encodeURIComponent(cursor)}`
        : `/api/v1/chats/${chatId}/media`;
      const response = await apiFetch(url, { cache: 'no-store' });
      if (!response.ok) {
        throw new Error('Failed to load media');
      }

      const payload = (await response.json()) as MediaResponse;
      allItems.push(...(payload.data ?? []));

      if (!payload.hasMore || !payload.nextCursor) break;
      cursor = payload.nextCursor;
    }

    // Merge with existing state to avoid losing locally-added items
    setMedia((current) => {
      const byId = new Map<string, MediaItem>();
      for (const item of current) byId.set(item.id, item);
      for (const item of allItems) byId.set(item.id, item);
      return Array.from(byId.values());
    });
  }, [chatId]);

  const loadData = useCallback(async () => {
    if (!chatId) {
      return;
    }

    if (!hasOptimisticChatRef.current) {
      setLoading(true);
    }
    setError(null);

    try {
      const configPromise = (async () => {
        const existing = getFrontendConfigCache();
        if (existing) {
          return {
            agents: existing.agents,
            models: existing.models,
          } as ConfigResponse;
        }

        const response = await apiFetch('/api/v1/config', { cache: 'no-store' });
        if (!response.ok) {
          throw new Error(`Config request failed with status ${response.status}`);
        }

        return (await response.json()) as ConfigResponse;
      })();

      const [config, chatResponse, messagesResponse, requestsResponse, mediaResponse] = await Promise.all([
        configPromise,
        apiFetch(`/api/v1/chats/${chatId}`, { cache: 'no-store' }),
        apiFetch(`/api/v1/chats/${chatId}/messages?limit=200`, { cache: 'no-store' }),
        apiFetch(`/api/v1/chats/${chatId}/requests?status=pending`, { cache: 'no-store' }),
        apiFetch(`/api/v1/chats/${chatId}/media`, { cache: 'no-store' }),
      ]);

      if (!chatResponse.ok || !messagesResponse.ok || !requestsResponse.ok || !mediaResponse.ok) {
        throw new Error('Failed to load chat data');
      }

      setFrontendConfigCache({
        agents: config.agents ?? [],
        models: config.models ?? [],
      });
      const chatPayload = (await chatResponse.json()) as Chat;
      const messagesPayload = (await messagesResponse.json()) as MessagesResponse;
      const requestsPayload = (await requestsResponse.json()) as RequestsResponse;
      const mediaPayload = (await mediaResponse.json()) as MediaResponse;

      setAgents(config.agents ?? []);
      setModels(config.models ?? []);
      setChat(chatPayload);
      setTitleInput(chatPayload.title);
      setMessages((current) => {
        const fetched = sortMessagesForFeed(messagesPayload.data ?? []);
        const fetchedIds = new Set(fetched.map((m) => m.id));
        const streamingToKeep = current.filter(
          (m) => m.stream_state === 'streaming' && !fetchedIds.has(m.id),
        );
        return streamingToKeep.length > 0
          ? sortMessagesForFeed([...fetched, ...streamingToKeep])
          : fetched;
      });
      setPendingRequests(requestsPayload.data ?? []);
      setMedia(mediaPayload.data ?? []);
    } catch {
      setError('Failed to load chat.');
    } finally {
      hasOptimisticChatRef.current = false;
      setLoading(false);
      setMessagesLoading(false);
    }
  }, [chatId]);

  const goBack = useCallback(() => {
    navigate('/');
  }, [navigate]);

  const settings = useChatSettingsActions({ chat, setChat, setError, goBack });

  const saveTitle = useCallback(async () => {
    if (!chat) {
      return;
    }

    const nextTitle = titleInput.trim();
    if (!nextTitle) {
      setTitleError('Title cannot be empty.');
      return;
    }

    if (nextTitle === chat.title) {
      setIsEditingTitle(false);
      setTitleError(null);
      return;
    }

    setTitleError(null);
    const previousTitle = chat.title;
    setChat((current) => (current ? { ...current, title: nextTitle } : current));
    setIsEditingTitle(false);

    try {
      const response = await apiFetch(`/api/v1/chats/${chat.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: nextTitle }),
      });

      if (!response.ok) {
        throw new Error('Failed to update title');
      }
    } catch {
      setChat((current) => (current ? { ...current, title: previousTitle } : current));
      setTitleInput(previousTitle);
      setTitleError('Failed to update title.');
    }
  }, [chat, titleInput]);

  const allAttachmentsReady = pendingAttachments.length === 0 || pendingAttachments.every((a) => a.status === 'ready');

  const sendMessage = useCallback(async () => {
    if (!chat || isSending) {
      return;
    }

    const content = composerText.trim();
    if (!content && pendingAttachments.length === 0) {
      return;
    }

    // Block send if any attachment is still uploading
    const readyAttachments = pendingAttachments.filter((a) => a.status === 'ready' && a.mediaItem);
    if (pendingAttachments.length > 0 && readyAttachments.length !== pendingAttachments.length) {
      return;
    }

    setIsSending(true);
    try {
      const mediaIds = readyAttachments.map((a) => a.mediaItem!.id);
      const body: Record<string, unknown> = { role: 'user', senderId: 'user:primary' };
      if (content) body.content = content;
      if (mediaIds.length > 0) body.trace = { mediaIds };

      const response = await apiFetch(`/api/v1/chats/${chat.id}/messages`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        throw new Error('Failed to send message');
      }

      const message = (await response.json()) as Message;
      setComposerText('');
      // Revoke object URLs before clearing
      for (const att of pendingAttachments) {
        if (att.localPreviewUrl) URL.revokeObjectURL(att.localPreviewUrl);
      }
      setPendingAttachments([]);
      setMessages((current) => upsertFeedMessage(current, message));
      if (mediaIds.length > 0) await refreshMedia();
      scrollToBottom(true);
    } catch {
      setError('Failed to send message.');
    } finally {
      setIsSending(false);
    }
  }, [chat, composerText, isSending, pendingAttachments, refreshMedia, scrollToBottom]);

  const uploadComposerFiles = useCallback(async (fileList: FileList | null, forcedKind?: 'image' | 'file') => {
    if (!chat || !fileList || fileList.length === 0) {
      return;
    }

    const files = Array.from(fileList);

    // Create local preview entries immediately
    const newEntries: PendingAttachment[] = files.map((file) => {
      const isImage = forcedKind === 'image' || (!forcedKind && file.type.startsWith('image/'));
      const kind = forcedKind ?? (isImage ? 'image' : 'file');
      return {
        localId: `pending-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        localPreviewUrl: isImage ? URL.createObjectURL(file) : null,
        file,
        filename: file.name,
        kind,
        contentType: file.type,
        status: 'uploading' as const,
        mediaItem: null,
      };
    });

    setPendingAttachments((prev) => [...prev, ...newEntries]);
    setIsComposerMenuOpen(false);

    // Upload each file in parallel in the background
    for (const entry of newEntries) {
      const formData = new FormData();
      formData.append('file', entry.file, entry.file.name);
      if (forcedKind) {
        formData.append('kind', forcedKind);
      }

      apiFetch(`/api/v1/chats/${chat.id}/media`, { method: 'POST', body: formData })
        .then(async (uploadResponse) => {
          if (!uploadResponse.ok) throw new Error('Failed to upload media');
          const mediaItem = (await uploadResponse.json()) as MediaItem;
          setPendingAttachments((prev) =>
            prev.map((a) => (a.localId === entry.localId ? { ...a, status: 'ready' as const, mediaItem } : a)),
          );
        })
        .catch(() => {
          toast.error(`Failed to upload ${entry.filename}.`);
          // Remove failed attachment and revoke its URL
          setPendingAttachments((prev) => {
            const failed = prev.find((a) => a.localId === entry.localId);
            if (failed?.localPreviewUrl) URL.revokeObjectURL(failed.localPreviewUrl);
            return prev.filter((a) => a.localId !== entry.localId);
          });
        });
    }
  }, [chat]);

  const removePendingAttachment = useCallback((localId: string) => {
    setPendingAttachments((prev) => {
      const removed = prev.find((a) => a.localId === localId);
      if (removed?.localPreviewUrl) URL.revokeObjectURL(removed.localPreviewUrl);
      return prev.filter((a) => a.localId !== localId);
    });
  }, []);

  const addTagToChat = useCallback(async (rawTag: string) => {
    const normalized = normalizeTagInput(rawTag);
    if (!chat || !normalized || chat.tags.includes(normalized)) {
      return;
    }

    setTagInput('');
    setTagSuggestions([]);
    await settings.patchChatSettings({ tags: [...chat.tags, normalized] });
  }, [chat, settings.patchChatSettings]);

  const removeTagFromChat = useCallback(async (tag: string) => {
    if (!chat) {
      return;
    }

    await settings.patchChatSettings({ tags: chat.tags.filter((item) => item !== tag) });
  }, [chat, settings.patchChatSettings]);

  const getChatId = useCallback(async () => chat?.id ?? null, [chat]);
  const recorder = useChatRecorder({ getChatId, setError, setMessages, setMedia });
  const requests = useChatRequestActions({
    setPendingRequests,
    setChat,
    setError,
    refreshPendingRequests,
  });

  return {
    chatId,
    chat,
    models,
    loading,
    messagesLoading,
    error,
    primaryAgent,
    messages,
    media,
    inlineMessageMedia,
    feedRef,
    keyboardOffset,
    pendingRequests,
    isRequestWidgetOpen: requests.isRequestWidgetOpen,
    requestDrafts: requests.requestDrafts,
    requestErrors: requests.requestErrors,
    resolvingRequestIds: requests.resolvingRequestIds,
    composerText,
    setComposerText,
    isSending,
    pendingReply,
    setPendingReply,
    isComposerMenuOpen,
    allAttachmentsReady,
    pendingAttachments,
    removePendingAttachment,
    isMediaGalleryOpen,
    mediaFilter,
    filteredGalleryMedia,
    galleryImageMedia,
    galleryListMedia,
    viewerMedia,
    previewFile,
    isChatSettingsOpen,
    isChatMenuOpen,
    isCameraOpen,
    isEditingTitle,
    titleInput,
    titleError,
    titleInputRef,
    cameraInputRef,
    photosInputRef,
    filesInputRef,
    isUpdatingChatSettings: settings.isUpdatingChatSettings,
    tagInput,
    tagSuggestions,
    isLoadingTagSuggestions,
    tagSuggestionsTimerRef,
    knownMessageIdsRef,
    swipeRef,
    loadData,
    setTagSuggestions,
    setIsLoadingTagSuggestions,
    typingTitle,
    setTypingTitle,
    setKeyboardOffset,
    setIsEditingTitle,
    setTitleInput,
    setTitleError,
    setMessages,
    setPendingRequests,
    setMedia,
    setChat,
    setError,
    setIsComposerMenuOpen,
    setIsMediaGalleryOpen,
    setMediaFilter,
    setViewerMediaId,
    setPreviewFileId,
    setIsChatSettingsOpen,
    setIsChatMenuOpen,
    setIsCameraOpen,
    setTagInput,
    setIsRequestWidgetOpen: requests.setIsRequestWidgetOpen,
    refreshMessages,
    refreshPendingRequests,
    refreshMedia,
    updateRequestDraft: requests.updateRequestDraft,
    resolvePendingRequest: requests.resolvePendingRequest,
    scrollToBottom,
    saveTitle,
    goBack,
    sendMessage,
    uploadComposerFiles,
    patchChatSettings: settings.patchChatSettings,
    addTagToChat,
    removeTagFromChat,
    archiveCurrentChat: settings.archiveCurrentChat,
    unarchiveCurrentChat: settings.unarchiveCurrentChat,
    ...recorder,
  };
}

export type ChatPageData = ReturnType<typeof useChatPageData>;
