import { useCallback, useState, type Dispatch, type SetStateAction } from 'react';

import { apiFetch } from '@/src/lib/api-fetch';
import { requestSortAsc } from '../_lib/chat-utils';
import { validateRequestResolutionPayload } from '../_lib/request-utils';
import type { Chat, RequestDraftMap, RequestErrorMap, RequestItem } from '../_lib/types';

type UseChatV2RequestsArgs = {
  pendingRequests: RequestItem[];
  setPendingRequests: Dispatch<SetStateAction<RequestItem[]>>;
  setChat: Dispatch<SetStateAction<Chat | null>>;
  setError: Dispatch<SetStateAction<string | null>>;
  refreshPendingRequests: () => Promise<void>;
};

export function useChatV2Requests({
  pendingRequests,
  setPendingRequests,
  setChat,
  setError,
  refreshPendingRequests,
}: UseChatV2RequestsArgs) {
  const [isWidgetOpen, setIsWidgetOpen] = useState(true);
  const [drafts, setDrafts] = useState<RequestDraftMap>({});
  const [errors, setErrors] = useState<RequestErrorMap>({});
  const [resolving, setResolving] = useState<Record<string, boolean>>({});

  const updateDraft = useCallback((requestId: string, updater: (draft: Record<string, unknown>) => Record<string, unknown>) => {
    setDrafts((current) => ({ ...current, [requestId]: updater(current[requestId] ?? {}) }));
    setErrors((current) => ({ ...current, [requestId]: null }));
  }, []);

  const resolve = useCallback(async (request: RequestItem) => {
    if (resolving[request.id]) return;

    const validation = validateRequestResolutionPayload(request, drafts);
    if (!validation.payload) {
      setErrors((current) => ({ ...current, [request.id]: validation.error ?? 'Invalid request response.' }));
      return;
    }

    setErrors((current) => ({ ...current, [request.id]: null }));
    setResolving((current) => ({ ...current, [request.id]: true }));
    setPendingRequests((current) => current.filter((item) => item.id !== request.id));
    setChat((current) => current ? { ...current, pending_requests_count: Math.max(0, current.pending_requests_count - 1) } : current);

    try {
      const response = await apiFetch(`/api/v1/requests/${request.id}/resolve`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(validation.payload),
      });
      if (!response.ok) throw new Error('Failed to resolve request');

      setDrafts((current) => { const next = { ...current }; delete next[request.id]; return next; });
      setErrors((current) => { const next = { ...current }; delete next[request.id]; return next; });
    } catch {
      setPendingRequests((current) => {
        if (current.some((item) => item.id === request.id)) return current;
        return [...current, request].sort(requestSortAsc);
      });
      void refreshPendingRequests().catch(() => undefined);
      setError('Failed to resolve request.');
      setErrors((current) => ({ ...current, [request.id]: 'Failed to submit. Try again.' }));
    } finally {
      setResolving((current) => { const next = { ...current }; delete next[request.id]; return next; });
    }
  }, [drafts, refreshPendingRequests, resolving, setChat, setError, setPendingRequests]);

  return {
    isWidgetOpen,
    setIsWidgetOpen,
    drafts,
    errors,
    resolving,
    updateDraft,
    resolve,
    pendingRequests,
  };
}

export type ChatV2RequestsReturn = ReturnType<typeof useChatV2Requests>;
