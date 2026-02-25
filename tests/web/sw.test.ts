import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';

import { describe, expect, it, vi } from 'vitest';

type WorkerEvent = {
  notification: {
    close: () => void;
    data?: {
      url?: string;
      chatId?: string;
    };
  };
  waitUntil: (promise: Promise<unknown>) => void;
};

type PushEvent = {
  data?: { text: () => string } | null;
  waitUntil: (promise: Promise<unknown>) => void;
};

function loadServiceWorker(selfObject: Record<string, unknown>) {
  const swPath = join(import.meta.dirname, '..', '..', 'public', 'sw.js');
  const source = readFileSync(swPath, 'utf8');
  vm.runInNewContext(source, { self: selfObject, URL });
}

/** Creates a mock IndexedDB that returns `activeChatId` from the "ui-state" store. */
function createMockIndexedDB(activeChatId: string | null) {
  return {
    open: vi.fn(() => {
      const request = {
        result: {
          objectStoreNames: { contains: () => true },
          transaction: vi.fn(() => ({
            objectStore: vi.fn(() => ({
              get: vi.fn(() => {
                const getReq = {
                  result: activeChatId,
                  onsuccess: null as (() => void) | null,
                  onerror: null as (() => void) | null,
                };
                queueMicrotask(() => getReq.onsuccess?.());
                return getReq;
              }),
            })),
          })),
          close: vi.fn(),
        },
        onsuccess: null as ((e: unknown) => void) | null,
        onerror: null as (() => void) | null,
        onupgradeneeded: null as (() => void) | null,
      };
      queueMicrotask(() => request.onsuccess?.({ target: { result: request.result } }));
      return request;
    }),
  };
}

describe('service worker push suppression via IndexedDB', () => {
  it('should skip showNotification when IndexedDB activeChatId matches', async () => {
    const listeners = new Map<string, (event: PushEvent) => void>();
    const showNotification = vi.fn(async () => undefined);

    const selfObject = {
      addEventListener: (type: string, listener: (event: PushEvent) => void) => {
        listeners.set(type, listener);
      },
      location: { origin: 'https://app.example' },
      clients: { matchAll: vi.fn(async () => []) },
      registration: {
        showNotification,
        pushManager: { subscribe: vi.fn() },
      },
      indexedDB: createMockIndexedDB('chat-42'),
    };

    loadServiceWorker(selfObject);
    const handler = listeners.get('push');
    expect(handler).toBeTypeOf('function');

    const payload = {
      title: 'New message',
      body: 'Hello!',
      data: { chatId: 'chat-42', type: 'message', url: '/chats/chat-42' },
    };

    let pending: Promise<unknown> | null = null;
    handler?.({
      data: { text: () => JSON.stringify(payload) },
      waitUntil: (promise) => { pending = promise; },
    });

    expect(pending).not.toBeNull();
    if (pending) {
      await pending;
    }

    expect(showNotification).not.toHaveBeenCalled();
  });

  it('should show notification when IndexedDB activeChatId is null (app hidden)', async () => {
    const listeners = new Map<string, (event: PushEvent) => void>();
    const showNotification = vi.fn(async () => undefined);

    const selfObject = {
      addEventListener: (type: string, listener: (event: PushEvent) => void) => {
        listeners.set(type, listener);
      },
      location: { origin: 'https://app.example' },
      clients: { matchAll: vi.fn(async () => []) },
      registration: {
        showNotification,
        pushManager: { subscribe: vi.fn() },
      },
      indexedDB: createMockIndexedDB(null),
    };

    loadServiceWorker(selfObject);
    const handler = listeners.get('push');
    expect(handler).toBeTypeOf('function');

    const payload = {
      title: 'New message',
      body: 'Hello!',
      data: { chatId: 'chat-42', type: 'message', url: '/chats/chat-42' },
    };

    let pending: Promise<unknown> | null = null;
    handler?.({
      data: { text: () => JSON.stringify(payload) },
      waitUntil: (promise) => { pending = promise; },
    });

    expect(pending).not.toBeNull();
    if (pending) {
      await pending;
    }

    expect(showNotification).toHaveBeenCalledTimes(1);
  });

  it('should show notification when a different chat is active', async () => {
    const listeners = new Map<string, (event: PushEvent) => void>();
    const showNotification = vi.fn(async () => undefined);

    const selfObject = {
      addEventListener: (type: string, listener: (event: PushEvent) => void) => {
        listeners.set(type, listener);
      },
      location: { origin: 'https://app.example' },
      clients: { matchAll: vi.fn(async () => []) },
      registration: {
        showNotification,
        pushManager: { subscribe: vi.fn() },
      },
      indexedDB: createMockIndexedDB('chat-99'),
    };

    loadServiceWorker(selfObject);
    const handler = listeners.get('push');
    expect(handler).toBeTypeOf('function');

    const payload = {
      title: 'New message',
      body: 'Hello!',
      data: { chatId: 'chat-42', type: 'message', url: '/chats/chat-42' },
    };

    let pending: Promise<unknown> | null = null;
    handler?.({
      data: { text: () => JSON.stringify(payload) },
      waitUntil: (promise) => { pending = promise; },
    });

    expect(pending).not.toBeNull();
    if (pending) {
      await pending;
    }

    expect(showNotification).toHaveBeenCalledTimes(1);
  });

  it('should skip showNotification on iOS PWA (IndexedDB works even when client.focused is undefined)', async () => {
    const listeners = new Map<string, (event: PushEvent) => void>();
    const showNotification = vi.fn(async () => undefined);

    const selfObject = {
      addEventListener: (type: string, listener: (event: PushEvent) => void) => {
        listeners.set(type, listener);
      },
      location: { origin: 'https://app.example' },
      clients: {
        matchAll: vi.fn(async () => [
          {
            url: 'https://app.example/chats/chat-42',
            focused: undefined,
            visibilityState: undefined,
            postMessage: vi.fn(),
          },
        ]),
      },
      registration: {
        showNotification,
        pushManager: { subscribe: vi.fn() },
      },
      indexedDB: createMockIndexedDB('chat-42'),
    };

    loadServiceWorker(selfObject);
    const handler = listeners.get('push');
    expect(handler).toBeTypeOf('function');

    const payload = {
      title: 'New message',
      body: 'Hello!',
      data: { chatId: 'chat-42', type: 'message', url: '/chats/chat-42' },
    };

    let pending: Promise<unknown> | null = null;
    handler?.({
      data: { text: () => JSON.stringify(payload) },
      waitUntil: (promise) => { pending = promise; },
    });

    expect(pending).not.toBeNull();
    if (pending) {
      await pending;
    }

    expect(showNotification).not.toHaveBeenCalled();
  });

  it('should show notification when payload has no chatId', async () => {
    const listeners = new Map<string, (event: PushEvent) => void>();
    const showNotification = vi.fn(async () => undefined);

    const selfObject = {
      addEventListener: (type: string, listener: (event: PushEvent) => void) => {
        listeners.set(type, listener);
      },
      location: { origin: 'https://app.example' },
      clients: { matchAll: vi.fn(async () => []) },
      registration: {
        showNotification,
        pushManager: { subscribe: vi.fn() },
      },
      indexedDB: createMockIndexedDB('chat-42'),
    };

    loadServiceWorker(selfObject);
    const handler = listeners.get('push');
    expect(handler).toBeTypeOf('function');

    const payload = {
      title: 'System alert',
      body: 'Something happened',
      data: { type: 'system', url: '/' },
    };

    let pending: Promise<unknown> | null = null;
    handler?.({
      data: { text: () => JSON.stringify(payload) },
      waitUntil: (promise) => { pending = promise; },
    });

    expect(pending).not.toBeNull();
    if (pending) {
      await pending;
    }

    expect(showNotification).toHaveBeenCalledTimes(1);
  });

  it('should show notification (fail-safe) when IndexedDB is unavailable', async () => {
    const listeners = new Map<string, (event: PushEvent) => void>();
    const showNotification = vi.fn(async () => undefined);

    const selfObject = {
      addEventListener: (type: string, listener: (event: PushEvent) => void) => {
        listeners.set(type, listener);
      },
      location: { origin: 'https://app.example' },
      clients: { matchAll: vi.fn(async () => []) },
      registration: {
        showNotification,
        pushManager: { subscribe: vi.fn() },
      },
      // No indexedDB property — simulates environments where it's unavailable
    };

    loadServiceWorker(selfObject);
    const handler = listeners.get('push');
    expect(handler).toBeTypeOf('function');

    const payload = {
      title: 'New message',
      body: 'Hello!',
      data: { chatId: 'chat-42', type: 'message', url: '/chats/chat-42' },
    };

    let pending: Promise<unknown> | null = null;
    handler?.({
      data: { text: () => JSON.stringify(payload) },
      waitUntil: (promise) => { pending = promise; },
    });

    expect(pending).not.toBeNull();
    if (pending) {
      await pending;
    }

    // When IndexedDB is unavailable, fail safe — show notification
    expect(showNotification).toHaveBeenCalledTimes(1);
  });

  it('should show notification (fail-safe) when IndexedDB open() fails', async () => {
    const listeners = new Map<string, (event: PushEvent) => void>();
    const showNotification = vi.fn(async () => undefined);

    const selfObject = {
      addEventListener: (type: string, listener: (event: PushEvent) => void) => {
        listeners.set(type, listener);
      },
      location: { origin: 'https://app.example' },
      clients: { matchAll: vi.fn(async () => []) },
      registration: {
        showNotification,
        pushManager: { subscribe: vi.fn() },
      },
      indexedDB: {
        open: vi.fn(() => {
          const request = {
            onsuccess: null as (() => void) | null,
            onerror: null as (() => void) | null,
            onupgradeneeded: null as (() => void) | null,
          };
          queueMicrotask(() => request.onerror?.());
          return request;
        }),
      },
    };

    loadServiceWorker(selfObject);
    const handler = listeners.get('push');
    expect(handler).toBeTypeOf('function');

    const payload = {
      title: 'New message',
      body: 'Hello!',
      data: { chatId: 'chat-42', type: 'message', url: '/chats/chat-42' },
    };

    let pending: Promise<unknown> | null = null;
    handler?.({
      data: { text: () => JSON.stringify(payload) },
      waitUntil: (promise) => { pending = promise; },
    });

    expect(pending).not.toBeNull();
    if (pending) {
      await pending;
    }

    // When IndexedDB fails, fail safe — show notification
    expect(showNotification).toHaveBeenCalledTimes(1);
  });
});

describe('service worker notification click handling', () => {
  it('focuses only exact matching chat URL', async () => {
    const listeners = new Map<string, (event: WorkerEvent) => void>();
    const wrongFocus = vi.fn(async () => undefined);
    const exactFocus = vi.fn(async () => undefined);
    const wrongPostMessage = vi.fn(() => undefined);
    const exactPostMessage = vi.fn(() => undefined);
    const openWindow = vi.fn(async () => undefined);

    const selfObject = {
      addEventListener: (type: string, listener: (event: WorkerEvent) => void) => {
        listeners.set(type, listener);
      },
      location: { origin: 'https://app.example' },
      clients: {
        matchAll: vi.fn(async () => [
          { url: 'https://app.example/chats/10', focus: wrongFocus, postMessage: wrongPostMessage },
          { url: 'https://app.example/chats/1', focus: exactFocus, postMessage: exactPostMessage },
        ]),
        openWindow,
      },
      registration: {
        showNotification: vi.fn(async () => undefined),
      },
    };

    loadServiceWorker(selfObject);
    const handler = listeners.get('notificationclick');
    expect(handler).toBeTypeOf('function');

    let pending: Promise<unknown> | null = null;
    handler?.({
      notification: {
        close: vi.fn(),
        data: { url: '/chats/1' },
      },
      waitUntil: (promise) => {
        pending = promise;
      },
    });

    expect(pending).not.toBeNull();
    if (pending) {
      await pending;
    }

    expect(exactFocus).toHaveBeenCalledTimes(1);
    expect(wrongFocus).not.toHaveBeenCalled();
    expect(exactPostMessage).toHaveBeenCalledWith({
      type: 'push:navigate',
      url: '/chats/1',
      chatId: '',
    });
    expect(wrongPostMessage).not.toHaveBeenCalled();
    expect(openWindow).not.toHaveBeenCalled();
  });

  it('opens deep link and posts navigate message when existing client cannot navigate', async () => {
    const listeners = new Map<string, (event: WorkerEvent) => void>();
    const rootFocus = vi.fn(async () => undefined);
    const rootPostMessage = vi.fn(() => undefined);
    const openedFocus = vi.fn(async () => undefined);
    const openedPostMessage = vi.fn(() => undefined);
    const openWindow = vi.fn(async () => ({ focus: openedFocus, postMessage: openedPostMessage }));

    const selfObject = {
      addEventListener: (type: string, listener: (event: WorkerEvent) => void) => {
        listeners.set(type, listener);
      },
      location: { origin: 'https://app.example' },
      clients: {
        matchAll: vi.fn(async () => [
          { url: 'https://app.example/', focus: rootFocus, postMessage: rootPostMessage },
        ]),
        openWindow,
      },
      registration: {
        showNotification: vi.fn(async () => undefined),
      },
    };

    loadServiceWorker(selfObject);
    const handler = listeners.get('notificationclick');
    expect(handler).toBeTypeOf('function');

    let pending: Promise<unknown> | null = null;
    handler?.({
      notification: {
        close: vi.fn(),
        data: { chatId: 'chat-2' },
      },
      waitUntil: (promise) => {
        pending = promise;
      },
    });

    expect(pending).not.toBeNull();
    if (pending) {
      await pending;
    }

    expect(openWindow).toHaveBeenCalledWith('/chats/chat-2');
    expect(rootFocus).not.toHaveBeenCalled();
    expect(rootPostMessage).not.toHaveBeenCalled();
    expect(openedPostMessage).toHaveBeenCalledWith({
      type: 'push:navigate',
      url: '/chats/chat-2',
      chatId: 'chat-2',
    });
    expect(openedFocus).toHaveBeenCalledTimes(1);
  });

  it('falls back to same-origin chat path when notification URL is cross-origin', async () => {
    const listeners = new Map<string, (event: WorkerEvent) => void>();
    const openWindow = vi.fn(async () => ({ focus: vi.fn(async () => undefined), postMessage: vi.fn(() => undefined) }));

    const selfObject = {
      addEventListener: (type: string, listener: (event: WorkerEvent) => void) => {
        listeners.set(type, listener);
      },
      location: { origin: 'https://app.example' },
      clients: {
        matchAll: vi.fn(async () => []),
        openWindow,
      },
      registration: {
        showNotification: vi.fn(async () => undefined),
      },
    };

    loadServiceWorker(selfObject);
    const handler = listeners.get('notificationclick');
    expect(handler).toBeTypeOf('function');

    let pending: Promise<unknown> | null = null;
    handler?.({
      notification: {
        close: vi.fn(),
        data: { chatId: 'chat-9', url: 'https://malicious.example/phish' },
      },
      waitUntil: (promise) => {
        pending = promise;
      },
    });

    expect(pending).not.toBeNull();
    if (pending) {
      await pending;
    }

    expect(openWindow).toHaveBeenCalledWith('/chats/chat-9');
  });

  it('falls back to existing client message when openWindow throws', async () => {
    const listeners = new Map<string, (event: WorkerEvent) => void>();
    const fallbackFocus = vi.fn(async () => undefined);
    const fallbackPostMessage = vi.fn(() => undefined);
    const openWindow = vi.fn(async () => {
      throw new Error('openWindow failed');
    });

    const selfObject = {
      addEventListener: (type: string, listener: (event: WorkerEvent) => void) => {
        listeners.set(type, listener);
      },
      location: { origin: 'https://app.example' },
      clients: {
        matchAll: vi.fn(async () => [
          { url: 'https://app.example/', focus: fallbackFocus, postMessage: fallbackPostMessage },
        ]),
        openWindow,
      },
      registration: {
        showNotification: vi.fn(async () => undefined),
      },
    };

    loadServiceWorker(selfObject);
    const handler = listeners.get('notificationclick');
    expect(handler).toBeTypeOf('function');

    let pending: Promise<unknown> | null = null;
    handler?.({
      notification: {
        close: vi.fn(),
        data: { chatId: 'chat-fallback' },
      },
      waitUntil: (promise) => {
        pending = promise;
      },
    });

    expect(pending).not.toBeNull();
    if (pending) {
      await pending;
    }

    expect(openWindow).toHaveBeenCalledWith('/chats/chat-fallback');
    expect(fallbackPostMessage).toHaveBeenCalledWith({
      type: 'push:navigate',
      url: '/chats/chat-fallback',
      chatId: 'chat-fallback',
    });
    expect(fallbackFocus).toHaveBeenCalledTimes(1);
  });
});
