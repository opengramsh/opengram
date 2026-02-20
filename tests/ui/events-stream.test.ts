// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  resetEventsStreamForTests,
  subscribeToEventsStream,
  type FrontendStreamEvent,
} from '@/src/lib/events-stream';

class MockEventSource {
  static instances: MockEventSource[] = [];

  onopen: ((event: Event) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  readonly listeners = new Map<string, Set<(event: Event) => void>>();
  readonly url: string;
  closed = false;

  constructor(url: string) {
    this.url = url;
    MockEventSource.instances.push(this);
  }

  addEventListener(type: string, listener: (event: Event) => void) {
    const current = this.listeners.get(type) ?? new Set<(event: Event) => void>();
    current.add(listener);
    this.listeners.set(type, current);
  }

  removeEventListener(type: string, listener: (event: Event) => void) {
    const current = this.listeners.get(type);
    if (!current) {
      return;
    }

    current.delete(listener);
    if (current.size === 0) {
      this.listeners.delete(type);
    }
  }

  close() {
    this.closed = true;
  }

  emit(type: string, payload: FrontendStreamEvent) {
    const current = this.listeners.get(type);
    if (!current) {
      return;
    }

    const event = {
      data: JSON.stringify(payload),
      type,
    } as unknown as Event;

    for (const listener of current) {
      listener(event);
    }
  }

  emitError() {
    this.onerror?.(new Event('error'));
  }
}

describe('events stream singleton', () => {
  beforeEach(() => {
    MockEventSource.instances = [];
    localStorage.clear();
    resetEventsStreamForTests();
    vi.useFakeTimers();
    vi.stubGlobal('EventSource', MockEventSource);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    resetEventsStreamForTests();
  });

  it('shares one EventSource across subscribers and closes when last unsubscribes', () => {
    const receivedA: FrontendStreamEvent[] = [];
    const receivedB: FrontendStreamEvent[] = [];

    const unsubA = subscribeToEventsStream((event) => receivedA.push(event));
    const unsubB = subscribeToEventsStream((event) => receivedB.push(event));

    expect(MockEventSource.instances).toHaveLength(1);
    expect(MockEventSource.instances[0]?.url).toBe('/api/v1/events/stream?ephemeral=true');

    MockEventSource.instances[0]?.emit('message.created', {
      id: 'evt-1',
      type: 'message.created',
      timestamp: '2026-02-18T20:00:00.000Z',
      payload: { chatId: 'chat-1', messageId: 'msg-1' },
    });

    expect(receivedA).toHaveLength(1);
    expect(receivedB).toHaveLength(1);

    unsubA();
    expect(MockEventSource.instances[0]?.closed).toBe(false);

    unsubB();
    expect(MockEventSource.instances[0]?.closed).toBe(true);
  });

  it('reconnects with last persisted cursor and ignores chunk ids as cursor', () => {
    const unsub = subscribeToEventsStream(() => {});
    const first = MockEventSource.instances[0];
    expect(first).toBeTruthy();
    first?.onopen?.(new Event('open'));

    first?.emit('message.streaming.chunk', {
      id: 'evt-chunk',
      type: 'message.streaming.chunk',
      timestamp: '2026-02-18T20:00:00.000Z',
      payload: { chatId: 'chat-1', messageId: 'msg-1', deltaText: 'hi' },
    });
    expect(localStorage.getItem('opengram.sse.cursor')).toBeNull();

    first?.emit('message.created', {
      id: 'evt-persisted',
      type: 'message.created',
      timestamp: '2026-02-18T20:00:01.000Z',
      payload: { chatId: 'chat-1', messageId: 'msg-1' },
    });
    expect(localStorage.getItem('opengram.sse.cursor')).toBe('evt-persisted');

    first?.emitError();
    vi.advanceTimersByTime(500);

    expect(MockEventSource.instances).toHaveLength(2);
    expect(MockEventSource.instances[1]?.url).toBe(
      '/api/v1/events/stream?ephemeral=true&cursor=evt-persisted',
    );

    unsub();
  });

  it('drops stale persisted cursor after immediate connection failure', () => {
    localStorage.setItem('opengram.sse.cursor', 'evt-stale');
    delete (globalThis as typeof globalThis & { __opengramEventsStreamSingleton__?: unknown })
      .__opengramEventsStreamSingleton__;

    const unsub = subscribeToEventsStream(() => {});
    const first = MockEventSource.instances[0];
    expect(first?.url).toBe('/api/v1/events/stream?ephemeral=true&cursor=evt-stale');

    first?.emitError();
    vi.advanceTimersByTime(500);

    expect(MockEventSource.instances).toHaveLength(2);
    expect(MockEventSource.instances[1]?.url).toBe('/api/v1/events/stream?ephemeral=true');
    expect(localStorage.getItem('opengram.sse.cursor')).toBeNull();

    unsub();
  });
});
