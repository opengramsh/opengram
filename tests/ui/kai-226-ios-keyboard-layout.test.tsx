// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';

import { ChatComposer } from '@/app/chats/[chatId]/_components/chat-composer';
import { ChatMessages } from '@/app/chats/[chatId]/_components/chat-messages';
import { calculateKeyboardLayout, subscribeToKeyboardLayout } from '@/src/lib/keyboard-layout';

type MockVisualViewport = {
  height: number;
  offsetTop: number;
  addEventListener: (type: 'resize' | 'scroll', listener: () => void) => void;
  removeEventListener: (type: 'resize' | 'scroll', listener: () => void) => void;
  emit: (type: 'resize' | 'scroll') => void;
};

type ListenerType = 'focusout' | 'resize' | 'orientationchange';

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

function createMockKeyboardWindow(viewport: MockVisualViewport, innerHeight = 844) {
  const listeners: Record<ListenerType, Set<() => void>> = {
    focusout: new Set(),
    resize: new Set(),
    orientationchange: new Set(),
  };
  const rafCallbacks = new Map<number, FrameRequestCallback>();
  const timeoutCallbacks = new Map<number, () => void>();
  let nextRafId = 0;
  let nextTimeoutId = 0;

  const mockWindow = {
    innerHeight,
    visualViewport: viewport,
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
    addEventListener: vi.fn().mockImplementation((type: ListenerType, listener: () => void) => {
      listeners[type].add(listener);
    }),
    removeEventListener: vi.fn().mockImplementation((type: ListenerType, listener: () => void) => {
      listeners[type].delete(listener);
    }),
    scrollTo: vi.fn(),
  };

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

  return { mockWindow, listeners, flushRaf, flushTimeouts };
}

describe('KAI-237: keyboard offset runtime behavior', () => {
  it('1) returns 0 when keyboard is closed (844 - 844)', () => {
    expect(calculateKeyboardLayout(844, 844).keyboardOffset).toBe(0);
  });

  it('2) returns 336 when keyboard is open (844 - 508)', () => {
    expect(calculateKeyboardLayout(844, 508).keyboardOffset).toBe(336);
  });

  it('3) ignores visualViewport.offsetTop during keyboard offset updates', () => {
    const viewport = createMockVisualViewport(508, 100);
    const { mockWindow, flushRaf } = createMockKeyboardWindow(viewport);
    const layouts: number[] = [];

    const cleanup = subscribeToKeyboardLayout(mockWindow as unknown as Window, document, (layout) => {
      layouts.push(layout.keyboardOffset);
    });

    flushRaf();
    expect(layouts.at(-1)).toBe(336);

    cleanup();
  });

  it('4) clamps negative keyboard offset to 0', () => {
    expect(calculateKeyboardLayout(844, 900).keyboardOffset).toBe(0);
  });

  it('5) updates keyboard offset on visualViewport resize events', () => {
    const viewport = createMockVisualViewport(844, 0);
    const { mockWindow, flushRaf } = createMockKeyboardWindow(viewport);
    const layouts: number[] = [];

    const cleanup = subscribeToKeyboardLayout(mockWindow as unknown as Window, document, (layout) => {
      layouts.push(layout.keyboardOffset);
    });

    flushRaf();
    expect(layouts.at(-1)).toBe(0);

    viewport.height = 508;
    viewport.emit('resize');
    flushRaf();

    expect(layouts.at(-1)).toBe(336);
    cleanup();
  });

  it('6) resets offset to 0 on focusout when no input remains focused', () => {
    const viewport = createMockVisualViewport(508, 0);
    const { mockWindow, listeners, flushRaf, flushTimeouts } = createMockKeyboardWindow(viewport);
    let keyboardOffset = 0;

    const cleanup = subscribeToKeyboardLayout(mockWindow as unknown as Window, document, (layout) => {
      keyboardOffset = layout.keyboardOffset;
    });

    flushRaf();
    expect(keyboardOffset).toBe(336);

    viewport.height = 844;
    document.body.focus();

    for (const listener of listeners.focusout) {
      listener();
    }

    flushTimeouts();
    flushRaf();

    expect(keyboardOffset).toBe(0);
    cleanup();
  });
});

describe('KAI-237: composer height CSS variable integration', () => {
  let originalResizeObserver: typeof ResizeObserver | undefined;

  beforeEach(() => {
    originalResizeObserver = globalThis.ResizeObserver;
  });

  afterEach(() => {
    document.documentElement.style.removeProperty('--composer-height');
    if (originalResizeObserver) {
      globalThis.ResizeObserver = originalResizeObserver;
    } else {
      // @ts-expect-error test cleanup for missing native ResizeObserver
      delete globalThis.ResizeObserver;
    }
    vi.restoreAllMocks();
  });

  it('7) updates message padding variable when composer height changes', () => {
    let measuredHeight = 80;
    let observerCallback: ((entries: ResizeObserverEntry[], observer: ResizeObserver) => void) | null = null;

    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(() => ({
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 0,
      bottom: measuredHeight,
      width: 320,
      height: measuredHeight,
      toJSON: () => ({}),
    } as DOMRect));

    class MockResizeObserver {
      constructor(callback: ResizeObserverCallback) {
        observerCallback = callback;
      }

      observe() {}
      unobserve() {}
      disconnect() {}
    }

    globalThis.ResizeObserver = MockResizeObserver as unknown as typeof ResizeObserver;

    render(
      <ChatComposer
        composerText=""
        isSending={false}
        isComposerMenuOpen={false}
        selectedModelId=""
        models={[]}
        setComposerText={() => {}}
        setIsComposerMenuOpen={() => {}}
        sendMessage={async () => {}}
        onModelChange={async () => {}}
        handleMicAction={async () => {}}
        stopRecording={() => {}}
        cancelRecording={() => {}}
        audioLevels={[]}
        isRecording={false}
        recordingSeconds={0}
        isUploadingVoiceNote={false}
        showMicSettingsPrompt={false}
        allAttachmentsReady={true}
        uploadComposerFiles={async () => {}}
        pendingAttachments={[]}
        removePendingAttachment={() => {}}
        retryUpload={() => {}}
        cameraInputRef={{ current: null }}
        photosInputRef={{ current: null }}
        filesInputRef={{ current: null }}
        keyboardOffset={0}
      />,
    );

    expect(document.documentElement.style.getPropertyValue('--composer-height')).toBe('80px');

    measuredHeight = 132;
    observerCallback!([] as ResizeObserverEntry[], {} as ResizeObserver);

    expect(document.documentElement.style.getPropertyValue('--composer-height')).toBe('132px');

    const { container } = render(
      <ChatMessages
        feedRef={{ current: null }}
        loading={false}
        messagesLoading={false}
        error={null}
        messages={[]}
        inlineMessageMedia={new Map()}
        pendingReply={false}
        setViewerMediaId={() => {}}
        setPreviewFileId={() => {}}
      />,
    );

    const scrollContainer = container.querySelector('[role="log"]');
    expect(scrollContainer?.getAttribute('style')).toContain('var(--composer-height');
  });
});
