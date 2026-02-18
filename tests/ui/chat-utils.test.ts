import {
  applyStreamingChunk,
  applyStreamingComplete,
  resolveEdgeSwipeBack,
  shouldStartEdgeSwipeBack,
  sortMessagesForFeed,
  upsertFeedMessage,
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

  it('triggers back navigation with horizontal threshold crossing', () => {
    const triggered = resolveEdgeSwipeBack(80, 8, 250);
    expect(triggered.shouldNavigateBack).toBe(true);
    expect(triggered.velocity).toBeGreaterThan(0);

    const shortSwipe = resolveEdgeSwipeBack(40, 2, 120);
    expect(shortSwipe.shouldNavigateBack).toBe(false);

    const slowSwipe = resolveEdgeSwipeBack(80, 2, 1200);
    expect(slowSwipe.shouldNavigateBack).toBe(true);

    const verticalSwipe = resolveEdgeSwipeBack(80, 120, 200);
    expect(verticalSwipe.shouldNavigateBack).toBe(false);
  });

  it('upserts incoming feed message by id and keeps feed sorted', () => {
    const sorted = upsertFeedMessage(
      [
        { id: 'b', created_at: '2026-02-18T10:00:02.000Z' },
        { id: 'a', created_at: '2026-02-18T10:00:01.000Z' },
      ],
      { id: 'a', created_at: '2026-02-18T10:00:03.000Z' },
    );

    expect(sorted.map((message) => message.id)).toEqual(['b', 'a']);
  });

  it('applies streaming chunk and completion transitions', () => {
    const initial = [
      {
        id: 'm1',
        role: 'agent' as const,
        sender_id: 'agent-default',
        created_at: '2026-02-18T10:00:00.000Z',
        content_final: null,
        content_partial: 'hel',
        stream_state: 'streaming' as const,
      },
    ];

    const chunked = applyStreamingChunk(initial, 'm1', 'lo');
    expect(chunked[0]?.content_partial).toBe('hello');
    expect(chunked[0]?.stream_state).toBe('streaming');

    const completed = applyStreamingComplete(chunked, 'm1', 'hello world');
    expect(completed[0]?.content_final).toBe('hello world');
    expect(completed[0]?.content_partial).toBeNull();
    expect(completed[0]?.stream_state).toBe('complete');
  });

  it('marks streaming message as cancelled without dropping partial text', () => {
    const initial = [
      {
        id: 'm1',
        role: 'agent' as const,
        sender_id: 'agent-default',
        created_at: '2026-02-18T10:00:00.000Z',
        content_final: null,
        content_partial: 'still here',
        stream_state: 'streaming' as const,
      },
    ];

    const cancelled = applyStreamingComplete(initial, 'm1', undefined, 'cancelled');
    expect(cancelled[0]?.content_partial).toBe('still here');
    expect(cancelled[0]?.stream_state).toBe('cancelled');
  });
});
