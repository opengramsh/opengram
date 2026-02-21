'use client';

import { useCallback, useState, type Dispatch, type SetStateAction } from 'react';

import type { Chat } from '@/app/chats/[chatId]/_lib/types';

type UseChatSettingsActionsArgs = {
  chat: Chat | null;
  setChat: Dispatch<SetStateAction<Chat | null>>;
  setError: Dispatch<SetStateAction<string | null>>;
  goBack: () => void;
};

export function useChatSettingsActions({ chat, setChat, setError, goBack }: UseChatSettingsActionsArgs) {
  const [isUpdatingChatSettings, setIsUpdatingChatSettings] = useState(false);

  const patchChatSettings = useCallback(async (payload: { modelId?: string; tags?: string[]; customState?: string; pinned?: boolean; notificationsMuted?: boolean }) => {
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
      ...(payload.notificationsMuted !== undefined ? { notifications_muted: payload.notificationsMuted } : {}),
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
  }, [chat, isUpdatingChatSettings, setChat, setError]);

  const archiveCurrentChat = useCallback(async () => {
    if (!chat || isUpdatingChatSettings) {
      return;
    }

    setIsUpdatingChatSettings(true);
    try {
      const response = await fetch(`/api/v1/chats/${chat.id}/archive`, { method: 'POST' });
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
  }, [chat, goBack, isUpdatingChatSettings, setChat, setError]);

  const unarchiveCurrentChat = useCallback(async () => {
    if (!chat || isUpdatingChatSettings) {
      return;
    }

    setIsUpdatingChatSettings(true);
    try {
      const response = await fetch(`/api/v1/chats/${chat.id}/unarchive`, { method: 'POST' });
      if (!response.ok) {
        throw new Error('Failed to unarchive chat');
      }

      setChat((current) => (current ? { ...current, is_archived: false } : current));
    } catch {
      setError('Failed to unarchive chat.');
    } finally {
      setIsUpdatingChatSettings(false);
    }
  }, [chat, isUpdatingChatSettings, setChat, setError]);

  return {
    isUpdatingChatSettings,
    patchChatSettings,
    archiveCurrentChat,
    unarchiveCurrentChat,
  };
}
