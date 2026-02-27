import type { MediaItem, Message } from '@/app/chats/[chatId]/_lib/types';

export function isMessageTyping(message: Message) {
  return message.stream_state === 'streaming' && !message.content_partial?.trim() && !message.content_final?.trim();
}

export function messageText(message: Message) {
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

export function messageBubbleClass(role: Message['role']) {
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

export function mediaIdsFromTrace(message: Message): string[] {
  if (!message.trace) return [];

  if (Array.isArray(message.trace.mediaIds)) {
    return (message.trace.mediaIds as unknown[]).filter((id): id is string => typeof id === 'string');
  }

  if (typeof message.trace.mediaId === 'string') {
    return [message.trace.mediaId];
  }

  return [];
}

export function normalizeTagInput(value: string) {
  return value.trim();
}

export function formatBytes(bytes: number) {
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  if (bytes < 1024 * 1024) {
    return `${Math.round((bytes / 1024) * 10) / 10} KB`;
  }

  return `${Math.round((bytes / (1024 * 1024)) * 10) / 10} MB`;
}

export function formatDuration(totalSeconds: number) {
  if (!Number.isFinite(totalSeconds) || totalSeconds < 0) {
    return '0:00';
  }

  const rounded = Math.floor(totalSeconds);
  const minutes = Math.floor(rounded / 60);
  const seconds = rounded % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

export function isMicPermissionDenied(error: unknown) {
  if (error instanceof DOMException) {
    return error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError';
  }

  return false;
}

export function mediaSortAsc(a: MediaItem, b: MediaItem) {
  if (a.created_at === b.created_at) {
    return a.id.localeCompare(b.id);
  }

  return a.created_at.localeCompare(b.created_at);
}

export function requestSortAsc(a: { id: string; created_at: string }, b: { id: string; created_at: string }) {
  if (a.created_at === b.created_at) {
    return a.id.localeCompare(b.id);
  }

  return a.created_at.localeCompare(b.created_at);
}

export function buildInlineMessageMedia(messages: Message[], mediaByMessageId: Map<string, MediaItem[]>, mediaById: Map<string, MediaItem>) {
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

    for (const traceMediaId of mediaIdsFromTrace(message)) {
      const traced = mediaById.get(traceMediaId);
      if (traced && !seenIds.has(traced.id)) {
        seenIds.add(traced.id);
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
