// @vitest-environment jsdom

/**
 * KAI-218: Persistent bottom gap after keyboard dismiss on iOS PWA
 *
 * The keyboard offset tracking in use-chat-page-effects.ts relies solely on
 * visualViewport resize/scroll events. On iOS PWA, these events can fail to
 * fire when the keyboard is dismissed, leaving keyboardOffset stuck at a
 * non-zero value.
 *
 * This test verifies that:
 * 1. The offset calculation correctly computes 0 when the viewport is full-size
 * 2. A focusout/blur event resets the offset to 0 (currently missing — FAILS)
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Helpers to simulate the visualViewport behavior used by the effect
// ---------------------------------------------------------------------------

function createMockVisualViewport(overrides: { height: number; offsetTop?: number }) {
  const listeners: Record<string, Set<() => void>> = {};

  return {
    height: overrides.height,
    offsetTop: overrides.offsetTop ?? 0,
    addEventListener(type: string, fn: () => void) {
      if (!listeners[type]) listeners[type] = new Set();
      listeners[type].add(fn);
    },
    removeEventListener(type: string, fn: () => void) {
      listeners[type]?.delete(fn);
    },
    _fire(type: string) {
      for (const fn of listeners[type] ?? []) fn();
    },
    _setHeight(h: number) {
      this.height = h;
    },
  };
}

/**
 * Reproduces the core offset calculation from use-chat-page-effects.ts:371-390
 */
function computeKeyboardOffset(innerHeight: number, viewportHeight: number, viewportOffsetTop: number): number {
  return Math.max(0, innerHeight - viewportHeight - viewportOffsetTop);
}

// ---------------------------------------------------------------------------

describe('KAI-218: keyboard offset calculation', () => {
  it('computes non-zero offset when keyboard is open', () => {
    // iPhone 15: innerHeight=852, keyboard takes ~340px
    const offset = computeKeyboardOffset(852, 512, 0);
    expect(offset).toBe(340);
  });

  it('computes zero offset when keyboard is dismissed and viewport is full', () => {
    const offset = computeKeyboardOffset(852, 852, 0);
    expect(offset).toBe(0);
  });

  it('computes zero when viewport height exceeds innerHeight (iOS edge case)', () => {
    // Can happen transiently on iOS when viewport updates before innerHeight
    const offset = computeKeyboardOffset(852, 900, 0);
    expect(offset).toBe(0); // Math.max(0, ...) clamps negative
  });
});

describe('KAI-218: visualViewport resize resets offset', () => {
  let mockViewport: ReturnType<typeof createMockVisualViewport>;
  let keyboardOffset: number;
  let cleanup: (() => void) | undefined;

  beforeEach(() => {
    keyboardOffset = 0;
    mockViewport = createMockVisualViewport({ height: 852 });

    // Simulate the effect setup from use-chat-page-effects.ts:371-390
    Object.defineProperty(window, 'innerHeight', { value: 852, writable: true, configurable: true });
    Object.defineProperty(window, 'visualViewport', { value: mockViewport, writable: true, configurable: true });

    const setKeyboardOffset = (v: number) => { keyboardOffset = v; };

    const updateOffset = () => {
      const vp = window.visualViewport!;
      const nextOffset = Math.max(0, window.innerHeight - vp.height - vp.offsetTop);
      setKeyboardOffset(nextOffset);
    };

    updateOffset(); // initial call
    mockViewport.addEventListener('resize', updateOffset);
    mockViewport.addEventListener('scroll', updateOffset);

    cleanup = () => {
      mockViewport.removeEventListener('resize', updateOffset);
      mockViewport.removeEventListener('scroll', updateOffset);
    };
  });

  afterEach(() => {
    cleanup?.();
    vi.restoreAllMocks();
  });

  it('updates offset when keyboard opens via viewport resize', () => {
    // Simulate keyboard opening: viewport shrinks
    mockViewport._setHeight(512);
    mockViewport._fire('resize');
    expect(keyboardOffset).toBe(340);
  });

  it('resets offset when keyboard dismisses via viewport resize', () => {
    // Open keyboard
    mockViewport._setHeight(512);
    mockViewport._fire('resize');
    expect(keyboardOffset).toBe(340);

    // Dismiss keyboard — viewport returns to full height
    mockViewport._setHeight(852);
    mockViewport._fire('resize');
    expect(keyboardOffset).toBe(0);
  });
});

describe('KAI-218: offset resets on focusout (missing — should FAIL)', () => {
  /**
   * This test asserts that blurring out of all input/textarea elements
   * forces keyboardOffset to 0, as a fallback for when iOS PWA does not
   * fire the visualViewport resize event on keyboard dismiss.
   *
   * CURRENT STATE: The codebase has NO focusout/blur listener for
   * keyboard offset reset. This test documents the missing behavior and
   * will pass once the fix is implemented.
   */
  it('should reset keyboardOffset to 0 when all inputs lose focus', async () => {
    // Read the source file that contains the keyboard tracking effect
    // and verify it includes a focusout-based reset mechanism.
    //
    // We check the actual source because the effect is tightly coupled
    // to the React component tree and cannot be unit-tested in isolation
    // without rendering the full ChatPage (which needs API mocks, router, etc).

    const { readFileSync } = await import('node:fs');
    const source = readFileSync(
      'app/chats/[chatId]/_hooks/use-chat-page-effects.ts',
      'utf-8',
    );

    // The effect should listen for focusout or blur to reset the offset.
    // This can be on window, document, or a specific element.
    const hasFocusOutReset =
      source.includes('focusout') || source.includes("'blur'") || source.includes('"blur"');

    expect(
      hasFocusOutReset,
      'use-chat-page-effects.ts should have a focusout/blur listener to reset keyboardOffset on iOS keyboard dismiss',
    ).toBe(true);
  });

  it('keyboard tracking should not be scoped only to the chat page component', async () => {
    // The bug report specifies: "global cleanup not tied to a single chat component"
    // Verify that keyboard tracking exists at a global level (app.tsx, inbox-layout, or a shared hook)
    // not just inside use-chat-page-effects.ts.

    const { readFileSync } = await import('node:fs');

    // Check if any global-level file references keyboard offset tracking
    const globalFiles = [
      'src/client/app.tsx',
      'src/client/pages/inbox-layout.tsx',
    ];

    const hasGlobalKeyboardTracking = globalFiles.some((file) => {
      const content = readFileSync(file, 'utf-8');
      return (
        content.includes('keyboardOffset') ||
        content.includes('keyboard-offset') ||
        content.includes('visualViewport') ||
        content.includes('keyboard')
      );
    });

    expect(
      hasGlobalKeyboardTracking,
      'Keyboard offset tracking should exist at a global level (app or layout), not only inside the chat page',
    ).toBe(true);
  });
});
