// Drop-in replacement for @/src/lib/api-fetch.ts
// Routes all API calls to the in-memory mock store.

import { emitMockEvent } from './mock-events-stream';
import { pickResponse } from './mock-responses';
import {
  addMedia,
  addMessage,
  archiveChat,
  cancelRequest,
  createChat,
  demoConfig,
  generateId,
  getChat,
  getChats,
  getMediaForChat,
  getMessages,
  getPendingSummary,
  getRequests,
  getTagSuggestions,
  getUnreadSummary,
  markChatRead,
  resolveRequest,
  searchStore,
  unarchiveChat,
  updateChat,
  updateMessage,
} from './mock-store';
import type { MediaItem } from './mock-store';

// Map media id → blob URL for serving uploaded files in-browser
const blobUrlMap = new Map<string, string>();

// ── Exported interface (must match api-fetch.ts) ──────────────────────

export function getApiSecret(): string | null {
  return 'demo';
}

export function setApiSecret(_secret: string | null) {
  // No-op in demo
}

export function buildFileUrl(mediaId: string, _variant?: string): string {
  // Return the blob URL if we have one (uploaded in this session), otherwise a placeholder
  return blobUrlMap.get(mediaId) ?? `/api/v1/files/${mediaId}`;
}

// ── Route matching ────────────────────────────────────────────────────

type RouteMatch = {
  params: Record<string, string>;
};

function matchRoute(pattern: string, pathname: string): RouteMatch | null {
  const patternParts = pattern.split('/');
  const pathParts = pathname.split('/');

  if (patternParts.length !== pathParts.length) return null;

  const params: Record<string, string> = {};
  for (let i = 0; i < patternParts.length; i++) {
    const pp = patternParts[i];
    if (pp.startsWith(':')) {
      params[pp.slice(1)] = pathParts[i];
    } else if (pp !== pathParts[i]) {
      return null;
    }
  }
  return { params };
}

// ── Response helpers ──────────────────────────────────────────────────

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function notFound(message = 'Not found'): Response {
  return json({ error: message }, 404);
}

function noContent(): Response {
  return new Response(null, { status: 204 });
}

// ── Simulated streaming response ──────────────────────────────────────

function autoRenameIfNeeded(chatId: string, firstUserText: string) {
  const chat = getChat(chatId);
  if (!chat || chat.title_source !== 'default') return;

  const trimmed = firstUserText.trim();
  if (!trimmed) return;

  const newTitle = trimmed.length > 30 ? trimmed.slice(0, 30) + '...' : trimmed;
  updateChat(chatId, { title: newTitle, titleAutoRenamed: true });
  emitMockEvent('chat.updated', { chat: getChat(chatId) });
}

function simulateAgentResponse(chatId: string, userContent: string) {
  const chat = getChat(chatId);
  if (!chat) return;

  const agentId = chat.agent_ids[0] ?? 'assistant';
  const responseText = pickResponse(userContent);
  const words = responseText.split(/(\s+)/); // keep whitespace

  // 1) Typing indicator after brief delay
  setTimeout(() => {
    emitMockEvent('chat.typing', { chatId, agentId });
  }, 600);

  // 2) Create streaming message
  setTimeout(() => {
    const agentMsg = addMessage(chatId, 'agent', agentId, '', {
      streaming: true,
      modelId: chat.model_id,
    });

    emitMockEvent('message.created', {
      chatId,
      message: { ...agentMsg },
    });

    // 3) Stream word by word
    let accumulated = '';
    let delay = 0;
    const baseDelay = 25;

    for (let i = 0; i < words.length; i++) {
      const word = words[i];
      delay += baseDelay + Math.random() * 30;

      setTimeout(() => {
        accumulated += word;
        updateMessage(agentMsg.id, { content_partial: accumulated });

        emitMockEvent('message.streaming.chunk', {
          chatId,
          messageId: agentMsg.id,
          deltaText: word,
          accumulatedText: accumulated,
        });
      }, delay);
    }

    // 4) Complete streaming
    setTimeout(() => {
      updateMessage(agentMsg.id, {
        content_final: responseText,
        content_partial: null,
        stream_state: 'complete',
      });

      // Update chat preview
      const preview = responseText.length > 80 ? responseText.slice(0, 80) + '...' : responseText;
      updateChat(chatId, {});
      const c = getChat(chatId);
      if (c) {
        c.last_message_preview = preview;
        c.last_message_role = 'agent';
      }

      emitMockEvent('message.streaming.complete', {
        chatId,
        messageId: agentMsg.id,
        message: {
          ...agentMsg,
          content_final: responseText,
          content_partial: null,
          stream_state: 'complete',
        },
      });

      emitMockEvent('chat.updated', { chat: getChat(chatId) });
    }, delay + 100);
  }, 1200);
}

// ── Main fetch handler ────────────────────────────────────────────────

export async function apiFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = typeof input === 'string' ? new URL(input, window.location.origin) : input instanceof URL ? input : new URL(input.url);
  const method = (init?.method ?? 'GET').toUpperCase();
  const pathname = url.pathname;

  let body: Record<string, unknown> | null = null;
  if (init?.body && !(init.body instanceof FormData)) {
    try {
      body = JSON.parse(typeof init.body === 'string' ? init.body : new TextDecoder().decode(init.body as ArrayBuffer));
    } catch {
      body = null;
    }
  }

  // ── Config ────────────────────────────────────────────────────────
  if (pathname === '/api/v1/config' && method === 'GET') {
    return json(demoConfig);
  }

  if (pathname === '/api/v1/config/admin' && method === 'PATCH') {
    return json({ ok: true });
  }

  // ── Chats collection ──────────────────────────────────────────────
  if (pathname === '/api/v1/chats' && method === 'GET') {
    const archived = url.searchParams.get('archived') === 'true';
    const data = getChats(archived);
    return json({ data, cursor: { next: null, hasMore: false } });
  }

  if (pathname === '/api/v1/chats' && method === 'POST') {
    const chat = createChat({
      agentIds: (body?.agentIds as string[]) ?? ['assistant'],
      modelId: (body?.modelId as string) ?? 'gpt-4o',
      title: body?.title as string | undefined,
      tags: body?.tags as string[] | undefined,
    });

    emitMockEvent('chat.created', { chat });

    // If firstMessage is provided, auto-send it
    if (body?.firstMessage && typeof body.firstMessage === 'string') {
      const userMsg = addMessage(chat.id, 'user', 'user:primary', body.firstMessage);
      autoRenameIfNeeded(chat.id, body.firstMessage);
      setTimeout(() => {
        emitMockEvent('message.created', { chatId: chat.id, message: userMsg });
        simulateAgentResponse(chat.id, body!.firstMessage as string);
      }, 100);
    }

    return json(chat, 201);
  }

  if (pathname === '/api/v1/chats/pending-summary' && method === 'GET') {
    return json(getPendingSummary());
  }

  if (pathname === '/api/v1/chats/unread-summary' && method === 'GET') {
    return json(getUnreadSummary());
  }

  // ── Single chat ───────────────────────────────────────────────────
  let m = matchRoute('/api/v1/chats/:chatId', pathname);
  if (m && method === 'GET') {
    const chat = getChat(m.params.chatId);
    return chat ? json(chat) : notFound('Chat not found');
  }
  if (m && method === 'PATCH') {
    const updated = updateChat(m.params.chatId, body as Record<string, unknown>);
    if (!updated) return notFound('Chat not found');
    emitMockEvent('chat.updated', { chat: updated });
    return json(updated);
  }

  // ── Messages ──────────────────────────────────────────────────────
  m = matchRoute('/api/v1/chats/:chatId/messages', pathname);
  if (m && method === 'GET') {
    const msgs = getMessages(m.params.chatId);
    return json({ data: msgs, cursor: { next: null, hasMore: false } });
  }
  if (m && method === 'POST') {
    const chatId = m.params.chatId;
    const role = (body?.role as string) ?? 'user';
    const senderId = (body?.senderId as string) ?? 'user:primary';
    const content = (body?.content as string) ?? '';
    const streaming = (body?.streaming as boolean) ?? false;
    const trace = body?.trace as Record<string, unknown> | undefined;

    const msg = addMessage(chatId, role as 'user' | 'agent' | 'system' | 'tool', senderId, content, {
      streaming,
      modelId: body?.modelId as string | undefined,
      trace,
    });

    // Link media items to this message
    if (trace) {
      const mediaIds: string[] = Array.isArray(trace.mediaIds)
        ? (trace.mediaIds as string[])
        : typeof trace.mediaId === 'string'
          ? [trace.mediaId]
          : [];
      const chatMedia = getMediaForChat(chatId);
      for (const mid of mediaIds) {
        const item = chatMedia.find((m) => m.id === mid);
        if (item) item.message_id = msg.id;
      }
    }

    emitMockEvent('message.created', { chatId, message: msg });
    emitMockEvent('chat.updated', { chat: getChat(chatId) });

    // Auto-rename if this is the first user message in a default-titled chat
    if (role === 'user' && content) {
      autoRenameIfNeeded(chatId, content);
    }

    // Auto-respond for user messages
    if (role === 'user' && !streaming) {
      simulateAgentResponse(chatId, content);
    }

    return json(msg, 201);
  }

  // ── Cancel streaming (bulk) ───────────────────────────────────────
  m = matchRoute('/api/v1/chats/:chatId/messages/cancel-streaming', pathname);
  if (m && method === 'POST') {
    return json({ cancelled: 0 });
  }

  // ── Message actions (chunks, complete, cancel) ────────────────────
  m = matchRoute('/api/v1/messages/:messageId/chunks', pathname);
  if (m && method === 'POST') {
    return json({ ok: true });
  }

  m = matchRoute('/api/v1/messages/:messageId/complete', pathname);
  if (m && method === 'POST') {
    return json({ ok: true });
  }

  m = matchRoute('/api/v1/messages/:messageId/cancel', pathname);
  if (m && method === 'POST') {
    return json({ ok: true });
  }

  // ── Media ─────────────────────────────────────────────────────────
  m = matchRoute('/api/v1/chats/:chatId/media', pathname);
  if (m && method === 'GET') {
    const data = getMediaForChat(m.params.chatId);
    return json({ data, cursor: { next: null, hasMore: false } });
  }

  // ── Requests ──────────────────────────────────────────────────────
  m = matchRoute('/api/v1/chats/:chatId/requests', pathname);
  if (m && method === 'GET') {
    const status = url.searchParams.get('status') ?? 'pending';
    const data = getRequests(m.params.chatId, status);
    return json({ data });
  }

  m = matchRoute('/api/v1/requests/:requestId/resolve', pathname);
  if (m && method === 'POST') {
    const resolved = resolveRequest(m.params.requestId, body ?? {});
    if (!resolved) return notFound('Request not found');
    emitMockEvent('request.resolved', { request: resolved });
    if (resolved.chat_id) {
      emitMockEvent('chat.updated', { chat: getChat(resolved.chat_id) });
    }
    return json(resolved);
  }

  m = matchRoute('/api/v1/requests/:requestId/cancel', pathname);
  if (m && method === 'POST') {
    const cancelled = cancelRequest(m.params.requestId);
    if (!cancelled) return notFound('Request not found');
    emitMockEvent('request.cancelled', { request: cancelled });
    return json(cancelled);
  }

  m = matchRoute('/api/v1/requests/:requestId', pathname);
  if (m && method === 'PATCH') {
    return json({ ok: true });
  }

  // ── Archive / Unarchive / Mark-read ───────────────────────────────
  m = matchRoute('/api/v1/chats/:chatId/archive', pathname);
  if (m && method === 'POST') {
    archiveChat(m.params.chatId);
    emitMockEvent('chat.archived', { chatId: m.params.chatId });
    return json({ ok: true });
  }

  m = matchRoute('/api/v1/chats/:chatId/unarchive', pathname);
  if (m && method === 'POST') {
    unarchiveChat(m.params.chatId);
    emitMockEvent('chat.unarchived', { chatId: m.params.chatId });
    return json({ ok: true });
  }

  m = matchRoute('/api/v1/chats/:chatId/mark-read', pathname);
  if (m && method === 'POST') {
    markChatRead(m.params.chatId);
    emitMockEvent('chat.read', { chatId: m.params.chatId });
    return json({ ok: true });
  }

  m = matchRoute('/api/v1/chats/:chatId/mark-unread', pathname);
  if (m && method === 'POST') {
    return json({ ok: true });
  }

  // ── User typing ───────────────────────────────────────────────────
  m = matchRoute('/api/v1/chats/:chatId/user-typing', pathname);
  if (m && method === 'POST') {
    return noContent();
  }

  m = matchRoute('/api/v1/chats/:chatId/typing', pathname);
  if (m && method === 'POST') {
    return noContent();
  }

  // ── Search ────────────────────────────────────────────────────────
  if (pathname === '/api/v1/search' && method === 'GET') {
    const query = url.searchParams.get('q') ?? '';
    return json(searchStore(query));
  }

  // ── Tags ──────────────────────────────────────────────────────────
  if (pathname === '/api/v1/tags/suggestions' && method === 'GET') {
    return json({ data: getTagSuggestions() });
  }

  // ── Push subscription (no-op) ─────────────────────────────────────
  if (pathname === '/api/v1/push/subscribe' && method === 'POST') {
    return json({ ok: true });
  }

  if (pathname === '/api/v1/push/unsubscribe' && method === 'POST') {
    return json({ ok: true });
  }

  // ── File upload ────────────────────────────────────────────────────
  m = matchRoute('/api/v1/chats/:chatId/media', pathname);
  if (m && method === 'POST') {
    const chatId = m.params.chatId;
    let file: File | null = null;
    let kindHint: string | null = null;

    // Extract file from FormData if available
    if (init?.body instanceof FormData) {
      file = init.body.get('file') as File | null;
      kindHint = init.body.get('kind') as string | null;
    }

    const id = generateId();
    const contentType = file?.type || 'application/octet-stream';
    const kind: MediaItem['kind'] = kindHint === 'image' || contentType.startsWith('image/')
      ? 'image'
      : kindHint === 'audio' || contentType.startsWith('audio/')
        ? 'audio'
        : 'file';

    // Create a blob URL so the file can be served back in-browser
    if (file) {
      const url = URL.createObjectURL(file);
      blobUrlMap.set(id, url);
    }

    const mediaItem: MediaItem = {
      id,
      message_id: null,
      filename: file?.name || 'upload.bin',
      created_at: new Date().toISOString(),
      byte_size: file?.size ?? 0,
      content_type: contentType,
      kind,
    };

    addMedia(chatId, mediaItem);
    return json(mediaItem, 201);
  }

  // ── Fallback ──────────────────────────────────────────────────────
  console.warn(`[demo] Unhandled API call: ${method} ${pathname}`);
  return json({ error: 'Not found (demo)' }, 404);
}
