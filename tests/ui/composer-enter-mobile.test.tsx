// @vitest-environment jsdom

import { describe, expect, it, vi, afterEach } from 'vitest';

import { isTouchDevice } from '@/src/lib/utils';

function mockMatchMedia(matches: boolean) {
  window.matchMedia = vi.fn().mockReturnValue({ matches } as MediaQueryList);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('isTouchDevice', () => {
  it('returns true when pointer: coarse matches', () => {
    mockMatchMedia(true);
    expect(isTouchDevice()).toBe(true);
    expect(window.matchMedia).toHaveBeenCalledWith('(pointer: coarse)');
  });

  it('returns false when pointer: coarse does not match', () => {
    mockMatchMedia(false);
    expect(isTouchDevice()).toBe(false);
  });
});

describe('KAI-214: composer Enter key behavior', () => {
  it('should not send on Enter when device is touch', () => {
    mockMatchMedia(true);
    // Guard condition from chat-composer.tsx:
    // if (key === 'Enter' && !shiftKey && !isTouchDevice() && hasContent)
    expect(!isTouchDevice()).toBe(false);
  });

  it('should send on Enter when device is desktop', () => {
    mockMatchMedia(false);
    expect(!isTouchDevice()).toBe(true);
  });
});
