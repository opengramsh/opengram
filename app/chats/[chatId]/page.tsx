'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Facehash } from 'facehash';
import { ArrowLeft, Camera, ChevronDown, FileText, GalleryVerticalEnd, Images, Mic, Plus, Send, Settings2, Square } from 'lucide-react';

import {
  applyStreamingChunk,
  applyStreamingComplete,
  resolveEdgeSwipeBack,
  shouldStartEdgeSwipeBack,
  sortMessagesForFeed,
  upsertFeedMessage,
} from '@/src/lib/chat';

type Agent = {
  id: string;
  name: string;
  description: string;
  avatarUrl?: string;
};

type ConfigResponse = {
  agents: Agent[];
};

type Chat = {
  id: string;
  title: string;
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
  content_type: string;
  kind: 'image' | 'audio' | 'file';
};

type MediaResponse = {
  data: MediaItem[];
};

type RequestDraftMap = Record<string, Record<string, unknown>>;

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

function optionsFromRequestConfig(config: Record<string, unknown>) {
  if (!Array.isArray(config.options)) {
    return [];
  }

  return config.options
    .map((option) => {
      if (!option || typeof option !== 'object') {
        return null;
      }

      const id = typeof (option as { id?: unknown }).id === 'string' ? (option as { id: string }).id : null;
      const label = typeof (option as { label?: unknown }).label === 'string' ? (option as { label: string }).label : null;
      if (!id || !label) {
        return null;
      }

      return { id, label };
    })
    .filter((option): option is { id: string; label: string } => option !== null);
}

function fieldsFromRequestConfig(config: Record<string, unknown>) {
  if (!Array.isArray(config.fields)) {
    return [];
  }

  return config.fields
    .map((field) => {
      if (!field || typeof field !== 'object') {
        return null;
      }

      const id = typeof (field as { id?: unknown }).id === 'string' ? (field as { id: string }).id : null;
      if (!id) {
        return null;
      }

      const label = typeof (field as { label?: unknown }).label === 'string' ? (field as { label: string }).label : id;
      const inputType = (field as { inputType?: unknown }).inputType;
      const type = inputType === 'number' || inputType === 'email' ? inputType : 'text';

      return { id, label, type };
    })
    .filter((field): field is { id: string; label: string; type: string } => field !== null);
}

function arrayBufferToBase64(value: ArrayBuffer) {
  const bytes = new Uint8Array(value);
  let binary = '';

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return window.btoa(binary);
}

export default function ChatPage() {
  const params = useParams<{ chatId: string }>();
  const chatId = params?.chatId;
  const router = useRouter();

  const [agents, setAgents] = useState<Agent[]>([]);
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
  const [isRequestWidgetOpen, setIsRequestWidgetOpen] = useState(true);
  const [requestDrafts, setRequestDrafts] = useState<RequestDraftMap>({});
  const [resolvingRequestId, setResolvingRequestId] = useState<string | null>(null);
  const [keyboardOffset, setKeyboardOffset] = useState(0);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);

  const titleInputRef = useRef<HTMLInputElement | null>(null);
  const feedRef = useRef<HTMLDivElement | null>(null);
  const recordingTimerRef = useRef<number | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordingChunksRef = useRef<BlobPart[]>([]);
  const recordingStreamRef = useRef<MediaStream | null>(null);
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

  const resolvePendingRequest = useCallback(
    async (request: RequestItem) => {
      if (resolvingRequestId) {
        return;
      }

      const draft = requestDrafts[request.id] ?? {};
      let payload: Record<string, unknown>;

      if (request.type === 'choice') {
        const selected = Array.isArray(draft.selectedOptionIds) ? (draft.selectedOptionIds as string[]) : [];
        payload = { selectedOptionIds: selected };
      } else if (request.type === 'text_input') {
        payload = { text: typeof draft.text === 'string' ? draft.text : '' };
      } else {
        payload = { values: typeof draft.values === 'object' && draft.values ? draft.values : {} };
      }

      setResolvingRequestId(request.id);
      try {
        const response = await fetch(`/api/v1/requests/${request.id}/resolve`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
        });

        if (!response.ok) {
          throw new Error('Failed to resolve request');
        }

        setPendingRequests((current) => current.filter((item) => item.id !== request.id));
        setChat((current) =>
          current
            ? {
                ...current,
                pending_requests_count: Math.max(0, current.pending_requests_count - 1),
              }
            : current,
        );
      } catch {
        setError('Failed to resolve request.');
      } finally {
        setResolvingRequestId(null);
      }
    },
    [requestDrafts, resolvingRequestId],
  );

  const uploadVoiceNote = useCallback(
    async (blob: Blob) => {
      if (!chat) {
        return;
      }

      const messageResponse = await fetch(`/api/v1/chats/${chat.id}/messages`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          role: 'user',
          senderId: 'user:primary',
          content: 'Voice note',
        }),
      });

      if (!messageResponse.ok) {
        throw new Error('Failed to create voice message');
      }

      const createdMessage = (await messageResponse.json()) as Message;

      const uploadResponse = await fetch(`/api/v1/chats/${chat.id}/media`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          fileName: `voice-${Date.now()}.webm`,
          contentType: blob.type || 'audio/webm',
          base64Data: arrayBufferToBase64(await blob.arrayBuffer()),
          kind: 'audio',
          messageId: createdMessage.id,
        }),
      });

      if (!uploadResponse.ok) {
        throw new Error('Failed to upload voice note');
      }

      const uploadedMedia = (await uploadResponse.json()) as MediaItem;
      setMessages((current) =>
        upsertFeedMessage(current, {
          ...createdMessage,
          trace: { ...(createdMessage.trace ?? {}), mediaId: uploadedMedia.id, kind: 'audio' },
        }),
      );
      setMedia((current) => [...current, uploadedMedia]);
    },
    [chat],
  );

  const stopRecording = useCallback(() => {
    mediaRecorderRef.current?.stop();
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
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      recordingStreamRef.current = stream;
      const recorder = new MediaRecorder(stream);
      mediaRecorderRef.current = recorder;
      recordingChunksRef.current = [];

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          recordingChunksRef.current.push(event.data);
        }
      };

      recorder.onstop = () => {
        const chunks = recordingChunksRef.current;
        recordingChunksRef.current = [];
        const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' });

        if (recordingTimerRef.current) {
          window.clearInterval(recordingTimerRef.current);
          recordingTimerRef.current = null;
        }

        setIsRecording(false);
        setRecordingSeconds(0);

        for (const track of stream.getTracks()) {
          track.stop();
        }

        void uploadVoiceNote(blob).catch(() => {
          setError('Failed to upload voice note.');
        });
      };

      recorder.start(250);
      setIsRecording(true);
      setRecordingSeconds(0);
      recordingTimerRef.current = window.setInterval(() => {
        setRecordingSeconds((current) => current + 1);
      }, 1000);
    } catch {
      setError('Microphone permission is required to record voice notes.');
    }
  }, [isRecording, stopRecording, uploadVoiceNote]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  useEffect(() => {
    if (!chatId) {
      return;
    }

    const stream = new EventSource('/api/v1/events/stream?ephemeral=true');
    const eventTypes = ['message.created', 'message.streaming.chunk', 'message.streaming.complete', 'request.created', 'request.resolved', 'request.cancelled', 'media.attached'];

    const handleEvent = (event: Event) => {
      const custom = event as MessageEvent<string>;
      let payload: { type?: string; payload?: Record<string, unknown> } | null = null;

      try {
        payload = JSON.parse(custom.data) as { type?: string; payload?: Record<string, unknown> };
      } catch {
        payload = null;
      }

      const chatFromPayload = payload?.payload?.chatId;
      if (chatFromPayload !== chatId) {
        return;
      }

      if (payload?.type === 'message.created') {
        void refreshMessages();
        return;
      }

      if (payload?.type === 'message.streaming.chunk') {
        const messageId = typeof payload.payload?.messageId === 'string' ? payload.payload.messageId : null;
        const deltaText = typeof payload.payload?.deltaText === 'string' ? payload.payload.deltaText : null;

        if (messageId && deltaText !== null) {
          setMessages((current) => applyStreamingChunk(current, messageId, deltaText));
        } else {
          void refreshMessages();
        }
        return;
      }

      if (payload?.type === 'message.streaming.complete') {
        const messageId = typeof payload.payload?.messageId === 'string' ? payload.payload.messageId : null;
        const finalText = typeof payload.payload?.finalText === 'string' ? payload.payload.finalText : undefined;

        if (messageId) {
          setMessages((current) => applyStreamingComplete(current, messageId, finalText));
        } else {
          void refreshMessages();
        }
        return;
      }

      if (payload?.type === 'request.created' || payload?.type === 'request.resolved' || payload?.type === 'request.cancelled') {
        void refreshPendingRequests();
        return;
      }

      if (payload?.type === 'media.attached') {
        void refreshMedia();
      }
    };

    for (const type of eventTypes) {
      stream.addEventListener(type, handleEvent);
    }

    return () => {
      for (const type of eventTypes) {
        stream.removeEventListener(type, handleEvent);
      }
      stream.close();
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
      if (recordingTimerRef.current) {
        window.clearInterval(recordingTimerRef.current);
      }

      for (const track of recordingStreamRef.current?.getTracks() ?? []) {
        track.stop();
      }
    };
  }, []);

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
            const inlineMedia = mediaByMessageId.get(message.id) ?? [];
            const traceMedia = mediaIdFromTrace(message);
            const tracedMediaItem = traceMedia ? mediaById.get(traceMedia) : undefined;
            const audioItems = [
              ...inlineMedia.filter((item) => item.kind === 'audio'),
              ...(tracedMediaItem && tracedMediaItem.kind === 'audio' ? [tracedMediaItem] : []),
            ];

            return (
              <div key={message.id} className="mb-2 flex w-full">
                <div className={messageBubbleClass(message.role)}>
                  {messageText(message)}
                  {audioItems.length > 0 && (
                    <div className="pt-2">
                      <audio controls className="h-8 w-full max-w-xs" src={`/api/v1/files/${audioItems[0]?.id}`} />
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
                  const options = optionsFromRequestConfig(request.config);
                  const fields = fieldsFromRequestConfig(request.config);

                  return (
                    <div key={request.id} className="rounded-xl border border-amber-200/30 bg-amber-950/30 p-2">
                      <p className="text-xs font-semibold text-amber-50">{request.title}</p>
                      {request.body && <p className="pt-1 text-xs text-amber-100/90">{request.body}</p>}

                      {request.type === 'choice' && (
                        <div className="pt-2">
                          <div className="flex flex-wrap gap-1">
                            {options.map((option) => {
                              const selected = Array.isArray(draft.selectedOptionIds)
                                ? (draft.selectedOptionIds as string[]).includes(option.id)
                                : false;

                              return (
                                <button
                                  key={option.id}
                                  type="button"
                                  className={`rounded-lg border px-2 py-1 text-[11px] ${selected ? 'border-amber-100 bg-amber-100/20 text-amber-50' : 'border-amber-200/40 text-amber-100'}`}
                                  onClick={() => {
                                    setRequestDrafts((current) => {
                                      const prev = current[request.id] ?? {};
                                      const prevIds = Array.isArray(prev.selectedOptionIds)
                                        ? (prev.selectedOptionIds as string[])
                                        : [];
                                      const nextIds = prevIds.includes(option.id)
                                        ? prevIds.filter((id) => id !== option.id)
                                        : [...prevIds, option.id];

                                      return {
                                        ...current,
                                        [request.id]: { ...prev, selectedOptionIds: nextIds },
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

                      {request.type === 'text_input' && (
                        <div className="pt-2">
                          <input
                            value={typeof draft.text === 'string' ? draft.text : ''}
                            onChange={(event) => {
                              const value = event.target.value;
                              setRequestDrafts((current) => ({
                                ...current,
                                [request.id]: { ...(current[request.id] ?? {}), text: value },
                              }));
                            }}
                            placeholder="Type your response"
                            className="h-8 w-full rounded-lg border border-amber-200/40 bg-amber-950/30 px-2 text-xs text-amber-50 outline-none"
                          />
                        </div>
                      )}

                      {request.type === 'form' && (
                        <div className="space-y-1 pt-2">
                          {fields.map((field) => (
                            <input
                              key={field.id}
                              value={
                                typeof (draft.values as Record<string, unknown> | undefined)?.[field.id] === 'string'
                                  ? ((draft.values as Record<string, unknown>)[field.id] as string)
                                  : ''
                              }
                              onChange={(event) => {
                                const value = event.target.value;
                                setRequestDrafts((current) => {
                                  const prev = current[request.id] ?? {};
                                  const prevValues = typeof prev.values === 'object' && prev.values
                                    ? (prev.values as Record<string, unknown>)
                                    : {};
                                  return {
                                    ...current,
                                    [request.id]: {
                                      ...prev,
                                      values: { ...prevValues, [field.id]: value },
                                    },
                                  };
                                });
                              }}
                              placeholder={field.label}
                              type={field.type}
                              className="h-8 w-full rounded-lg border border-amber-200/40 bg-amber-950/30 px-2 text-xs text-amber-50 outline-none"
                            />
                          ))}
                        </div>
                      )}

                      <div className="pt-2">
                        <button
                          type="button"
                          className="rounded-lg border border-amber-200/50 px-2 py-1 text-[11px] text-amber-50 disabled:opacity-60"
                          onClick={() => void resolvePendingRequest(request)}
                          disabled={resolvingRequestId === request.id}
                        >
                          {resolvingRequestId === request.id ? 'Submitting...' : 'Submit'}
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
          >
            {isRecording ? <Square size={16} /> : <Mic size={16} />}
          </button>
        </div>
        {isRecording && <p className="px-1 pt-1 text-[11px] text-red-200">Recording {recordingSeconds}s</p>}
      </footer>

      {isComposerMenuOpen && (
        <div className="fixed inset-0 z-50 bg-black/45" onClick={() => setIsComposerMenuOpen(false)}>
          <div
            className="liquid-glass absolute inset-x-0 bottom-0 rounded-t-3xl border-x border-t border-border px-4 pb-4 pt-3"
            onClick={(event) => event.stopPropagation()}
          >
            <p className="pb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Composer menu</p>
            <div className="grid grid-cols-1 gap-2">
              <button type="button" className="flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-2 text-left text-sm text-foreground">
                <Camera size={15} /> Attach: Camera
              </button>
              <button type="button" className="flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-2 text-left text-sm text-foreground">
                <Images size={15} /> Attach: Photos
              </button>
              <button type="button" className="flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-2 text-left text-sm text-foreground">
                <FileText size={15} /> Attach: Files
              </button>
              <button type="button" className="flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-2 text-left text-sm text-foreground">
                <GalleryVerticalEnd size={15} /> Media gallery
              </button>
              <button type="button" className="flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-2 text-left text-sm text-foreground">
                <Settings2 size={15} /> Chat settings
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
