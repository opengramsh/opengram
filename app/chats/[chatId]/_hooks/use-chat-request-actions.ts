'use client';

import { useCallback, useState, type Dispatch, type SetStateAction } from 'react';

import { requestSortAsc } from '@/app/chats/[chatId]/_lib/chat-utils';
import { validateRequestResolutionPayload } from '@/app/chats/[chatId]/_lib/request-utils';
import type { Chat, RequestDraftMap, RequestErrorMap, RequestItem } from '@/app/chats/[chatId]/_lib/types';

type UseChatRequestActionsArgs = {
  setPendingRequests: Dispatch<SetStateAction<RequestItem[]>>;
  setChat: Dispatch<SetStateAction<Chat | null>>;
  setError: Dispatch<SetStateAction<string | null>>;
  refreshPendingRequests: () => Promise<void>;
};

export function useChatRequestActions({
  setPendingRequests,
  setChat,
  setError,
  refreshPendingRequests,
}: UseChatRequestActionsArgs) {
  const [isRequestWidgetOpen, setIsRequestWidgetOpen] = useState(true);
  const [requestDrafts, setRequestDrafts] = useState<RequestDraftMap>({});
  const [requestErrors, setRequestErrors] = useState<RequestErrorMap>({});
  const [resolvingRequestIds, setResolvingRequestIds] = useState<Record<string, boolean>>({});

  const updateRequestDraft = useCallback((requestId: string, updater: (draft: Record<string, unknown>) => Record<string, unknown>) => {
    setRequestDrafts((current) => {
      const nextDraft = updater(current[requestId] ?? {});
      return { ...current, [requestId]: nextDraft };
    });
    setRequestErrors((current) => ({ ...current, [requestId]: null }));
  }, []);

  const resolvePendingRequest = useCallback(async (request: RequestItem) => {
    if (resolvingRequestIds[request.id]) {
      return;
    }

    const validation = validateRequestResolutionPayload(request, requestDrafts);
    if (!validation.payload) {
      setRequestErrors((current) => ({ ...current, [request.id]: validation.error ?? 'Invalid request response.' }));
      return;
    }

    setRequestErrors((current) => ({ ...current, [request.id]: null }));
    setResolvingRequestIds((current) => ({ ...current, [request.id]: true }));
    setPendingRequests((current) => current.filter((item) => item.id !== request.id));
    setChat((current) => current ? { ...current, pending_requests_count: Math.max(0, current.pending_requests_count - 1) } : current);

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
        return [...current, request].sort(requestSortAsc);
      });
      void refreshPendingRequests().catch(() => undefined);
      setError('Failed to resolve request.');
      setRequestErrors((current) => ({ ...current, [request.id]: 'Failed to submit. Try again.' }));
    } finally {
      setResolvingRequestIds((current) => {
        const next = { ...current };
        delete next[request.id];
        return next;
      });
    }
  }, [refreshPendingRequests, requestDrafts, resolvingRequestIds, setChat, setError, setPendingRequests]);

  return {
    isRequestWidgetOpen,
    requestDrafts,
    requestErrors,
    resolvingRequestIds,
    setIsRequestWidgetOpen,
    updateRequestDraft,
    resolvePendingRequest,
  };
}
