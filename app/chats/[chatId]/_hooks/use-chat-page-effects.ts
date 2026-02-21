'use client';

import { useEffect, useRef } from 'react';

import { normalizeTagInput } from '@/app/chats/[chatId]/_lib/chat-utils';
import type { ChatPageData } from '@/app/chats/[chatId]/_hooks/use-chat-page-data';
import {
  applyStreamingChunk,
  applyStreamingComplete,
  resolveEdgeSwipeBack,
  shouldStartEdgeSwipeBack,
  upsertFeedMessage,
} from '@/src/lib/chat';
import { subscribeToEventsStream, type FrontendStreamEvent } from '@/src/lib/events-stream';

export function useChatPageEffects(data: ChatPageData) {
  const markReadInFlightRef = useRef<string | null>(null);
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
    setIsLoadingTagSuggestions,
    setKeyboardOffset,
    setMessages,
    setChat,
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
    void fetch(`/api/v1/chats/${chatId}/mark-read`, { method: 'POST' })
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
      fetch(`/api/v1/tags/suggestions?q=${encodeURIComponent(query)}&limit=8`, { cache: 'no-store' })
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
  }, [chatId, knownMessageIdsRef, refreshMedia, refreshMessages, refreshPendingRequests, setMessages]);

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
  }, [setKeyboardOffset]);

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
      if (tagSuggestionsTimerRef.current) {
        window.clearTimeout(tagSuggestionsTimerRef.current);
      }
      resetRecordingState();
    };
  }, [resetRecordingState, tagSuggestionsTimerRef]);
}
