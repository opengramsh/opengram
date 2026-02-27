import { apiFetch, buildFileUrl } from '@/src/lib/api-fetch';
import type { Chat, MediaItem, MediaResponse, Message, MessagesResponse, RequestItem, RequestsResponse, TagSuggestion } from './types';

export { buildFileUrl };

export async function fetchChat(chatId: string): Promise<Chat> {
  const response = await apiFetch(`/api/v1/chats/${chatId}`, { cache: 'no-store' });
  if (!response.ok) throw new Error('Failed to load chat');
  return (await response.json()) as Chat;
}

export async function fetchMessages(chatId: string): Promise<Message[]> {
  const response = await apiFetch(`/api/v1/chats/${chatId}/messages?limit=200`, { cache: 'no-store' });
  if (!response.ok) throw new Error('Failed to load messages');
  const payload = (await response.json()) as MessagesResponse;
  return payload.data ?? [];
}

export async function fetchPendingRequests(chatId: string): Promise<RequestItem[]> {
  const response = await apiFetch(`/api/v1/chats/${chatId}/requests?status=pending`, { cache: 'no-store' });
  if (!response.ok) throw new Error('Failed to load requests');
  const payload = (await response.json()) as RequestsResponse;
  return payload.data ?? [];
}

export async function fetchAllMedia(chatId: string): Promise<MediaItem[]> {
  const allItems: MediaItem[] = [];
  let cursor: string | undefined;

  for (;;) {
    const url = cursor
      ? `/api/v1/chats/${chatId}/media?cursor=${encodeURIComponent(cursor)}`
      : `/api/v1/chats/${chatId}/media`;
    const response = await apiFetch(url, { cache: 'no-store' });
    if (!response.ok) throw new Error('Failed to load media');

    const payload = (await response.json()) as MediaResponse;
    allItems.push(...(payload.data ?? []));

    if (!payload.hasMore || !payload.nextCursor) break;
    cursor = payload.nextCursor;
  }

  return allItems;
}

export async function patchChat(chatId: string, patch: Partial<Pick<Chat, 'title' | 'tags' | 'model_id' | 'pinned' | 'notifications_muted'>>): Promise<Chat> {
  const response = await apiFetch(`/api/v1/chats/${chatId}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(patch),
  });
  if (!response.ok) throw new Error('Failed to update chat');
  return (await response.json()) as Chat;
}

export async function resolveRequest(requestId: string, payload: Record<string, unknown>): Promise<void> {
  const response = await apiFetch(`/api/v1/requests/${requestId}/resolve`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error('Failed to resolve request');
}

export async function markChatRead(chatId: string): Promise<void> {
  await apiFetch(`/api/v1/chats/${chatId}/mark-read`, { method: 'POST' });
}

export async function uploadMedia(chatId: string, file: File, kind?: 'image' | 'audio' | 'file'): Promise<MediaItem> {
  const formData = new FormData();
  formData.append('file', file, file.name);
  if (kind) formData.append('kind', kind);

  const response = await apiFetch(`/api/v1/chats/${chatId}/media`, { method: 'POST', body: formData });
  if (!response.ok) throw new Error('Failed to upload media');
  return (await response.json()) as MediaItem;
}

export async function fetchTagSuggestions(prefix: string): Promise<TagSuggestion[]> {
  const response = await apiFetch(`/api/v1/tags/suggestions?q=${encodeURIComponent(prefix)}&limit=8`, { cache: 'no-store' });
  if (!response.ok) return [];
  const payload = (await response.json()) as { data?: TagSuggestion[] };
  return payload.data ?? [];
}

export async function archiveChat(chatId: string): Promise<void> {
  const response = await apiFetch(`/api/v1/chats/${chatId}/archive`, { method: 'POST' });
  if (!response.ok) throw new Error('Failed to archive chat');
}

export async function unarchiveChat(chatId: string): Promise<void> {
  const response = await apiFetch(`/api/v1/chats/${chatId}/unarchive`, { method: 'POST' });
  if (!response.ok) throw new Error('Failed to unarchive chat');
}

export async function deleteChat(chatId: string): Promise<void> {
  const response = await apiFetch(`/api/v1/chats/${chatId}`, { method: 'DELETE' });
  if (!response.ok) throw new Error('Failed to delete chat');
}
