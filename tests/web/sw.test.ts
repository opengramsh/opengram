import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';

import { describe, expect, it, vi } from 'vitest';

type WorkerEvent = {
  notification: {
    close: () => void;
    data?: {
      url?: string;
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
    const openWindow = vi.fn(async () => undefined);

    const selfObject = {
      addEventListener: (type: string, listener: (event: WorkerEvent) => void) => {
        listeners.set(type, listener);
      },
      location: { origin: 'https://app.example' },
      clients: {
        matchAll: vi.fn(async () => [
          { url: 'https://app.example/chats/10', focus: wrongFocus },
          { url: 'https://app.example/chats/1', focus: exactFocus },
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
    expect(openWindow).not.toHaveBeenCalled();
  });
});
