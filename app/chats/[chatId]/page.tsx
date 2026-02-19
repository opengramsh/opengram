'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Image from 'next/image';
import { Facehash } from 'facehash';
import { ArrowLeft, Camera, ChevronDown, FileText, GalleryVerticalEnd, Images, Mic, Pause, Play, Plus, Send, Settings2, Square } from 'lucide-react';

import {
  applyStreamingChunk,
  applyStreamingComplete,
  resolveEdgeSwipeBack,
  shouldStartEdgeSwipeBack,
  sortMessagesForFeed,
  upsertFeedMessage,
} from '@/src/lib/chat';
import { subscribeToEventsStream, type FrontendStreamEvent } from '@/src/lib/events-stream';

type Agent = {
  id: string;
  name: string;
  description: string;
  avatarUrl?: string;
};

type Model = {
  id: string;
  name: string;
  description: string;
};

type ConfigResponse = {
  agents: Agent[];
  models: Model[];
  customStates: string[];
};

type Chat = {
  id: string;
  title: string;
  tags: string[];
  custom_state: string | null;
  model_id: string;
  pinned: boolean;
  is_archived: boolean;
  agent_ids: string[];
  pending_requests_count: number;
};

type Message = {
  id: string;
  role: 'user' | 'agent' | 'system' | 'tool';
  sender_id: string;
  created_at: string;
  content_final: string | null;
  content_partial: string | null;
  stream_state: 'none' | 'streaming' | 'complete' | 'cancelled';
  trace?: Record<string, unknown> | null;
};

type MessagesResponse = {
  data: Message[];
};

type RequestType = 'choice' | 'text_input' | 'form';

type RequestItem = {
  id: string;
  chat_id: string;
  type: RequestType;
  status: 'pending' | 'resolved' | 'cancelled';
  title: string;
  body: string | null;
  config: Record<string, unknown>;
  created_at: string;
};

type RequestsResponse = {
  data: RequestItem[];
};

type MediaItem = {
  id: string;
  message_id: string | null;
  filename: string;
  created_at: string;
  byte_size: number;
  content_type: string;
  kind: 'image' | 'audio' | 'file';
};

type MediaResponse = {
  data: MediaItem[];
};

type MediaFilter = 'all' | 'image' | 'audio' | 'file';

type TagSuggestion = {
  name: string;
  usage_count: number;
};

type RequestDraftMap = Record<string, Record<string, unknown>>;
type RequestErrorMap = Record<string, string | null>;

type ChoiceVariant = 'primary' | 'secondary' | 'danger';

type ChoiceRequestOption = {
  id: string;
  label: string;
  variant: ChoiceVariant;
};

type ChoiceRequestConfig = {
  options: ChoiceRequestOption[];
  minSelections: number;
  maxSelections: number;
};

type TextInputValidationConfig = {
  minLength?: number;
  maxLength?: number;
  pattern?: string;
};

type TextInputRequestConfig = {
  placeholder: string;
  validation: TextInputValidationConfig;
};

type FormFieldType = 'text' | 'textarea' | 'select' | 'multiselect' | 'checkbox' | 'date';

type FormRequestField = {
  name: string;
  type: FormFieldType;
  label: string;
  required: boolean;
  options: string[];
};

type FormRequestConfig = {
  fields: FormRequestField[];
  submitLabel: string;
};

function messageText(message: Message) {
  if (message.content_final?.trim()) {
    return message.content_final;
  }

  if (message.content_partial?.trim()) {
    return message.content_partial;
  }

  if (message.stream_state === 'streaming') {
    return 'Streaming...';
  }

  return '';
}

function messageBubbleClass(role: Message['role']) {
  if (role === 'user') {
    return 'ml-auto max-w-[86%] rounded-2xl rounded-br-md bg-primary px-3 py-2 text-sm text-primary-foreground';
  }

  if (role === 'agent') {
    return 'mr-auto max-w-[86%] rounded-2xl rounded-bl-md border border-border/70 bg-card px-3 py-2 text-sm text-foreground';
  }

  if (role === 'tool') {
    return 'mx-auto max-w-[92%] rounded-xl border border-emerald-400/40 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-100';
  }

  return 'mx-auto max-w-[92%] rounded-xl border border-border/70 bg-muted px-3 py-2 text-xs text-muted-foreground';
}

function mediaIdFromTrace(message: Message) {
  const mediaId = message.trace && typeof message.trace.mediaId === 'string' ? message.trace.mediaId : null;
  return mediaId;
}

function parseChoiceRequestConfig(config: Record<string, unknown>): ChoiceRequestConfig {
  const options = Array.isArray(config.options)
    ? config.options
        .map((option) => {
          if (!option || typeof option !== 'object') {
            return null;
          }

          const id = typeof (option as { id?: unknown }).id === 'string' ? (option as { id: string }).id.trim() : '';
          const label = typeof (option as { label?: unknown }).label === 'string' ? (option as { label: string }).label.trim() : '';
          if (!id || !label) {
            return null;
          }

          const variantRaw = (option as { variant?: unknown }).variant;
          const variant: ChoiceVariant = variantRaw === 'primary' || variantRaw === 'danger' ? variantRaw : 'secondary';
          return { id, label, variant };
        })
        .filter((option): option is ChoiceRequestOption => option !== null)
    : [];

  const maxSelectionsRaw = config.maxSelections;
  const minSelectionsRaw = config.minSelections;
  const maxSelections = Number.isInteger(maxSelectionsRaw) && (maxSelectionsRaw as number) >= 1
    ? (maxSelectionsRaw as number)
    : 1;
  const minSelectionsCandidate = Number.isInteger(minSelectionsRaw) && (minSelectionsRaw as number) >= 0
    ? (minSelectionsRaw as number)
    : 0;
  const minSelections = Math.min(minSelectionsCandidate, maxSelections);

  return { options, maxSelections, minSelections };
}

function parseTextInputRequestConfig(config: Record<string, unknown>): TextInputRequestConfig {
  const placeholder = typeof config.placeholder === 'string' && config.placeholder.trim()
    ? config.placeholder
    : 'Type your response';
  const validation: TextInputValidationConfig = {};
  const validationRaw = config.validation;
  if (validationRaw && typeof validationRaw === 'object' && !Array.isArray(validationRaw)) {
    const minLengthRaw = (validationRaw as { minLength?: unknown }).minLength;
    const maxLengthRaw = (validationRaw as { maxLength?: unknown }).maxLength;
    const patternRaw = (validationRaw as { pattern?: unknown }).pattern;

    if (Number.isInteger(minLengthRaw) && (minLengthRaw as number) >= 0) {
      validation.minLength = minLengthRaw as number;
    }
    if (Number.isInteger(maxLengthRaw) && (maxLengthRaw as number) > 0) {
      validation.maxLength = maxLengthRaw as number;
    }
    if (
      validation.minLength !== undefined
      && validation.maxLength !== undefined
      && validation.minLength > validation.maxLength
    ) {
      validation.minLength = validation.maxLength;
    }
    if (typeof patternRaw === 'string') {
      try {
        new RegExp(patternRaw);
        validation.pattern = patternRaw;
      } catch {
        // Ignore invalid regex in UI and defer to backend for final validation.
      }
    }
  }

  return { placeholder, validation };
}

function parseFormRequestConfig(config: Record<string, unknown>): FormRequestConfig {
  const fields = Array.isArray(config.fields)
    ? config.fields
        .map((field) => {
          if (!field || typeof field !== 'object') {
            return null;
          }
          const name = typeof (field as { name?: unknown }).name === 'string' ? (field as { name: string }).name.trim() : '';
          if (!name) {
            return null;
          }
          const typeRaw = (field as { type?: unknown }).type;
          if (
            typeRaw !== 'text'
            && typeRaw !== 'textarea'
            && typeRaw !== 'select'
            && typeRaw !== 'multiselect'
            && typeRaw !== 'checkbox'
            && typeRaw !== 'date'
          ) {
            return null;
          }

          const labelRaw = (field as { label?: unknown }).label;
          const label = typeof labelRaw === 'string' && labelRaw.trim() ? labelRaw : name;
          const required = (field as { required?: unknown }).required === true;
          const optionsRaw = (field as { options?: unknown }).options;
          const options = (typeRaw === 'select' || typeRaw === 'multiselect') && Array.isArray(optionsRaw)
            ? optionsRaw.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
            : [];

          return { name, type: typeRaw, label, required, options };
        })
        .filter((field): field is FormRequestField => field !== null)
    : [];

  const submitLabel = typeof config.submitLabel === 'string' && config.submitLabel.trim()
    ? config.submitLabel
    : 'Submit';

  return { fields, submitLabel };
}

function choiceOptionClass(variant: ChoiceVariant, selected: boolean, disabled: boolean) {
  const byVariant: Record<ChoiceVariant, string> = {
    primary: selected
      ? 'border-sky-200 bg-sky-400/30 text-sky-50'
      : 'border-sky-200/50 text-sky-100 hover:bg-sky-300/10',
    secondary: selected
      ? 'border-amber-100 bg-amber-100/20 text-amber-50'
      : 'border-amber-200/40 text-amber-100 hover:bg-amber-100/10',
    danger: selected
      ? 'border-rose-200 bg-rose-500/30 text-rose-50'
      : 'border-rose-200/50 text-rose-100 hover:bg-rose-300/10',
  };

  const disabledClass = disabled ? 'opacity-50' : '';
  return `rounded-lg border px-2 py-1 text-[11px] ${byVariant[variant]} ${disabledClass}`;
}

function normalizeTagInput(value: string) {
  return value.trim();
}

function formatBytes(bytes: number) {
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  if (bytes < 1024 * 1024) {
    return `${Math.round((bytes / 1024) * 10) / 10} KB`;
  }

  return `${Math.round((bytes / (1024 * 1024)) * 10) / 10} MB`;
}

function formatDuration(totalSeconds: number) {
  if (!Number.isFinite(totalSeconds) || totalSeconds < 0) {
    return '0:00';
  }

  const rounded = Math.floor(totalSeconds);
  const minutes = Math.floor(rounded / 60);
  const seconds = rounded % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

function isMicPermissionDenied(error: unknown) {
  if (error instanceof DOMException) {
    return error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError';
  }

  return false;
}

function mediaSortAsc(a: MediaItem, b: MediaItem) {
  if (a.created_at === b.created_at) {
    return a.id.localeCompare(b.id);
  }

  return a.created_at.localeCompare(b.created_at);
}

function buildInlineMessageMedia(messages: Message[], mediaByMessageId: Map<string, MediaItem[]>, mediaById: Map<string, MediaItem>) {
  const map = new Map<string, MediaItem[]>();

  for (const message of messages) {
    const merged: MediaItem[] = [];
    const seenIds = new Set<string>();

    for (const item of mediaByMessageId.get(message.id) ?? []) {
      if (seenIds.has(item.id)) {
        continue;
      }
      seenIds.add(item.id);
      merged.push(item);
    }

    const traceMediaId = mediaIdFromTrace(message);
    if (traceMediaId) {
      const traced = mediaById.get(traceMediaId);
      if (traced && !seenIds.has(traced.id)) {
        merged.push(traced);
      }
    }

    if (merged.length > 0) {
      merged.sort(mediaSortAsc);
      map.set(message.id, merged);
    }
  }

  return map;
}

function InlineAudioPlayer({ item }: { item: MediaItem }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) {
      return;
    }

    const updateTime = () => setCurrentTime(audio.currentTime || 0);
    const updateDuration = () => setDuration(audio.duration || 0);
    const handlePlay = () => setIsPlaying(true);
    const handlePause = () => setIsPlaying(false);
    const handleEnded = () => setIsPlaying(false);

    audio.addEventListener('timeupdate', updateTime);
    audio.addEventListener('loadedmetadata', updateDuration);
    audio.addEventListener('durationchange', updateDuration);
    audio.addEventListener('play', handlePlay);
    audio.addEventListener('pause', handlePause);
    audio.addEventListener('ended', handleEnded);
    setIsPlaying(!audio.paused);

    return () => {
      audio.removeEventListener('timeupdate', updateTime);
      audio.removeEventListener('loadedmetadata', updateDuration);
      audio.removeEventListener('durationchange', updateDuration);
      audio.removeEventListener('play', handlePlay);
      audio.removeEventListener('pause', handlePause);
      audio.removeEventListener('ended', handleEnded);
    };
  }, []);

  const togglePlayback = useCallback(async () => {
    const audio = audioRef.current;
    if (!audio) {
      return;
    }

    if (audio.paused) {
      try {
        await audio.play();
        setIsPlaying(true);
      } catch {
        setIsPlaying(false);
      }
      return;
    }

    audio.pause();
    setIsPlaying(false);
  }, []);

  const handleSeek = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const audio = audioRef.current;
    if (!audio) {
      return;
    }

    const nextTime = Number(event.target.value);
    audio.currentTime = nextTime;
    setCurrentTime(nextTime);
  }, []);

  return (
    <div key={item.id} className="rounded-xl border border-border/70 bg-card/40 p-2.5">
      <audio ref={audioRef} preload="metadata" src={`/api/v1/files/${item.id}`} className="hidden" />
      <div className="flex items-center gap-2">
        <button
          type="button"
          className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-border bg-muted/50 text-foreground"
          aria-label={isPlaying ? `Pause ${item.filename || 'audio'}` : `Play ${item.filename || 'audio'}`}
          onClick={() => void togglePlayback()}
        >
          {isPlaying ? <Pause size={14} /> : <Play size={14} className="translate-x-[1px]" />}
        </button>
        <input
          type="range"
          min={0}
          max={duration > 0 ? duration : 1}
          step={0.1}
          value={Math.min(currentTime, duration > 0 ? duration : 1)}
          onChange={handleSeek}
          aria-label={`Progress ${item.filename || item.id}`}
          className="h-1 w-full accent-primary"
        />
        <p className="w-20 shrink-0 text-right text-[11px] text-muted-foreground">
          {formatDuration(currentTime)} / {formatDuration(duration)}
        </p>
      </div>
    </div>
  );
}

export default function ChatPage() {
  const params = useParams<{ chatId: string }>();
  const chatId = params?.chatId;
  const router = useRouter();

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
  const [isUploadingAttachment, setIsUploadingAttachment] = useState(false);
  const [isUpdatingChatSettings, setIsUpdatingChatSettings] = useState(false);
  const [tagInput, setTagInput] = useState('');
  const [tagSuggestions, setTagSuggestions] = useState<TagSuggestion[]>([]);
  const [isLoadingTagSuggestions, setIsLoadingTagSuggestions] = useState(false);
  const [isRequestWidgetOpen, setIsRequestWidgetOpen] = useState(true);
  const [requestDrafts, setRequestDrafts] = useState<RequestDraftMap>({});
  const [requestErrors, setRequestErrors] = useState<RequestErrorMap>({});
  const [resolvingRequestIds, setResolvingRequestIds] = useState<Record<string, boolean>>({});
  const [keyboardOffset, setKeyboardOffset] = useState(0);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [isUploadingVoiceNote, setIsUploadingVoiceNote] = useState(false);
  const [showMicSettingsPrompt, setShowMicSettingsPrompt] = useState(false);

  const titleInputRef = useRef<HTMLInputElement | null>(null);
  const cameraInputRef = useRef<HTMLInputElement | null>(null);
  const photosInputRef = useRef<HTMLInputElement | null>(null);
  const filesInputRef = useRef<HTMLInputElement | null>(null);
  const tagSuggestionsTimerRef = useRef<number | null>(null);
  const feedRef = useRef<HTMLDivElement | null>(null);
  const recordingTimerRef = useRef<number | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordingChunksRef = useRef<BlobPart[]>([]);
  const recordingStreamRef = useRef<MediaStream | null>(null);
  const recordingSecondsRef = useRef(0);
  const knownMessageIdsRef = useRef<Set<string>>(new Set());
  const swipeRef = useRef<{
    active: boolean;
    startX: number;
    startY: number;
    startAt: number;
    triggered: boolean;
    moved: boolean;
  }>({
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

  const filteredGalleryMedia = useMemo(() => {
    if (mediaFilter === 'all') {
      return media;
    }

    return media.filter((item) => item.kind === mediaFilter);
  }, [media, mediaFilter]);

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
      router.back();
      return;
    }

    router.push('/');
  }, [router]);

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
        body: JSON.stringify({
          role: 'user',
          senderId: 'user:primary',
          content,
        }),
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

  const patchChatSettings = useCallback(
    async (payload: { modelId?: string; tags?: string[]; customState?: string; pinned?: boolean }) => {
      if (!chat || isUpdatingChatSettings) {
        return;
      }

      const previous = chat;
      const optimistic: Chat = {
        ...chat,
        ...(payload.modelId !== undefined ? { model_id: payload.modelId } : {}),
        ...(payload.tags !== undefined ? { tags: payload.tags } : {}),
        ...(payload.customState !== undefined ? { custom_state: payload.customState } : {}),
        ...(payload.pinned !== undefined ? { pinned: payload.pinned } : {}),
      };
      setChat(optimistic);
      setIsUpdatingChatSettings(true);

      try {
        const response = await fetch(`/api/v1/chats/${chat.id}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
        });

        if (!response.ok) {
          throw new Error('Failed to update chat settings');
        }

        const updated = (await response.json()) as Chat;
        setChat(updated);
      } catch {
        setChat(previous);
        setError('Failed to update chat settings.');
      } finally {
        setIsUpdatingChatSettings(false);
      }
    },
    [chat, isUpdatingChatSettings],
  );

  const archiveCurrentChat = useCallback(async () => {
    if (!chat || isUpdatingChatSettings) {
      return;
    }

    setIsUpdatingChatSettings(true);
    try {
      const response = await fetch(`/api/v1/chats/${chat.id}/archive`, {
        method: 'POST',
      });

      if (!response.ok) {
        throw new Error('Failed to archive chat');
      }

      setChat((current) => (current ? { ...current, is_archived: true } : current));
      goBack();
    } catch {
      setError('Failed to archive chat.');
    } finally {
      setIsUpdatingChatSettings(false);
    }
  }, [chat, goBack, isUpdatingChatSettings]);

  const unarchiveCurrentChat = useCallback(async () => {
    if (!chat || isUpdatingChatSettings) {
      return;
    }

    setIsUpdatingChatSettings(true);
    try {
      const response = await fetch(`/api/v1/chats/${chat.id}/unarchive`, {
        method: 'POST',
      });

      if (!response.ok) {
        throw new Error('Failed to unarchive chat');
      }

      setChat((current) => (current ? { ...current, is_archived: false } : current));
    } catch {
      setError('Failed to unarchive chat.');
    } finally {
      setIsUpdatingChatSettings(false);
    }
  }, [chat, isUpdatingChatSettings]);

  const uploadComposerFiles = useCallback(
    async (fileList: FileList | null, forcedKind?: 'image' | 'file') => {
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

          const response = await fetch(`/api/v1/chats/${chat.id}/media`, {
            method: 'POST',
            body: formData,
          });

          if (!response.ok) {
            throw new Error('Failed to upload media');
          }
        }

        await refreshMedia();
        setIsComposerMenuOpen(false);
      } catch {
        setError('Failed to upload attachment.');
      } finally {
        setIsUploadingAttachment(false);
      }
    },
    [chat, isUploadingAttachment, refreshMedia],
  );

  const addTagToChat = useCallback(
    async (rawTag: string) => {
      const normalized = normalizeTagInput(rawTag);
      if (!chat || !normalized || chat.tags.includes(normalized)) {
        return;
      }

      setTagInput('');
      setTagSuggestions([]);
      await patchChatSettings({ tags: [...chat.tags, normalized] });
    },
    [chat, patchChatSettings],
  );

  const removeTagFromChat = useCallback(
    async (tag: string) => {
      if (!chat) {
        return;
      }

      await patchChatSettings({ tags: chat.tags.filter((item) => item !== tag) });
    },
    [chat, patchChatSettings],
  );

  const updateRequestDraft = useCallback((requestId: string, updater: (draft: Record<string, unknown>) => Record<string, unknown>) => {
    setRequestDrafts((current) => {
      const nextDraft = updater(current[requestId] ?? {});
      return {
        ...current,
        [requestId]: nextDraft,
      };
    });
    setRequestErrors((current) => ({
      ...current,
      [requestId]: null,
    }));
  }, []);

  const validateRequestResolutionPayload = useCallback((request: RequestItem): {
    payload: Record<string, unknown> | null;
    error: string | null;
  } => {
    const draft = requestDrafts[request.id] ?? {};

    if (request.type === 'choice') {
      const config = parseChoiceRequestConfig(request.config);
      const selectedIds = Array.isArray(draft.selectedOptionIds)
        ? (draft.selectedOptionIds as unknown[]).filter((item): item is string => typeof item === 'string')
        : [];
      const allowedIds = new Set(config.options.map((option) => option.id));
      const uniqueSelected = Array.from(new Set(selectedIds.filter((id) => allowedIds.has(id))));

      if (uniqueSelected.length < config.minSelections) {
        return {
          payload: null,
          error: config.minSelections === 1
            ? 'Select at least 1 option.'
            : `Select at least ${config.minSelections} options.`,
        };
      }
      if (uniqueSelected.length > config.maxSelections) {
        return {
          payload: null,
          error: `Select no more than ${config.maxSelections} options.`,
        };
      }

      return { payload: { selectedOptionIds: uniqueSelected }, error: null };
    }

    if (request.type === 'text_input') {
      const config = parseTextInputRequestConfig(request.config);
      const text = typeof draft.text === 'string' ? draft.text.trim() : '';
      if (!text) {
        return { payload: null, error: 'Response cannot be empty.' };
      }
      if (config.validation.minLength !== undefined && text.length < config.validation.minLength) {
        return { payload: null, error: `Response must be at least ${config.validation.minLength} characters.` };
      }
      if (config.validation.maxLength !== undefined && text.length > config.validation.maxLength) {
        return { payload: null, error: `Response must be ${config.validation.maxLength} characters or fewer.` };
      }
      if (config.validation.pattern) {
        const regex = new RegExp(config.validation.pattern);
        if (!regex.test(text)) {
          return { payload: null, error: 'Response does not match the required format.' };
        }
      }

      return { payload: { text }, error: null };
    }

    const config = parseFormRequestConfig(request.config);
    const draftValuesRaw = draft.values;
    const draftValues = draftValuesRaw && typeof draftValuesRaw === 'object' && !Array.isArray(draftValuesRaw)
      ? draftValuesRaw as Record<string, unknown>
      : {};
    const values: Record<string, unknown> = {};

    for (const field of config.fields) {
      const raw = draftValues[field.name];
      if (field.type === 'checkbox') {
        if (typeof raw === 'boolean') {
          values[field.name] = raw;
        }
      } else if (field.type === 'multiselect') {
        const selected = Array.isArray(raw) ? raw.filter((item): item is string => typeof item === 'string') : [];
        const normalized = selected.filter((item) => field.options.includes(item));
        if (normalized.length > 0) {
          values[field.name] = normalized;
        }
      } else {
        const text = typeof raw === 'string' ? raw : '';
        if (text.length > 0) {
          values[field.name] = text;
        }
      }
    }

    for (const field of config.fields) {
      if (!field.required) {
        continue;
      }
      const value = values[field.name];
      if (value === undefined) {
        return { payload: null, error: `${field.label} is required.` };
      }
      if (typeof value === 'string' && !value.trim()) {
        return { payload: null, error: `${field.label} is required.` };
      }
      if (Array.isArray(value) && value.length === 0) {
        return { payload: null, error: `${field.label} is required.` };
      }
    }

    return { payload: { values }, error: null };
  }, [requestDrafts]);

  const resolvePendingRequest = useCallback(
    async (request: RequestItem) => {
      if (resolvingRequestIds[request.id]) {
        return;
      }

      const validation = validateRequestResolutionPayload(request);
      if (!validation.payload) {
        setRequestErrors((current) => ({
          ...current,
          [request.id]: validation.error ?? 'Invalid request response.',
        }));
        return;
      }

      const previousPendingRequests = pendingRequests;
      const previousPendingCount = chat?.pending_requests_count ?? 0;
      setRequestErrors((current) => ({ ...current, [request.id]: null }));
      setResolvingRequestIds((current) => ({ ...current, [request.id]: true }));
      setPendingRequests((current) => current.filter((item) => item.id !== request.id));
      setChat((current) =>
        current
          ? {
              ...current,
              pending_requests_count: Math.max(0, current.pending_requests_count - 1),
            }
          : current,
      );

      try {
        const response = await fetch(`/api/v1/requests/${request.id}/resolve`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(validation.payload),
        });

        if (!response.ok) {
          throw new Error('Failed to resolve request');
        }

        setRequestDrafts((current) => {
          const next = { ...current };
          delete next[request.id];
          return next;
        });
        setRequestErrors((current) => {
          const next = { ...current };
          delete next[request.id];
          return next;
        });
      } catch {
        setPendingRequests((current) => {
          if (current.some((item) => item.id === request.id)) {
            return current;
          }
          return previousPendingRequests;
        });
        setChat((current) =>
          current
            ? {
                ...current,
                pending_requests_count: previousPendingCount,
              }
            : current,
        );
        void refreshPendingRequests().catch(() => undefined);
        setError('Failed to resolve request.');
        setRequestErrors((current) => ({
          ...current,
          [request.id]: 'Failed to submit. Try again.',
        }));
      } finally {
        setResolvingRequestIds((current) => {
          const next = { ...current };
          delete next[request.id];
          return next;
        });
      }
    },
    [chat?.pending_requests_count, pendingRequests, refreshPendingRequests, resolvingRequestIds, validateRequestResolutionPayload],
  );

  const uploadVoiceNote = useCallback(
    async (blob: Blob) => {
      if (!chat || blob.size === 0) {
        if (blob.size === 0) {
          setError('Recording was too short. Try again.');
        }
        return;
      }

      setIsUploadingVoiceNote(true);
      try {
        const formData = new FormData();
        formData.append('file', blob, `voice-${Date.now()}.webm`);
        formData.append('kind', 'audio');

        const uploadResponse = await fetch(`/api/v1/chats/${chat.id}/media`, {
          method: 'POST',
          body: formData,
        });

        if (!uploadResponse.ok) {
          throw new Error('Failed to upload voice note');
        }

        const uploadedMedia = (await uploadResponse.json()) as MediaItem;

        let messageResponse: Response;
        try {
          messageResponse = await fetch(`/api/v1/chats/${chat.id}/messages`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              role: 'user',
              senderId: 'user:primary',
              trace: { mediaId: uploadedMedia.id, kind: 'audio' },
            }),
          });
        } catch (error) {
          await fetch(`/api/v1/media/${uploadedMedia.id}`, { method: 'DELETE' }).catch(() => undefined);
          throw error;
        }

        if (!messageResponse.ok) {
          await fetch(`/api/v1/media/${uploadedMedia.id}`, { method: 'DELETE' }).catch(() => undefined);
          throw new Error('Failed to create voice message');
        }

        const createdMessage = (await messageResponse.json()) as Message;
        setMessages((current) => upsertFeedMessage(current, createdMessage));
        setMedia((current) => (current.some((item) => item.id === uploadedMedia.id) ? current : [...current, uploadedMedia]));
      } finally {
        setIsUploadingVoiceNote(false);
      }
    },
    [chat],
  );

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current?.state === 'recording') {
      mediaRecorderRef.current.stop();
    }
  }, []);

  const resetRecordingState = useCallback(() => {
    if (recordingTimerRef.current) {
      window.clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }

    recordingChunksRef.current = [];
    mediaRecorderRef.current = null;
    recordingSecondsRef.current = 0;
    setIsRecording(false);
    setRecordingSeconds(0);

    for (const track of recordingStreamRef.current?.getTracks() ?? []) {
      track.stop();
    }
    recordingStreamRef.current = null;
  }, []);

  const handleMicAction = useCallback(async () => {
    if (isRecording) {
      stopRecording();
      return;
    }

    if (!('mediaDevices' in navigator) || !navigator.mediaDevices.getUserMedia || !('MediaRecorder' in window)) {
      setError('Voice recording is not supported in this browser.');
      return;
    }

    try {
      setError(null);
      setShowMicSettingsPrompt(false);
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      recordingStreamRef.current = stream;
      const recorder = new MediaRecorder(stream);
      mediaRecorderRef.current = recorder;
      recordingChunksRef.current = [];
      recordingSecondsRef.current = 0;

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          recordingChunksRef.current.push(event.data);
        }
      };

      recorder.onstop = () => {
        const blob = new Blob(recordingChunksRef.current, { type: recorder.mimeType || 'audio/webm' });
        resetRecordingState();

        if (blob.size === 0) {
          setError('Recording was too short. Try again.');
          return;
        }

        void uploadVoiceNote(blob).catch(() => {
          setError('Failed to upload voice note.');
        });
      };

      recorder.start(250);
      setIsRecording(true);
      setRecordingSeconds(0);
      recordingTimerRef.current = window.setInterval(() => {
        recordingSecondsRef.current += 1;
        setRecordingSeconds(recordingSecondsRef.current);
      }, 1000);
    } catch (micError) {
      resetRecordingState();

      if (isMicPermissionDenied(micError)) {
        setShowMicSettingsPrompt(true);
        setError('Microphone permission was denied.');
        return;
      }

      setError('Microphone is unavailable. Check browser permissions and try again.');
    }
  }, [isRecording, resetRecordingState, stopRecording, uploadVoiceNote]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  useEffect(() => {
    if (!isChatSettingsOpen || !chat) {
      setTagSuggestions([]);
      return;
    }

    const query = normalizeTagInput(tagInput);
    if (!query) {
      setTagSuggestions([]);
      return;
    }

    if (tagSuggestionsTimerRef.current) {
      window.clearTimeout(tagSuggestionsTimerRef.current);
      tagSuggestionsTimerRef.current = null;
    }

    tagSuggestionsTimerRef.current = window.setTimeout(() => {
      setIsLoadingTagSuggestions(true);
      fetch(`/api/v1/tags/suggestions?q=${encodeURIComponent(query)}&limit=8`, { cache: 'no-store' })
        .then(async (response) => {
          if (!response.ok) {
            throw new Error('Failed to load tag suggestions');
          }

          const payload = (await response.json()) as { data?: TagSuggestion[] };
          const knownTags = new Set(chat.tags);
          const nextSuggestions = (payload.data ?? []).filter((item) => !knownTags.has(item.name));
          setTagSuggestions(nextSuggestions);
        })
        .catch(() => {
          setTagSuggestions([]);
        })
        .finally(() => {
          setIsLoadingTagSuggestions(false);
        });
    }, 180);

    return () => {
      if (tagSuggestionsTimerRef.current) {
        window.clearTimeout(tagSuggestionsTimerRef.current);
        tagSuggestionsTimerRef.current = null;
      }
    };
  }, [chat, isChatSettingsOpen, tagInput]);

  useEffect(() => {
    knownMessageIdsRef.current = new Set(messages.map((message) => message.id));
  }, [messages]);

  useEffect(() => {
    if (!chatId) {
      return;
    }

    const unsubscribe = subscribeToEventsStream((event: FrontendStreamEvent) => {
      const chatFromPayload = event.payload.chatId;
      if (chatFromPayload !== chatId) {
        return;
      }

      if (event.type === 'message.created') {
        const messageId = typeof event.payload.messageId === 'string' ? event.payload.messageId : null;
        const senderId = typeof event.payload.senderId === 'string' ? event.payload.senderId : 'agent:unknown';
        const role = event.payload.role === 'agent'
          || event.payload.role === 'system'
          || event.payload.role === 'tool'
          || event.payload.role === 'user'
          ? event.payload.role
          : 'agent';
        const streamState = event.payload.streamState === 'streaming'
          || event.payload.streamState === 'complete'
          || event.payload.streamState === 'cancelled'
          ? event.payload.streamState
          : 'none';

        if (messageId && streamState === 'streaming') {
          setMessages((current) =>
            upsertFeedMessage(current, {
              id: messageId,
              role,
              sender_id: senderId,
              created_at: event.timestamp,
              content_final: null,
              content_partial: '',
              stream_state: 'streaming',
            }),
          );
          return;
        }

        void refreshMessages();
        return;
      }

      if (event.type === 'message.streaming.chunk') {
        const messageId = typeof event.payload.messageId === 'string' ? event.payload.messageId : null;
        const deltaText = typeof event.payload.deltaText === 'string' ? event.payload.deltaText : null;

        if (messageId && deltaText !== null) {
          if (!knownMessageIdsRef.current.has(messageId)) {
            void refreshMessages();
            return;
          }

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

        if (messageId) {
          if (!knownMessageIdsRef.current.has(messageId)) {
            void refreshMessages();
            return;
          }

          setMessages((current) => applyStreamingComplete(current, messageId, finalText, streamState));
        } else {
          void refreshMessages();
        }
        return;
      }

      if (event.type === 'request.created' || event.type === 'request.resolved' || event.type === 'request.cancelled') {
        void refreshPendingRequests();
        return;
      }

      if (event.type === 'media.attached') {
        void refreshMedia();
      }
    });

    return () => {
      unsubscribe();
    };
  }, [chatId, refreshMedia, refreshMessages, refreshPendingRequests]);

  useEffect(() => {
    if (!isEditingTitle) {
      return;
    }

    titleInputRef.current?.focus();
    titleInputRef.current?.select();
  }, [isEditingTitle]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      scrollToBottom();
    });

    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, [messages.length, scrollToBottom]);

  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) {
      return;
    }

    const updateOffset = () => {
      const nextOffset = Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop);
      setKeyboardOffset(nextOffset);
    };

    updateOffset();
    viewport.addEventListener('resize', updateOffset);
    viewport.addEventListener('scroll', updateOffset);

    return () => {
      viewport.removeEventListener('resize', updateOffset);
      viewport.removeEventListener('scroll', updateOffset);
    };
  }, []);

  useEffect(() => {
    const handleTouchStart = (event: TouchEvent) => {
      const touch = event.touches[0];
      if (!touch) {
        return;
      }

      if (!shouldStartEdgeSwipeBack(touch.clientX)) {
        swipeRef.current.active = false;
        return;
      }

      swipeRef.current.active = true;
      swipeRef.current.startX = touch.clientX;
      swipeRef.current.startY = touch.clientY;
      swipeRef.current.startAt = event.timeStamp;
      swipeRef.current.triggered = false;
      swipeRef.current.moved = false;
    };

    const handleTouchMove = (event: TouchEvent) => {
      if (!swipeRef.current.active || swipeRef.current.triggered) {
        return;
      }

      const touch = event.touches[0];
      if (!touch) {
        return;
      }

      const deltaX = touch.clientX - swipeRef.current.startX;
      const deltaY = touch.clientY - swipeRef.current.startY;

      if (Math.abs(deltaX) > 8) {
        swipeRef.current.moved = true;
      }

      if (swipeRef.current.moved && Math.abs(deltaX) > Math.abs(deltaY)) {
        event.preventDefault();
      }

      const result = resolveEdgeSwipeBack(deltaX, deltaY, event.timeStamp - swipeRef.current.startAt);
      if (result.shouldNavigateBack) {
        swipeRef.current.triggered = true;
        swipeRef.current.active = false;
        goBack();
      }
    };

    const handleTouchEnd = () => {
      swipeRef.current.active = false;
      swipeRef.current.moved = false;
      swipeRef.current.triggered = false;
    };

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

  useEffect(() => {
    return () => {
      if (tagSuggestionsTimerRef.current) {
        window.clearTimeout(tagSuggestionsTimerRef.current);
      }

      resetRecordingState();
    };
  }, [resetRecordingState]);

  return (
    <div className="mx-auto flex min-h-[100dvh] w-full max-w-3xl flex-col bg-background">
      <header className="sticky top-0 z-30 border-b border-border/70 bg-background/95 px-3 py-2 backdrop-blur-md">
        <div className="grid grid-cols-[40px_1fr_auto] items-center gap-2">
          <button
            type="button"
            aria-label="Back"
            className="grid h-9 w-9 place-items-center rounded-xl border border-border bg-card text-foreground"
            onClick={goBack}
          >
            <ArrowLeft size={16} />
          </button>

          <div className="min-w-0 text-center">
            {isEditingTitle ? (
              <input
                ref={titleInputRef}
                value={titleInput}
                onChange={(event) => setTitleInput(event.target.value)}
                onBlur={() => void saveTitle()}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    void saveTitle();
                  }
                  if (event.key === 'Escape') {
                    setTitleInput(chat?.title ?? '');
                    setIsEditingTitle(false);
                    setTitleError(null);
                  }
                }}
                className="h-8 w-full rounded-lg border border-primary/50 bg-card px-2 text-center text-sm font-semibold text-foreground outline-none"
                aria-label="Chat title"
              />
            ) : (
              <button
                type="button"
                className="max-w-full truncate text-sm font-semibold text-foreground"
                onClick={() => {
                  setTitleInput(chat?.title ?? '');
                  setTitleError(null);
                  setIsEditingTitle(true);
                }}
              >
                {chat?.title || 'Chat'}
              </button>
            )}
            {titleError && <p className="truncate pt-0.5 text-[11px] text-red-300">{titleError}</p>}
          </div>

          <div className="flex min-w-0 items-center gap-2 rounded-xl border border-border bg-card px-2 py-1">
            <Facehash
              name={primaryAgent?.name ?? 'Unknown Agent'}
              size={26}
              interactive={false}
              className="rounded-lg text-black"
            />
            <p className="max-w-24 truncate text-xs text-muted-foreground">{primaryAgent?.name ?? 'Unknown Agent'}</p>
          </div>
        </div>
      </header>

      <main
        ref={feedRef}
        className="flex-1 overflow-y-auto px-3 pt-3"
        style={{ paddingBottom: `calc(170px + env(safe-area-inset-bottom, 0px) + ${keyboardOffset}px)` }}
      >
        {loading && <p className="px-2 py-6 text-sm text-muted-foreground">Loading chat...</p>}
        {!loading && error && <p className="px-2 py-6 text-sm text-red-300">{error}</p>}

        {!loading && !error && messages.length === 0 && (
          <p className="px-2 py-6 text-sm text-muted-foreground">No messages yet.</p>
        )}

        {!loading &&
          !error &&
          messages.map((message) => {
            const attachments = inlineMessageMedia.get(message.id) ?? [];
            const imageItems = attachments.filter((item) => item.kind === 'image');
            const audioItems = attachments.filter((item) => item.kind === 'audio');
            const fileItems = attachments.filter((item) => item.kind === 'file');

            return (
              <div key={message.id} className="mb-2 flex w-full">
                <div className={messageBubbleClass(message.role)}>
                  {messageText(message)}
                  {imageItems.length > 0 && (
                    <div className="grid grid-cols-2 gap-2 pt-2">
                      {imageItems.map((item) => (
                        <button
                          key={item.id}
                          type="button"
                          className="block overflow-hidden rounded-lg border border-border/70"
                          aria-label={`Open image ${item.filename || item.id}`}
                          onClick={() => setViewerMediaId(item.id)}
                        >
                          <Image
                            src={`/api/v1/files/${item.id}/thumbnail`}
                            alt={item.filename || 'Image attachment'}
                            width={220}
                            height={160}
                            unoptimized
                            className="h-28 w-full object-cover"
                          />
                        </button>
                      ))}
                    </div>
                  )}
                  {audioItems.length > 0 && (
                    <div className="space-y-2 pt-2">
                      {audioItems.map((item) => (
                        <InlineAudioPlayer key={item.id} item={item} />
                      ))}
                    </div>
                  )}
                  {fileItems.length > 0 && (
                    <div className="space-y-2 pt-2">
                      {fileItems.map((item) => (
                        <a
                          key={item.id}
                          href={`/api/v1/files/${item.id}`}
                          download
                          aria-label={`Download ${item.filename || 'attachment'}`}
                          className="block rounded-lg border border-border/70 bg-muted/30 px-2 py-1.5"
                        >
                          <p className="truncate text-xs text-foreground">{item.filename || 'Attachment'}</p>
                          <p className="text-[11px] text-muted-foreground">{formatBytes(item.byte_size || 0)}</p>
                        </a>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
      </main>

      {chat && pendingRequests.length > 0 && (
        <section
          className="fixed inset-x-0 z-30 mx-auto w-full max-w-3xl px-3"
          style={{ bottom: `calc(76px + env(safe-area-inset-bottom, 0px) + ${keyboardOffset}px)` }}
        >
          <div className="rounded-2xl border border-amber-300/40 bg-amber-500/10 p-3">
            <button
              type="button"
              className="flex w-full items-center justify-between text-left"
              onClick={() => setIsRequestWidgetOpen((current) => !current)}
            >
              <p className="text-xs font-semibold text-amber-100">Pending requests ({pendingRequests.length})</p>
              <ChevronDown size={14} className={isRequestWidgetOpen ? 'text-amber-100' : 'rotate-180 text-amber-100'} />
            </button>
            {isRequestWidgetOpen && (
              <div className="space-y-2 pt-2">
                {pendingRequests.map((request) => {
                  const draft = requestDrafts[request.id] ?? {};
                  const requestError = requestErrors[request.id];
                  const isResolving = Boolean(resolvingRequestIds[request.id]);
                  const choiceConfig = request.type === 'choice' ? parseChoiceRequestConfig(request.config) : null;
                  const textConfig = request.type === 'text_input' ? parseTextInputRequestConfig(request.config) : null;
                  const formConfig = request.type === 'form' ? parseFormRequestConfig(request.config) : null;

                  return (
                    <div key={request.id} className="rounded-xl border border-amber-200/30 bg-amber-950/30 p-2">
                      <p className="text-xs font-semibold text-amber-50">{request.title}</p>
                      {request.body && <p className="pt-1 text-xs text-amber-100/90">{request.body}</p>}

                      {request.type === 'choice' && choiceConfig && (
                        <div className="pt-2">
                          <div className="flex flex-wrap gap-1">
                            {choiceConfig.options.map((option) => {
                              const selectedIds = Array.isArray(draft.selectedOptionIds)
                                ? (draft.selectedOptionIds as unknown[]).filter((item): item is string => typeof item === 'string')
                                : [];
                              const selected = Array.isArray(draft.selectedOptionIds)
                                ? selectedIds.includes(option.id)
                                : false;
                              const isSingleSelect = choiceConfig.maxSelections === 1;
                              const canAddMore = selectedIds.length < choiceConfig.maxSelections;
                              const disabled = !selected && !isSingleSelect && !canAddMore;

                              return (
                                <button
                                  key={option.id}
                                  type="button"
                                  className={choiceOptionClass(option.variant, selected, disabled)}
                                  disabled={disabled || isResolving}
                                  onClick={() => {
                                    updateRequestDraft(request.id, (prev) => {
                                      const prevIds = Array.isArray(prev.selectedOptionIds)
                                        ? (prev.selectedOptionIds as unknown[]).filter((item): item is string => typeof item === 'string')
                                        : [];
                                      let nextIds = prevIds;
                                      if (choiceConfig.maxSelections === 1) {
                                        if (prevIds.includes(option.id) && choiceConfig.minSelections === 0) {
                                          nextIds = [];
                                        } else {
                                          nextIds = [option.id];
                                        }
                                      } else if (prevIds.includes(option.id)) {
                                        const tentative = prevIds.filter((id) => id !== option.id);
                                        nextIds = tentative.length < choiceConfig.minSelections ? prevIds : tentative;
                                      } else if (prevIds.length < choiceConfig.maxSelections) {
                                        nextIds = [...prevIds, option.id];
                                      }

                                      return {
                                        ...prev,
                                        selectedOptionIds: nextIds,
                                      };
                                    });
                                  }}
                                >
                                  {option.label}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      )}

                      {request.type === 'text_input' && textConfig && (
                        <div className="pt-2">
                          <input
                            value={typeof draft.text === 'string' ? draft.text : ''}
                            onChange={(event) => {
                              const value = event.target.value;
                              updateRequestDraft(request.id, (prev) => ({ ...prev, text: value }));
                            }}
                            placeholder={textConfig.placeholder}
                            minLength={textConfig.validation.minLength}
                            maxLength={textConfig.validation.maxLength}
                            pattern={textConfig.validation.pattern}
                            className="h-8 w-full rounded-lg border border-amber-200/40 bg-amber-950/30 px-2 text-xs text-amber-50 outline-none"
                            disabled={isResolving}
                          />
                        </div>
                      )}

                      {request.type === 'form' && formConfig && (
                        <div className="space-y-1 pt-2">
                          {formConfig.fields.map((field) => {
                            const values = typeof draft.values === 'object' && draft.values && !Array.isArray(draft.values)
                              ? draft.values as Record<string, unknown>
                              : {};
                            const fieldValue = values[field.name];

                            if (field.type === 'checkbox') {
                              return (
                                <label key={field.name} className="flex items-center gap-2 text-xs text-amber-50">
                                  <input
                                    type="checkbox"
                                    checked={fieldValue === true}
                                    onChange={(event) => {
                                      updateRequestDraft(request.id, (prev) => {
                                        const prevValues = typeof prev.values === 'object' && prev.values && !Array.isArray(prev.values)
                                          ? prev.values as Record<string, unknown>
                                          : {};
                                        return {
                                          ...prev,
                                          values: { ...prevValues, [field.name]: event.target.checked },
                                        };
                                      });
                                    }}
                                    disabled={isResolving}
                                  />
                                  {field.label}
                                </label>
                              );
                            }

                            if (field.type === 'textarea') {
                              return (
                                <label key={field.name} className="block">
                                  <span className="mb-1 block text-[11px] text-amber-100">
                                    {field.label}
                                    {field.required ? ' *' : ''}
                                  </span>
                                  <textarea
                                    value={typeof fieldValue === 'string' ? fieldValue : ''}
                                    onChange={(event) => {
                                      const value = event.target.value;
                                      updateRequestDraft(request.id, (prev) => {
                                        const prevValues = typeof prev.values === 'object' && prev.values && !Array.isArray(prev.values)
                                          ? prev.values as Record<string, unknown>
                                          : {};
                                        return {
                                          ...prev,
                                          values: { ...prevValues, [field.name]: value },
                                        };
                                      });
                                    }}
                                    rows={3}
                                    className="w-full rounded-lg border border-amber-200/40 bg-amber-950/30 px-2 py-1.5 text-xs text-amber-50 outline-none"
                                    disabled={isResolving}
                                  />
                                </label>
                              );
                            }

                            if (field.type === 'select') {
                              return (
                                <label key={field.name} className="block">
                                  <span className="mb-1 block text-[11px] text-amber-100">
                                    {field.label}
                                    {field.required ? ' *' : ''}
                                  </span>
                                  <select
                                    value={typeof fieldValue === 'string' ? fieldValue : ''}
                                    onChange={(event) => {
                                      const value = event.target.value;
                                      updateRequestDraft(request.id, (prev) => {
                                        const prevValues = typeof prev.values === 'object' && prev.values && !Array.isArray(prev.values)
                                          ? prev.values as Record<string, unknown>
                                          : {};
                                        return {
                                          ...prev,
                                          values: { ...prevValues, [field.name]: value },
                                        };
                                      });
                                    }}
                                    className="h-8 w-full rounded-lg border border-amber-200/40 bg-amber-950/30 px-2 text-xs text-amber-50 outline-none"
                                    disabled={isResolving}
                                  >
                                    <option value="">Select an option</option>
                                    {field.options.map((option) => (
                                      <option key={option} value={option}>{option}</option>
                                    ))}
                                  </select>
                                </label>
                              );
                            }

                            if (field.type === 'multiselect') {
                              const selected = Array.isArray(fieldValue)
                                ? fieldValue.filter((item): item is string => typeof item === 'string')
                                : [];
                              return (
                                <label key={field.name} className="block">
                                  <span className="mb-1 block text-[11px] text-amber-100">
                                    {field.label}
                                    {field.required ? ' *' : ''}
                                  </span>
                                  <select
                                    multiple
                                    value={selected}
                                    onChange={(event) => {
                                      const next = Array.from(event.currentTarget.selectedOptions).map((item) => item.value);
                                      updateRequestDraft(request.id, (prev) => {
                                        const prevValues = typeof prev.values === 'object' && prev.values && !Array.isArray(prev.values)
                                          ? prev.values as Record<string, unknown>
                                          : {};
                                        return {
                                          ...prev,
                                          values: { ...prevValues, [field.name]: next },
                                        };
                                      });
                                    }}
                                    className="w-full rounded-lg border border-amber-200/40 bg-amber-950/30 px-2 py-1.5 text-xs text-amber-50 outline-none"
                                    disabled={isResolving}
                                  >
                                    {field.options.map((option) => (
                                      <option key={option} value={option}>{option}</option>
                                    ))}
                                  </select>
                                </label>
                              );
                            }

                            return (
                              <label key={field.name} className="block">
                                <span className="mb-1 block text-[11px] text-amber-100">
                                  {field.label}
                                  {field.required ? ' *' : ''}
                                </span>
                                <input
                                  value={typeof fieldValue === 'string' ? fieldValue : ''}
                                  onChange={(event) => {
                                    const value = event.target.value;
                                    updateRequestDraft(request.id, (prev) => {
                                      const prevValues = typeof prev.values === 'object' && prev.values && !Array.isArray(prev.values)
                                        ? prev.values as Record<string, unknown>
                                        : {};
                                      return {
                                        ...prev,
                                        values: { ...prevValues, [field.name]: value },
                                      };
                                    });
                                  }}
                                  type={field.type === 'date' ? 'date' : 'text'}
                                  className="h-8 w-full rounded-lg border border-amber-200/40 bg-amber-950/30 px-2 text-xs text-amber-50 outline-none"
                                  disabled={isResolving}
                                />
                              </label>
                            );
                          })}
                        </div>
                      )}

                      {requestError && <p className="pt-2 text-[11px] text-rose-200">{requestError}</p>}
                      <div className="pt-2">
                        <button
                          type="button"
                          className="rounded-lg border border-amber-200/50 px-2 py-1 text-[11px] text-amber-50 disabled:opacity-60"
                          onClick={() => void resolvePendingRequest(request)}
                          disabled={isResolving}
                        >
                          {isResolving ? 'Submitting...' : request.type === 'form' && formConfig ? formConfig.submitLabel : 'Submit'}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </section>
      )}

      <footer
        className="liquid-glass fixed inset-x-0 bottom-0 z-40 mx-auto w-full max-w-3xl border-x border-border px-3 pt-2"
        style={{ paddingBottom: `calc(10px + env(safe-area-inset-bottom, 0px) + ${keyboardOffset}px)` }}
      >
        <div className="flex items-end gap-2">
          <button
            type="button"
            aria-label="Open composer menu"
            className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl border border-border bg-card text-foreground"
            onClick={() => setIsComposerMenuOpen(true)}
          >
            <Plus size={18} />
          </button>

          <textarea
            rows={1}
            value={composerText}
            onChange={(event) => setComposerText(event.target.value)}
            placeholder="Message"
            className="max-h-36 min-h-11 flex-1 resize-none rounded-2xl border border-border bg-card px-3 py-3 text-sm text-foreground outline-none placeholder:text-muted-foreground"
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                void sendMessage();
              }
            }}
          />

          <button
            type="button"
            aria-label="Send message"
            className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-primary text-primary-foreground disabled:opacity-60"
            onClick={() => void sendMessage()}
            disabled={isSending || !composerText.trim()}
          >
            <Send size={16} />
          </button>

          <button
            type="button"
            aria-label="Record voice note"
            className={`grid h-11 w-11 shrink-0 place-items-center rounded-2xl border ${isRecording ? 'border-red-300 bg-red-500/20 text-red-50' : 'border-border bg-card text-foreground'}`}
            onClick={() => void handleMicAction()}
            disabled={isUploadingVoiceNote}
          >
            {isRecording ? <Square size={16} /> : <Mic size={16} />}
          </button>
        </div>
        {isRecording && <p className="px-1 pt-1 text-[11px] text-red-200">Recording {formatDuration(recordingSeconds)}</p>}
        {isUploadingVoiceNote && <p className="px-1 pt-1 text-[11px] text-muted-foreground">Uploading voice note...</p>}
        {showMicSettingsPrompt && (
          <div className="mt-1 rounded-lg border border-amber-400/40 bg-amber-500/10 px-2 py-1.5 text-[11px] text-amber-100">
            <p>Microphone access is blocked. Enable it in your browser or OS settings for this site.</p>
            <button
              type="button"
              className="mt-1 rounded border border-amber-200/40 px-1.5 py-0.5 text-[11px] text-amber-50"
              onClick={() => void handleMicAction()}
            >
              Retry microphone access
            </button>
          </div>
        )}
        <input
          ref={cameraInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={(event) => {
            void uploadComposerFiles(event.currentTarget.files, 'image').finally(() => {
              event.currentTarget.value = '';
            });
          }}
        />
        <input
          ref={photosInputRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(event) => {
            void uploadComposerFiles(event.currentTarget.files, 'image').finally(() => {
              event.currentTarget.value = '';
            });
          }}
        />
        <input
          ref={filesInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(event) => {
            void uploadComposerFiles(event.currentTarget.files).finally(() => {
              event.currentTarget.value = '';
            });
          }}
        />
      </footer>

      {isComposerMenuOpen && (
        <div className="fixed inset-0 z-50 bg-black/45" onClick={() => setIsComposerMenuOpen(false)}>
          <div
            className="liquid-glass absolute inset-x-0 bottom-0 rounded-t-3xl border-x border-t border-border px-4 pb-4 pt-3"
            onClick={(event) => event.stopPropagation()}
          >
            <p className="pb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Composer menu</p>
            <div className="grid grid-cols-1 gap-2">
              <button
                type="button"
                className="flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-2 text-left text-sm text-foreground disabled:opacity-60"
                disabled={isUploadingAttachment}
                onClick={() => cameraInputRef.current?.click()}
              >
                <Camera size={15} /> Attach: Camera
              </button>
              <button
                type="button"
                className="flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-2 text-left text-sm text-foreground disabled:opacity-60"
                disabled={isUploadingAttachment}
                onClick={() => photosInputRef.current?.click()}
              >
                <Images size={15} /> Attach: Photos
              </button>
              <button
                type="button"
                className="flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-2 text-left text-sm text-foreground disabled:opacity-60"
                disabled={isUploadingAttachment}
                onClick={() => filesInputRef.current?.click()}
              >
                <FileText size={15} /> Attach: Files
              </button>
              <button
                type="button"
                className="flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-2 text-left text-sm text-foreground"
                onClick={() => {
                  setIsComposerMenuOpen(false);
                  setIsMediaGalleryOpen(true);
                }}
              >
                <GalleryVerticalEnd size={15} /> Media gallery
              </button>
              <button
                type="button"
                className="flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-2 text-left text-sm text-foreground"
                onClick={() => {
                  setIsComposerMenuOpen(false);
                  setTagInput('');
                  setTagSuggestions([]);
                  setIsChatSettingsOpen(true);
                }}
              >
                <Settings2 size={15} /> Chat settings
              </button>
            </div>
            {isUploadingAttachment && <p className="pt-2 text-xs text-muted-foreground">Uploading attachment...</p>}
          </div>
        </div>
      )}

      {isMediaGalleryOpen && (
        <div className="fixed inset-0 z-50 bg-black/45" onClick={() => setIsMediaGalleryOpen(false)}>
          <div
            role="dialog"
            aria-label="Media gallery"
            className="liquid-glass absolute inset-x-0 bottom-0 max-h-[78dvh] overflow-hidden rounded-t-3xl border-x border-t border-border px-4 pb-4 pt-3"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between pb-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Media gallery</p>
              <button type="button" className="text-xs text-muted-foreground" onClick={() => setIsMediaGalleryOpen(false)}>
                Close
              </button>
            </div>
            <div className="mb-3 flex gap-2 overflow-x-auto pb-1">
              {[
                { id: 'all', label: 'All' },
                { id: 'image', label: 'Images' },
                { id: 'audio', label: 'Audio' },
                { id: 'file', label: 'Files' },
              ].map((filter) => (
                <button
                  key={filter.id}
                  type="button"
                  className={`rounded-full border px-3 py-1 text-xs ${mediaFilter === filter.id ? 'border-primary/60 bg-primary/15 text-foreground' : 'border-border bg-card text-muted-foreground'}`}
                  onClick={() => setMediaFilter(filter.id as 'all' | 'image' | 'audio' | 'file')}
                >
                  {filter.label}
                </button>
              ))}
            </div>
            <div className="max-h-[58dvh] overflow-y-auto">
              {filteredGalleryMedia.length === 0 && (
                <p className="py-4 text-sm text-muted-foreground">No media for this filter.</p>
              )}

              {galleryImageMedia.length > 0 && (
                <div className="mb-3">
                  <div className="grid grid-cols-3 gap-2">
                    {galleryImageMedia.map((item) => (
                        <button
                          key={item.id}
                          type="button"
                          aria-label={`View image ${item.filename || item.id}`}
                          onClick={() => setViewerMediaId(item.id)}
                        >
                          <Image
                            src={`/api/v1/files/${item.id}/thumbnail`}
                            alt={item.filename || 'Image attachment'}
                            width={240}
                            height={240}
                            unoptimized
                            className="h-24 w-full rounded-lg border border-border/70 object-cover"
                          />
                        </button>
                      ))}
                  </div>
                </div>
              )}

              <div className="space-y-2">
                {galleryListMedia.map((item) => (
                    <div key={item.id} className="rounded-xl border border-border bg-card p-2">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate text-sm text-foreground">{item.filename || 'Attachment'}</p>
                          <p className="text-xs text-muted-foreground">
                            {item.kind === 'audio' ? 'Audio' : 'File'} • {formatBytes(item.byte_size || 0)}
                          </p>
                        </div>
                        <a
                          href={`/api/v1/files/${item.id}`}
                          download
                          aria-label={`Download ${item.filename || 'attachment'}`}
                          className="text-xs text-primary"
                        >
                          Download
                        </a>
                      </div>
                      {item.kind === 'audio' && (
                        <div className="mt-2">
                          <InlineAudioPlayer item={item} />
                        </div>
                      )}
                    </div>
                  ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {viewerMedia?.kind === 'image' && (
        <div className="fixed inset-0 z-[70] bg-black/90 px-3 py-6" onClick={() => setViewerMediaId(null)}>
          <div
            role="dialog"
            aria-label="Image viewer"
            className="mx-auto flex h-full w-full max-w-3xl flex-col"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between">
              <p className="truncate text-sm text-white">{viewerMedia.filename || 'Image viewer'}</p>
              <div className="flex items-center gap-3">
                <a
                  href={`/api/v1/files/${viewerMedia.id}`}
                  download
                  aria-label={`Download ${viewerMedia.filename || 'image'}`}
                  className="text-xs text-white/90"
                >
                  Download
                </a>
                <button type="button" className="text-xs text-white/80" onClick={() => setViewerMediaId(null)}>
                  Close
                </button>
              </div>
            </div>
            <div className="relative min-h-0 flex-1 overflow-auto rounded-2xl border border-white/20 bg-black/40">
              <Image
                src={`/api/v1/files/${viewerMedia.id}`}
                alt={viewerMedia.filename || 'Image viewer'}
                fill
                unoptimized
                className="object-contain"
              />
            </div>
          </div>
        </div>
      )}

      {isChatSettingsOpen && chat && (
        <div className="fixed inset-0 z-50 bg-black/45" onClick={() => setIsChatSettingsOpen(false)}>
          <div
            className="liquid-glass absolute inset-x-0 bottom-0 max-h-[82dvh] overflow-y-auto rounded-t-3xl border-x border-t border-border px-4 pb-4 pt-3"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between pb-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Chat settings</p>
              <button type="button" className="text-xs text-muted-foreground" onClick={() => setIsChatSettingsOpen(false)}>
                Close
              </button>
            </div>

            <div className="space-y-3">
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-muted-foreground">Model</span>
                <select
                  className="h-10 w-full rounded-xl border border-border bg-card px-3 text-sm text-foreground outline-none focus:border-primary/70 disabled:opacity-60"
                  value={chat.model_id}
                  disabled={isUpdatingChatSettings}
                  onChange={(event) => {
                    void patchChatSettings({ modelId: event.target.value });
                  }}
                >
                  {models.map((model) => (
                    <option key={model.id} value={model.id}>
                      {model.name}
                    </option>
                  ))}
                </select>
              </label>

              <div>
                <p className="mb-1 text-xs font-medium text-muted-foreground">Tags</p>
                <div className="mb-2 flex flex-wrap gap-1">
                  {chat.tags.map((tag) => (
                    <button
                      key={tag}
                      type="button"
                      className="rounded-full border border-border bg-card px-2 py-1 text-xs text-foreground disabled:opacity-60"
                      disabled={isUpdatingChatSettings}
                      onClick={() => void removeTagFromChat(tag)}
                    >
                      {tag} ×
                    </button>
                  ))}
                  {chat.tags.length === 0 && <p className="text-xs text-muted-foreground">No tags yet.</p>}
                </div>
                <input
                  value={tagInput}
                  onChange={(event) => setTagInput(event.target.value)}
                  placeholder="Add tag and press Enter"
                  className="h-10 w-full rounded-xl border border-border bg-card px-3 text-sm text-foreground outline-none placeholder:text-muted-foreground"
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ',') {
                      event.preventDefault();
                      void addTagToChat(tagInput);
                    }
                  }}
                />
                {isLoadingTagSuggestions && <p className="pt-1 text-xs text-muted-foreground">Loading suggestions...</p>}
                {tagSuggestions.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {tagSuggestions.map((suggestion) => (
                      <button
                        key={suggestion.name}
                        type="button"
                        className="rounded-full border border-border bg-card px-2 py-1 text-xs text-muted-foreground hover:text-foreground"
                        onClick={() => void addTagToChat(suggestion.name)}
                      >
                        {suggestion.name}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {customStates.length > 0 && (
                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-muted-foreground">State</span>
                  <select
                    className="h-10 w-full rounded-xl border border-border bg-card px-3 text-sm text-foreground outline-none focus:border-primary/70 disabled:opacity-60"
                    value={chat.custom_state ?? customStates[0] ?? ''}
                    disabled={isUpdatingChatSettings}
                    onChange={(event) => {
                      void patchChatSettings({ customState: event.target.value });
                    }}
                  >
                    {customStates.map((state) => (
                      <option key={state} value={state}>
                        {state}
                      </option>
                    ))}
                  </select>
                </label>
              )}

              <div className="grid grid-cols-2 gap-2 pt-1">
                <button
                  type="button"
                  className="rounded-xl border border-border bg-card px-3 py-2 text-sm text-foreground disabled:opacity-60"
                  disabled={isUpdatingChatSettings}
                  onClick={() => {
                    void patchChatSettings({ pinned: !chat.pinned });
                  }}
                >
                  {chat.pinned ? 'Unpin' : 'Pin'}
                </button>
                <button
                  type="button"
                  className="rounded-xl border border-border bg-card px-3 py-2 text-sm text-foreground disabled:opacity-60"
                  disabled={isUpdatingChatSettings}
                  onClick={() => {
                    if (chat.is_archived) {
                      void unarchiveCurrentChat();
                    } else {
                      void archiveCurrentChat();
                    }
                  }}
                >
                  {chat.is_archived ? 'Unarchive' : 'Archive'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
