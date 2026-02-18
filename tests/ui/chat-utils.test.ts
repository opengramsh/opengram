import {
  resolveEdgeSwipeBack,
  shouldStartEdgeSwipeBack,
  sortMessagesForFeed,
} from '@/src/lib/chat';

describe('chat utils', () => {
  it('sorts messages in ascending created_at order for feed rendering', () => {
    const sorted = sortMessagesForFeed([
      { id: 'c', created_at: '2026-02-18T10:00:02.000Z' },
      { id: 'a', created_at: '2026-02-18T10:00:01.000Z' },
      { id: 'b', created_at: '2026-02-18T10:00:01.000Z' },
    ]);

    expect(sorted.map((message) => message.id)).toEqual(['a', 'b', 'c']);
  });

  it('starts edge swipe only near the left edge', () => {
    expect(shouldStartEdgeSwipeBack(8)).toBe(true);
    expect(shouldStartEdgeSwipeBack(20)).toBe(true);
    expect(shouldStartEdgeSwipeBack(21)).toBe(false);
  });

  it('triggers back navigation only with threshold and positive velocity', () => {
    const triggered = resolveEdgeSwipeBack(80, 8, 250);
    expect(triggered.shouldNavigateBack).toBe(true);
    expect(triggered.velocity).toBeGreaterThan(0);

    const shortSwipe = resolveEdgeSwipeBack(40, 2, 120);
    expect(shortSwipe.shouldNavigateBack).toBe(false);

    const slowSwipe = resolveEdgeSwipeBack(80, 2, 1200);
    expect(slowSwipe.shouldNavigateBack).toBe(false);

    const verticalSwipe = resolveEdgeSwipeBack(80, 120, 200);
    expect(verticalSwipe.shouldNavigateBack).toBe(false);
  });
});
