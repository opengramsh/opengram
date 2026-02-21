import { useCallback, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router';

import { toast } from 'sonner';

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
};

export function useChatPageData({ chatId }: UseChatPageDataArgs) {
  const navigate = useNavigate();

  const [agents, setAgents] = useState<Agent[]>([]);
  const [models, setModels] = useState<Model[]>([]);
  const [customStates, setCustomStates] = useState<string[]>([]);
  const [chat, setChat] = useState<Chat | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [media, setMedia] = useState<MediaItem[]>([]);
  const [pendingRequests, setPendingRequests] = useState<RequestItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [titleInput, setTitleInput] = useState('');
  const [titleError, setTitleError] = useState<string | null>(null);
  const [composerText, setComposerText] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [isComposerMenuOpen, setIsComposerMenuOpen] = useState(false);
  const [isMediaGalleryOpen, setIsMediaGalleryOpen] = useState(false);
  const [mediaFilter, setMediaFilter] = useState<MediaFilter>('all');
  const [viewerMediaId, setViewerMediaId] = useState<string | null>(null);
  const [isChatSettingsOpen, setIsChatSettingsOpen] = useState(false);
  const [isChatMenuOpen, setIsChatMenuOpen] = useState(false);
  const [isCameraOpen, setIsCameraOpen] = useState(false);
  const [isUploadingAttachment, setIsUploadingAttachment] = useState(false);
  const [tagInput, setTagInput] = useState('');
  const [tagSuggestions, setTagSuggestions] = useState<TagSuggestion[]>([]);
  const [isLoadingTagSuggestions, setIsLoadingTagSuggestions] = useState(false);
  const [keyboardOffset, setKeyboardOffset] = useState(0);

  const titleInputRef = useRef<HTMLInputElement | null>(null);
  const cameraInputRef = useRef<HTMLInputElement | null>(null);
  const photosInputRef = useRef<HTMLInputElement | null>(null);
  const filesInputRef = useRef<HTMLInputElement | null>(null);
  const tagSuggestionsTimerRef = useRef<number | null>(null);
  const feedRef = useRef<HTMLDivElement | null>(null);
  const knownMessageIdsRef = useRef<Set<string>>(new Set());
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

    const response = await fetch(`/api/v1/chats/${chatId}/messages?limit=200`, { cache: 'no-store' });
    if (!response.ok) {
      throw new Error('Failed to refresh messages');
    }

    const payload = (await response.json()) as MessagesResponse;
    setMessages(sortMessagesForFeed(payload.data ?? []));
  }, [chatId]);

  const refreshPendingRequests = useCallback(async () => {
    if (!chatId) {
      return;
    }

    const response = await fetch(`/api/v1/chats/${chatId}/requests?status=pending`, { cache: 'no-store' });
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

    const response = await fetch(`/api/v1/chats/${chatId}/media`, { cache: 'no-store' });
    if (!response.ok) {
      throw new Error('Failed to load media');
    }

    const payload = (await response.json()) as MediaResponse;
    setMedia(payload.data ?? []);
  }, [chatId]);

  const loadData = useCallback(async () => {
    if (!chatId) {
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const [configResponse, chatResponse, messagesResponse, requestsResponse, mediaResponse] = await Promise.all([
        fetch('/api/v1/config', { cache: 'no-store' }),
        fetch(`/api/v1/chats/${chatId}`, { cache: 'no-store' }),
        fetch(`/api/v1/chats/${chatId}/messages?limit=200`, { cache: 'no-store' }),
        fetch(`/api/v1/chats/${chatId}/requests?status=pending`, { cache: 'no-store' }),
        fetch(`/api/v1/chats/${chatId}/media`, { cache: 'no-store' }),
      ]);

      if (!configResponse.ok || !chatResponse.ok || !messagesResponse.ok || !requestsResponse.ok || !mediaResponse.ok) {
        throw new Error('Failed to load chat data');
      }

      const config = (await configResponse.json()) as ConfigResponse;
      const chatPayload = (await chatResponse.json()) as Chat;
      const messagesPayload = (await messagesResponse.json()) as MessagesResponse;
      const requestsPayload = (await requestsResponse.json()) as RequestsResponse;
      const mediaPayload = (await mediaResponse.json()) as MediaResponse;

      setAgents(config.agents ?? []);
      setModels(config.models ?? []);
      setCustomStates(config.customStates ?? []);
      setChat(chatPayload);
      setTitleInput(chatPayload.title);
      setMessages(sortMessagesForFeed(messagesPayload.data ?? []));
      setPendingRequests(requestsPayload.data ?? []);
      setMedia(mediaPayload.data ?? []);
    } catch {
      setError('Failed to load chat.');
    } finally {
      setLoading(false);
    }
  }, [chatId]);

  const goBack = useCallback(() => {
    if (window.history.length > 1) {
      navigate(-1);
      return;
    }

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
      const response = await fetch(`/api/v1/chats/${chat.id}`, {
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

  const sendMessage = useCallback(async () => {
    if (!chat || isSending) {
      return;
    }

    const content = composerText.trim();
    if (!content) {
      return;
    }

    setIsSending(true);
    try {
      const response = await fetch(`/api/v1/chats/${chat.id}/messages`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ role: 'user', senderId: 'user:primary', content }),
      });

      if (!response.ok) {
        throw new Error('Failed to send message');
      }

      const message = (await response.json()) as Message;
      setComposerText('');
      setMessages((current) => upsertFeedMessage(current, message));
    } catch {
      setError('Failed to send message.');
    } finally {
      setIsSending(false);
    }
  }, [chat, composerText, isSending]);

  const uploadComposerFiles = useCallback(async (fileList: FileList | null, forcedKind?: 'image' | 'file') => {
    if (!chat || !fileList || fileList.length === 0 || isUploadingAttachment) {
      return;
    }

    setIsUploadingAttachment(true);
    try {
      for (const file of Array.from(fileList)) {
        const formData = new FormData();
        formData.append('file', file, file.name);
        if (forcedKind) {
          formData.append('kind', forcedKind);
        }

        const response = await fetch(`/api/v1/chats/${chat.id}/media`, { method: 'POST', body: formData });
        if (!response.ok) {
          throw new Error('Failed to upload media');
        }
      }

      await refreshMedia();
      setIsComposerMenuOpen(false);
    } catch {
      toast.error('Failed to upload attachment.');
    } finally {
      setIsUploadingAttachment(false);
    }
  }, [chat, isUploadingAttachment, refreshMedia]);

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

  const recorder = useChatRecorder({ chat, setError, setMessages, setMedia });
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
    customStates,
    loading,
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
    isComposerMenuOpen,
    isUploadingAttachment,
    isMediaGalleryOpen,
    mediaFilter,
    filteredGalleryMedia,
    galleryImageMedia,
    galleryListMedia,
    viewerMedia,
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
