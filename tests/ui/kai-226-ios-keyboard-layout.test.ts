// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { calculateKeyboardLayout, createSafeAreaBottomCache, subscribeToKeyboardLayout } from '@/src/lib/keyboard-layout';

type MockVisualViewport = {
  height: number;
  offsetTop: number;
  addEventListener: (type: 'resize' | 'scroll', listener: () => void) => void;
  removeEventListener: (type: 'resize' | 'scroll', listener: () => void) => void;
  emit: (type: 'resize' | 'scroll') => void;
};

function createMockVisualViewport(height: number, offsetTop = 0): MockVisualViewport {
  const listeners: Record<string, Set<() => void>> = {};
  return {
    height,
    offsetTop,
    addEventListener(type, listener) {
      if (!listeners[type]) {
        listeners[type] = new Set();
      }
      listeners[type].add(listener);
    },
    removeEventListener(type, listener) {
      listeners[type]?.delete(listener);
    },
    emit(type) {
      for (const listener of listeners[type] ?? []) {
        listener();
      }
    },
  };
}

describe('KAI-226: keyboard layout math', () => {
  it('computes keyboard offset from visualViewport and subtracts safe-area bottom once', () => {
    const layout = calculateKeyboardLayout(852, 512, 0, 34);
    expect(layout.keyboardOffset).toBe(306);
    expect(layout.visualViewportHeight).toBe(512);
  });

  it('clamps negative offsets to zero during transient viewport states', () => {
    const layout = calculateKeyboardLayout(852, 860, 0, 34);
    expect(layout.keyboardOffset).toBe(0);
    expect(layout.visualViewportHeight).toBe(860);
  });
});

describe('KAI-226: safe-area caching', () => {
  const originalGetComputedStyle = window.getComputedStyle.bind(window);

  afterEach(() => {
    window.getComputedStyle = originalGetComputedStyle;
  });

  it('reuses cached safe-area measurement until explicitly refreshed', () => {
    const getComputedStyleMock = vi.fn().mockReturnValue({ paddingBottom: '34px' } as CSSStyleDeclaration);
    window.getComputedStyle = getComputedStyleMock;
    const cache = createSafeAreaBottomCache(document, window);

    expect(cache.read()).toBe(34);
    expect(cache.read()).toBe(34);
    expect(getComputedStyleMock).toHaveBeenCalledTimes(1);

    expect(cache.refresh()).toBe(34);
    expect(getComputedStyleMock).toHaveBeenCalledTimes(2);
  });
});

describe('KAI-226: visualViewport event-driven updates', () => {
  let mockViewport: MockVisualViewport;
  let cleanup: () => void;
  let listeners: Record<string, Set<() => void>>;
  let mockWindow: Window;
  let rafCallbacks: Map<number, FrameRequestCallback>;
  let nextRafId: number;

  const flushRaf = () => {
    const pending = [...rafCallbacks.entries()];
    rafCallbacks.clear();
    for (const [, callback] of pending) {
      callback(0);
    }
  };

  beforeEach(() => {
    mockViewport = createMockVisualViewport(852, 0);
    rafCallbacks = new Map();
    nextRafId = 0;
    listeners = {
      focusout: new Set(),
      resize: new Set(),
      orientationchange: new Set(),
    };
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
        handler();
        return 1;
      }),
      clearTimeout: vi.fn(),
      addEventListener: vi.fn().mockImplementation((type: string, listener: () => void) => {
        listeners[type]?.add(listener);
      }),
      removeEventListener: vi.fn().mockImplementation((type: string, listener: () => void) => {
        listeners[type]?.delete(listener);
      }),
      getComputedStyle: vi.fn().mockReturnValue({ paddingBottom: '34px' }),
      scrollTo: vi.fn(),
    } as unknown as Window;
  });

  afterEach(() => {
    cleanup?.();
    vi.restoreAllMocks();
  });

  it('recomputes keyboard offset on visualViewport resize and scroll events', () => {
    const layouts: Array<{ keyboardOffset: number; visualViewportHeight: number }> = [];
    cleanup = subscribeToKeyboardLayout(mockWindow, document, (layout) => {
      layouts.push(layout);
    });
    flushRaf();

    expect(layouts.at(-1)).toEqual({ keyboardOffset: 0, visualViewportHeight: 852 });

    mockViewport.height = 512;
    mockViewport.emit('resize');
    flushRaf();
    expect(layouts.at(-1)).toEqual({ keyboardOffset: 306, visualViewportHeight: 512 });

    mockViewport.height = 560;
    mockViewport.offsetTop = 8;
    mockViewport.emit('scroll');
    flushRaf();
    expect(layouts.at(-1)).toEqual({ keyboardOffset: 250, visualViewportHeight: 568 });
  });
});
