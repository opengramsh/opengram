import { getApiSecret } from '@/src/lib/api-fetch';

export type FrontendStreamEventType =
  | 'chat.created'
  | 'chat.updated'
  | 'chat.archived'
  | 'chat.unarchived'
  | 'chat.read'
  | 'chat.unread'
  | 'chat.typing'
  | 'chat.user_typing'
  | 'message.created'
  | 'message.streaming.chunk'
  | 'message.streaming.complete'
  | 'request.created'
  | 'request.resolved'
  | 'request.cancelled'
  | 'media.attached';

export type FrontendStreamEvent = {
  id: string;
  type: FrontendStreamEventType;
  timestamp: string;
  payload: Record<string, unknown>;
};

type StreamListener = (event: FrontendStreamEvent) => void;

type StreamManagerState = {
  source: EventSource | null;
  listeners: Set<StreamListener>;
  reconnectAttempt: number;
  reconnectTimer: ReturnType<typeof setTimeout> | null;
  lastPersistedCursor: string | null;
  activeCursor: string | null;
  activeConnectionOpened: boolean;
};

const CURSOR_STORAGE_KEY = 'opengram.sse.cursor';
const GLOBAL_STATE_KEY = '__opengramEventsStreamSingleton__';
const MAX_RECONNECT_DELAY_MS = 15_000;
const BASE_RECONNECT_DELAY_MS = 500;
const EVENT_TYPES: FrontendStreamEventType[] = [
  'chat.created',
  'chat.updated',
  'chat.archived',
  'chat.unarchived',
  'chat.read',
  'chat.unread',
  'chat.typing',
  'chat.user_typing',
  'message.created',
  'message.streaming.chunk',
  'message.streaming.complete',
  'request.created',
  'request.resolved',
  'request.cancelled',
  'media.attached',
];

function isPersistedEvent(type: FrontendStreamEventType) {
  return type !== 'message.streaming.chunk' && type !== 'chat.typing' && type !== 'chat.user_typing';
}

function safeReadCursorFromStorage() {
  if (typeof window === 'undefined') {
    return null;
  }

  try {
    const value = window.localStorage.getItem(CURSOR_STORAGE_KEY);
    return value?.trim() || null;
  } catch {
    return null;
  }
}

function safeWriteCursorToStorage(cursor: string) {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    window.localStorage.setItem(CURSOR_STORAGE_KEY, cursor);
  } catch {
    // localStorage can be blocked; keep in-memory cursor.
  }
}

function safeClearCursorFromStorage() {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    window.localStorage.removeItem(CURSOR_STORAGE_KEY);
  } catch {
    // localStorage can be blocked; keep in-memory cursor.
  }
}

function getReconnectDelayMs(reconnectAttempt: number) {
  const cappedAttempt = Math.max(0, reconnectAttempt);
  return Math.min(MAX_RECONNECT_DELAY_MS, BASE_RECONNECT_DELAY_MS * 2 ** cappedAttempt);
}

function buildStreamUrl(cursor: string | null) {
  const params = new URLSearchParams();
  params.set('ephemeral', 'true');
  if (cursor) {
    params.set('cursor', cursor);
  }

  const secret = getApiSecret();
  if (secret) {
    params.set('token', secret);
  }

  return `/api/v1/events/stream?${params.toString()}`;
}

function parseIncomingEvent(event: Event): FrontendStreamEvent | null {
  const message = event as MessageEvent<string>;
  if (typeof message.data !== 'string') {
    return null;
  }

  try {
    const parsed = JSON.parse(message.data) as Partial<FrontendStreamEvent>;
    if (!parsed || typeof parsed !== 'object') {
      return null;
    }

    if (
      typeof parsed.id !== 'string'
      || typeof parsed.type !== 'string'
      || typeof parsed.timestamp !== 'string'
      || !parsed.payload
      || typeof parsed.payload !== 'object'
      || Array.isArray(parsed.payload)
    ) {
      return null;
    }

    return parsed as FrontendStreamEvent;
  } catch {
    return null;
  }
}

function createInitialState(): StreamManagerState {
  return {
    source: null,
    listeners: new Set(),
    reconnectAttempt: 0,
    reconnectTimer: null,
    lastPersistedCursor: safeReadCursorFromStorage(),
    activeCursor: null,
    activeConnectionOpened: false,
  };
}

function getState() {
  const globalScope = globalThis as typeof globalThis & {
    [GLOBAL_STATE_KEY]?: StreamManagerState;
  };

  if (!globalScope[GLOBAL_STATE_KEY]) {
    globalScope[GLOBAL_STATE_KEY] = createInitialState();
  }

  return globalScope[GLOBAL_STATE_KEY] as StreamManagerState;
}

function closeSource(state: StreamManagerState) {
  if (!state.source) {
    return;
  }

  state.source.close();
  state.source = null;
  state.activeCursor = null;
  state.activeConnectionOpened = false;
}

function clearReconnectTimer(state: StreamManagerState) {
  if (!state.reconnectTimer) {
    return;
  }

  clearTimeout(state.reconnectTimer);
  state.reconnectTimer = null;
}

function dispatchToListeners(state: StreamManagerState, event: FrontendStreamEvent) {
  for (const listener of state.listeners) {
    try {
      listener(event);
    } catch {
      // Listener failures should not interrupt stream delivery.
    }
  }
}

function onIncomingEvent(state: StreamManagerState, event: Event) {
  const parsed = parseIncomingEvent(event);
  if (!parsed) {
    return;
  }

  if (isPersistedEvent(parsed.type)) {
    state.lastPersistedCursor = parsed.id;
    safeWriteCursorToStorage(parsed.id);
  }

  dispatchToListeners(state, parsed);
}

function ensureConnected(state: StreamManagerState) {
  if (typeof window === 'undefined' || typeof EventSource === 'undefined') {
    return;
  }

  if (state.source || state.listeners.size === 0) {
    return;
  }

  const source = new EventSource(buildStreamUrl(state.lastPersistedCursor));
  state.source = source;
  state.activeCursor = state.lastPersistedCursor;
  state.activeConnectionOpened = false;

  source.onopen = () => {
    state.activeConnectionOpened = true;
    state.reconnectAttempt = 0;
  };

  source.onerror = () => {
    if (state.listeners.size === 0) {
      closeSource(state);
      clearReconnectTimer(state);
      return;
    }

    if (state.activeCursor && !state.activeConnectionOpened) {
      // Cursor may be stale (retention/db reset); retry once without it.
      state.lastPersistedCursor = null;
      safeClearCursorFromStorage();
    }

    closeSource(state);
    if (state.reconnectTimer) {
      return;
    }

    const delayMs = getReconnectDelayMs(state.reconnectAttempt);
    state.reconnectAttempt += 1;
    state.reconnectTimer = setTimeout(() => {
      state.reconnectTimer = null;
      ensureConnected(state);
    }, delayMs);
  };

  for (const type of EVENT_TYPES) {
    source.addEventListener(type, (event) => onIncomingEvent(state, event));
  }
}

function maybeTeardown(state: StreamManagerState) {
  if (state.listeners.size > 0) {
    return;
  }

  clearReconnectTimer(state);
  closeSource(state);
  state.reconnectAttempt = 0;
}

export function subscribeToEventsStream(listener: StreamListener) {
  const state = getState();
  state.listeners.add(listener);
  ensureConnected(state);

  return () => {
    const current = getState();
    current.listeners.delete(listener);
    maybeTeardown(current);
  };
}

export function resetEventsStreamForTests() {
  const state = getState();
  state.listeners.clear();
  clearReconnectTimer(state);
  closeSource(state);
  state.reconnectAttempt = 0;
  state.lastPersistedCursor = null;
  state.activeCursor = null;
  state.activeConnectionOpened = false;
}
