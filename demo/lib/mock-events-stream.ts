// Drop-in replacement for @/src/lib/events-stream.ts
// Uses an in-memory event emitter instead of SSE / EventSource.

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

const listeners = new Set<StreamListener>();

let idCounter = 0;

export function emitMockEvent(type: FrontendStreamEventType, payload: Record<string, unknown>) {
  idCounter++;
  const event: FrontendStreamEvent = {
    id: `demo-evt-${idCounter}`,
    type,
    timestamp: new Date().toISOString(),
    payload,
  };
  for (const listener of listeners) {
    try {
      listener(event);
    } catch {
      // Swallow listener errors
    }
  }
}

export function subscribeToEventsStream(listener: StreamListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function resetEventsStreamForTests() {
  listeners.clear();
  idCounter = 0;
}
