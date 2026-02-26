'use client';

import { useCallback, useEffect, useRef } from 'react';

import { setActiveChatId } from '@/app/chats/[chatId]/_lib/active-chat-idb';
import { normalizeTagInput } from '@/app/chats/[chatId]/_lib/chat-utils';
import { apiFetch } from '@/src/lib/api-fetch';
import { subscribeToKeyboardLayout } from '@/src/lib/keyboard-layout';
import type { ChatPageData } from '@/app/chats/[chatId]/_hooks/use-chat-page-data';
import {
  applyStreamingChunk,
  applyStreamingComplete,
  resolveEdgeSwipeBack,
  shouldStartEdgeSwipeBack,
  upsertFeedMessage,
} from '@/src/lib/chat';
import { subscribeToEventsStream, type FrontendStreamEvent } from '@/src/lib/events-stream';

const TYPING_EXPIRY_MS = 12_000;

const TITLE_TYPING_SPEED_MS = 40;

export function useChatPageEffects(data: ChatPageData) {
  const markReadInFlightRef = useRef<string | null>(null);
  const typingExpiryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const titleTypingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const refreshMediaTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const keyboardOffsetRef = useRef(0);
  const {
    chat,
    chatId,
    goBack,
    isChatSettingsOpen,
    isEditingTitle,
    knownMessageIdsRef,
    loadData,
    messages,
    refreshMedia,
    refreshMessages,
    refreshPendingRequests,
    resetRecordingState,
    scrollToBottom,
    feedRef,
    setIsLoadingTagSuggestions,
    setKeyboardOffset,
    setMessages,
    setChat,
    setTypingTitle,
    setPendingReply,
    setTagSuggestions,
    swipeRef,
    tagInput,
    tagSuggestionsTimerRef,
    titleInputRef,
  } = data;

  useEffect(() => {
    void loadData();
  }, [loadData]);

  useEffect(() => {
    if (!chatId) return;

    const update = () => {
      if (document.visibilityState === 'visible') {
        void setActiveChatId(chatId);
      } else {
        void setActiveChatId(null);
      }
    };

    update();
    document.addEventListener('visibilitychange', update);

    return () => {
      document.removeEventListener('visibilitychange', update);
      void setActiveChatId(null);
    };
  }, [chatId]);

  useEffect(() => {
    if (!chatId || !chat || chat.id !== chatId) {
      return;
    }

    const unreadCount = Math.max(0, chat.unread_count ?? 0);
    if (unreadCount === 0) {
      return;
    }

    if (markReadInFlightRef.current === chatId) {
      return;
    }

    markReadInFlightRef.current = chatId;
    void apiFetch(`/api/v1/chats/${chatId}/mark-read`, { method: 'POST' })
      .then((response) => {
        if (!response.ok) {
          throw new Error('Failed to mark chat as read');
        }
        setChat((current) => {
          if (!current || current.id !== chatId) {
            return current;
          }

          return {
            ...current,
            unread_count: 0,
            last_read_at: new Date().toISOString(),
          };
        });
      })
      .catch(() => {})
      .finally(() => {
        if (markReadInFlightRef.current === chatId) {
          markReadInFlightRef.current = null;
        }
      });
  }, [chat, chatId, setChat]);

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
      apiFetch(`/api/v1/tags/suggestions?q=${encodeURIComponent(query)}&limit=8`, { cache: 'no-store' })
        .then(async (response) => {
          if (!response.ok) {
            throw new Error('Failed to load tag suggestions');
          }

          const payload = (await response.json()) as { data?: Array<{ name: string; usage_count: number }> };
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
  }, [chat, isChatSettingsOpen, setIsLoadingTagSuggestions, setTagSuggestions, tagInput, tagSuggestionsTimerRef]);

  useEffect(() => {
    knownMessageIdsRef.current = new Set(messages.map((message) => message.id));
  }, [knownMessageIdsRef, messages]);

  useEffect(() => {
    if (!chatId) {
      return;
    }

    const unsubscribe = subscribeToEventsStream((event: FrontendStreamEvent) => {
      const chatFromPayload = event.payload.chatId;
      if (chatFromPayload !== chatId) {
        return;
      }

      if (event.type === 'chat.typing') {
        setPendingReply(true);
        if (typingExpiryTimerRef.current) {
          clearTimeout(typingExpiryTimerRef.current);
        }
        typingExpiryTimerRef.current = setTimeout(() => {
          setPendingReply(false);
          typingExpiryTimerRef.current = null;
          // Clean up stale streaming messages so the header typing indicator
          // and empty bubble disappear when heartbeats stop arriving.
          // - Empty streaming messages (eager placeholder): remove entirely
          // - Streaming messages with partial content: mark cancelled locally
          setMessages((current) => {
            if (!current.some((m) => m.stream_state === 'streaming')) {
              return current;
            }
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
        const contentFinal = typeof event.payload.contentFinal === 'string'
          ? event.payload.contentFinal
          : null;
        const createdAt = typeof event.payload.createdAt === 'string'
          ? event.payload.createdAt
          : event.timestamp;

        if (messageId) {
          knownMessageIdsRef.current.add(messageId);
          setMessages((current) =>
            upsertFeedMessage(current, {
              id: messageId,
              role,
              sender_id: senderId,
              created_at: createdAt,
              content_final: streamState === 'streaming' ? null : contentFinal,
              content_partial: streamState === 'streaming' ? '' : null,
              stream_state: streamState,
            }),
          );
        } else {
          void refreshMessages();
        }

        if (role !== 'user') {
          setPendingReply(false);
          if (typingExpiryTimerRef.current) {
            clearTimeout(typingExpiryTimerRef.current);
            typingExpiryTimerRef.current = null;
          }
        }

        // If the message is from an agent/system (not user), mark chat as read
        // since the user is actively viewing this chat.
        if (role !== 'user' && streamState !== 'streaming' && markReadInFlightRef.current !== chatId) {
          markReadInFlightRef.current = chatId;
          void apiFetch(`/api/v1/chats/${chatId}/mark-read`, { method: 'POST' })
            .catch(() => {})
            .finally(() => {
              if (markReadInFlightRef.current === chatId) {
                markReadInFlightRef.current = null;
              }
            });
        }
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

        setPendingReply(false);
        if (typingExpiryTimerRef.current) {
          clearTimeout(typingExpiryTimerRef.current);
          typingExpiryTimerRef.current = null;
        }

        if (messageId) {
          if (!knownMessageIdsRef.current.has(messageId)) {
            void refreshMessages();
            return;
          }

          setMessages((current) => applyStreamingComplete(current, messageId, finalText, streamState));

          if (markReadInFlightRef.current !== chatId) {
            markReadInFlightRef.current = chatId;
            void apiFetch(`/api/v1/chats/${chatId}/mark-read`, { method: 'POST' })
              .catch(() => {})
              .finally(() => {
                if (markReadInFlightRef.current === chatId) {
                  markReadInFlightRef.current = null;
                }
              });
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
            const newChat = (await res.json()) as import('@/app/chats/[chatId]/_lib/types').Chat;
            const prevTitle = chat?.title;
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
        // Debounce: rapid SSE events only trigger one refresh
        if (refreshMediaTimerRef.current) {
          clearTimeout(refreshMediaTimerRef.current);
        }
        refreshMediaTimerRef.current = setTimeout(() => {
          refreshMediaTimerRef.current = null;
          void refreshMedia();
        }, 200);
      }
    });

    return () => {
      unsubscribe();
      if (typingExpiryTimerRef.current) {
        clearTimeout(typingExpiryTimerRef.current);
        typingExpiryTimerRef.current = null;
      }
      if (refreshMediaTimerRef.current) {
        clearTimeout(refreshMediaTimerRef.current);
        refreshMediaTimerRef.current = null;
      }
    };
  }, [chat, chatId, knownMessageIdsRef, refreshMedia, refreshMessages, refreshPendingRequests, setChat, setMessages, setPendingReply, setTypingTitle]);

  useEffect(() => {
    if (!isEditingTitle) {
      return;
    }

    titleInputRef.current?.focus();
    titleInputRef.current?.select();
  }, [isEditingTitle, titleInputRef]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      scrollToBottom();
    });

    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, [messages.length, scrollToBottom]);

  useEffect(() => {
    const unsubscribe = subscribeToKeyboardLayout(window, document, ({ keyboardOffset }) => {
      const feed = feedRef.current;
      const nearBottom = feed
        ? (feed.scrollHeight - feed.scrollTop - feed.clientHeight) <= 80
        : false;

      if (keyboardOffset !== keyboardOffsetRef.current) {
        keyboardOffsetRef.current = keyboardOffset;
        setKeyboardOffset(keyboardOffset);
      }

      if (nearBottom) {
        window.requestAnimationFrame(() => {
          scrollToBottom();
        });
      }
    });

    return () => {
      unsubscribe();
    };
  }, [feedRef, scrollToBottom, setKeyboardOffset]);

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
  }, [goBack, swipeRef]);

  useEffect(() => {
    return () => {
      if (titleTypingIntervalRef.current) {
        clearInterval(titleTypingIntervalRef.current);
      }
      if (tagSuggestionsTimerRef.current) {
        window.clearTimeout(tagSuggestionsTimerRef.current);
      }
      resetRecordingState();
    };
  }, [resetRecordingState, tagSuggestionsTimerRef]);
}
