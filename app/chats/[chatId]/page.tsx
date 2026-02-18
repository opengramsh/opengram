'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Facehash } from 'facehash';
import { ArrowLeft, Camera, ChevronDown, FileText, GalleryVerticalEnd, Images, Mic, Plus, Send, Settings2 } from 'lucide-react';

import { resolveEdgeSwipeBack, shouldStartEdgeSwipeBack, sortMessagesForFeed } from '@/src/lib/chat';

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
};

type MessagesResponse = {
  data: Message[];
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

export default function ChatPage() {
  const params = useParams<{ chatId: string }>();
  const chatId = params?.chatId;
  const router = useRouter();

  const [agents, setAgents] = useState<Agent[]>([]);
  const [chat, setChat] = useState<Chat | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [titleInput, setTitleInput] = useState('');
  const [titleError, setTitleError] = useState<string | null>(null);
  const [composerText, setComposerText] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [isComposerMenuOpen, setIsComposerMenuOpen] = useState(false);
  const [isRequestWidgetOpen, setIsRequestWidgetOpen] = useState(true);
  const [keyboardOffset, setKeyboardOffset] = useState(0);

  const titleInputRef = useRef<HTMLInputElement | null>(null);
  const feedRef = useRef<HTMLDivElement | null>(null);
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

  const scrollToBottom = useCallback((smooth = false) => {
    const feed = feedRef.current;
    if (!feed) {
      return;
    }

    feed.scrollTo({ top: feed.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
  }, []);

  const loadData = useCallback(async () => {
    if (!chatId) {
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const [configResponse, chatResponse, messagesResponse] = await Promise.all([
        fetch('/api/v1/config', { cache: 'no-store' }),
        fetch(`/api/v1/chats/${chatId}`, { cache: 'no-store' }),
        fetch(`/api/v1/chats/${chatId}/messages?limit=200`, { cache: 'no-store' }),
      ]);

      if (!configResponse.ok || !chatResponse.ok || !messagesResponse.ok) {
        throw new Error('Failed to load chat data');
      }

      const config = (await configResponse.json()) as ConfigResponse;
      const chatPayload = (await chatResponse.json()) as Chat;
      const messagesPayload = (await messagesResponse.json()) as MessagesResponse;

      setAgents(config.agents ?? []);
      setChat(chatPayload);
      setTitleInput(chatPayload.title);
      setMessages(sortMessagesForFeed(messagesPayload.data ?? []));
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
      setMessages((current) => sortMessagesForFeed([...current, message]));
    } catch {
      setError('Failed to send message.');
    } finally {
      setIsSending(false);
    }
  }, [chat, composerText, isSending]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

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
          messages.map((message) => (
            <div key={message.id} className="mb-2 flex w-full">
              <div className={messageBubbleClass(message.role)}>{messageText(message)}</div>
            </div>
          ))}
      </main>

      {chat && chat.pending_requests_count > 0 && (
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
              <p className="text-xs font-semibold text-amber-100">Pending requests ({chat.pending_requests_count})</p>
              <ChevronDown size={14} className={isRequestWidgetOpen ? 'text-amber-100' : 'rotate-180 text-amber-100'} />
            </button>
            {isRequestWidgetOpen && (
              <p className="pt-1 text-xs text-amber-100/90">Open request details are available in a follow-up endpoint.</p>
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
            className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl border border-border bg-card text-foreground"
            onClick={() => setError('Voice note capture is not implemented yet.')}
          >
            <Mic size={16} />
          </button>
        </div>
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
