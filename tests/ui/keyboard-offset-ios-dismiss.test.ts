// @vitest-environment jsdom

/**
 * KAI-218: Persistent bottom gap after keyboard dismiss on iOS PWA
 *
 * These tests verify runtime keyboard offset behavior through the shared
 * keyboard-layout utility, including the focusout fallback used when iOS
 * fails to emit visualViewport resize on dismiss.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { calculateKeyboardLayout, subscribeToKeyboardLayout } from '@/src/lib/keyboard-layout';

type MockVisualViewport = {
  height: number;
  offsetTop: number;
  addEventListener: (type: 'resize' | 'scroll', listener: () => void) => void;
  removeEventListener: (type: 'resize' | 'scroll', listener: () => void) => void;
  emit: (type: 'resize' | 'scroll') => void;
};

type MockKeyboardWindow = {
  innerHeight: number;
  visualViewport: MockVisualViewport;
  requestAnimationFrame: ReturnType<typeof vi.fn>;
  cancelAnimationFrame: ReturnType<typeof vi.fn>;
  setTimeout: ReturnType<typeof vi.fn>;
  clearTimeout: ReturnType<typeof vi.fn>;
  addEventListener: ReturnType<typeof vi.fn>;
  removeEventListener: ReturnType<typeof vi.fn>;
  getComputedStyle: ReturnType<typeof vi.fn>;
  scrollTo: ReturnType<typeof vi.fn>;
};

function createMockVisualViewport(overrides: { height: number; offsetTop?: number }): MockVisualViewport {
  const listeners: Record<string, Set<() => void>> = {};

  return {
    height: overrides.height,
    offsetTop: overrides.offsetTop ?? 0,
    addEventListener(type, fn) {
      if (!listeners[type]) listeners[type] = new Set();
      listeners[type].add(fn);
    },
    removeEventListener(type, fn) {
      listeners[type]?.delete(fn);
    },
    emit(type) {
      for (const fn of listeners[type] ?? []) fn();
    },
  };
}

describe('KAI-218: keyboard offset calculation', () => {
  it('computes non-zero offset when keyboard is open', () => {
    const layout = calculateKeyboardLayout(852, 512, 0, 0);
    expect(layout.keyboardOffset).toBe(340);
  });

  it('computes zero offset when keyboard is dismissed and viewport is full', () => {
    const layout = calculateKeyboardLayout(852, 852, 0, 0);
    expect(layout.keyboardOffset).toBe(0);
  });

  it('computes zero when viewport height exceeds innerHeight (iOS edge case)', () => {
    const layout = calculateKeyboardLayout(852, 900, 0, 0);
    expect(layout.keyboardOffset).toBe(0);
  });
});

describe('KAI-218: visualViewport + focusout fallback', () => {
  let mockViewport: MockVisualViewport;
  let mockWindow: MockKeyboardWindow;
  let cleanup: (() => void) | undefined;
  let keyboardOffset = 0;
  let rafCallbacks: Map<number, FrameRequestCallback>;
  let timeoutCallbacks: Map<number, () => void>;
  let listeners: Record<'focusout' | 'resize' | 'orientationchange', Set<() => void>>;
  let nextRafId = 0;
  let nextTimeoutId = 0;

  const flushRaf = () => {
    const pending = [...rafCallbacks.entries()];
    rafCallbacks.clear();
    for (const [, callback] of pending) {
      callback(0);
    }
  };

  const flushTimeouts = () => {
    const pending = [...timeoutCallbacks.entries()];
    timeoutCallbacks.clear();
    for (const [, callback] of pending) {
      callback();
    }
  };

  beforeEach(() => {
    mockViewport = createMockVisualViewport({ height: 852 });
    rafCallbacks = new Map();
    timeoutCallbacks = new Map();
    listeners = {
      focusout: new Set(),
      resize: new Set(),
      orientationchange: new Set(),
    };
    nextRafId = 0;
    nextTimeoutId = 0;
    keyboardOffset = 0;

    mockWindow = {
      innerHeight: 852,
      visualViewport: mockViewport,
      requestAnimationFrame: vi.fn().mockImplementation((callback: FrameRequestCallback) => {
        const id = ++nextRafId;
        rafCallbacks.set(id, callback);
        return id;
      }),
      cancelAnimationFrame: vi.fn().mockImplementation((id: number) => {
        rafCallbacks.delete(id);
      }),
      setTimeout: vi.fn().mockImplementation((handler: () => void) => {
        const id = ++nextTimeoutId;
        timeoutCallbacks.set(id, handler);
        return id;
      }),
      clearTimeout: vi.fn().mockImplementation((id: number) => {
        timeoutCallbacks.delete(id);
      }),
      addEventListener: vi.fn().mockImplementation((type: 'focusout' | 'resize' | 'orientationchange', listener: () => void) => {
        listeners[type].add(listener);
      }),
      removeEventListener: vi.fn().mockImplementation((type: 'focusout' | 'resize' | 'orientationchange', listener: () => void) => {
        listeners[type].delete(listener);
      }),
      getComputedStyle: vi.fn().mockReturnValue({ paddingBottom: '0px' } as CSSStyleDeclaration),
      scrollTo: vi.fn(),
    };

    cleanup = subscribeToKeyboardLayout(mockWindow as unknown as Window, document, (layout) => {
      keyboardOffset = layout.keyboardOffset;
    });
    flushRaf();
  });

  afterEach(() => {
    cleanup?.();
    vi.restoreAllMocks();
  });

  it('updates offset when keyboard opens via viewport resize', () => {
    mockViewport.height = 512;
    mockViewport.emit('resize');
    flushRaf();
    expect(keyboardOffset).toBe(340);
  });

  it('resets offset on focusout even when viewport resize is missing', () => {
    mockViewport.height = 512;
    mockViewport.emit('resize');
    flushRaf();
    expect(keyboardOffset).toBe(340);

    mockViewport.height = 852;
    document.body.focus();

    for (const listener of listeners.focusout) {
      listener();
    }
    flushTimeouts();
    flushRaf();

    expect(keyboardOffset).toBe(0);
  });

  it('detaches listeners on cleanup', () => {
    const focusoutBeforeCleanup = listeners.focusout.size;
    expect(focusoutBeforeCleanup).toBeGreaterThan(0);

    cleanup?.();
    cleanup = undefined;

    expect(listeners.focusout.size).toBe(0);
    expect(listeners.resize.size).toBe(0);
    expect(listeners.orientationchange.size).toBe(0);
  });
});
