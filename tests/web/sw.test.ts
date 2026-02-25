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

function loadServiceWorker(selfObject: Record<string, unknown>) {
  const swPath = join(import.meta.dirname, '..', '..', 'public', 'sw.js');
  const source = readFileSync(swPath, 'utf8');
  vm.runInNewContext(source, { self: selfObject, URL });
}

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
