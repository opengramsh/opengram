import { describe, expect, it } from 'vitest';

import {
  buildChatsQuery,
  formatInboxTimestamp,
  getPendingRequestsTotal,
  sortInboxChats,
} from '@/src/lib/inbox';

describe('inbox utils', () => {
  it('formats today timestamps as time', () => {
    const now = new Date(2026, 1, 18, 20, 30, 0);
    const messageDate = new Date(2026, 1, 18, 8, 16, 0);
    const result = formatInboxTimestamp(messageDate, now);

    expect(result).toMatch(/^\d{2}:\d{2}$/);
  });

  it('formats yesterday label', () => {
    const now = new Date(2026, 1, 18, 20, 30, 0);
    const messageDate = new Date(2026, 1, 17, 21, 0, 0);

    expect(formatInboxTimestamp(messageDate, now)).toBe('Yesterday');
  });

  it('formats dates in last week as weekday', () => {
    const now = new Date(2026, 1, 18, 20, 30, 0);
    const messageDate = new Date(2026, 1, 15, 12, 0, 0);
    const expectedDay = new Intl.DateTimeFormat(undefined, { weekday: 'short' }).format(messageDate);

    expect(formatInboxTimestamp(messageDate, now)).toBe(expectedDay);
  });

  it('formats older dates as locale short date', () => {
    const now = new Date(2026, 1, 18, 20, 30, 0);
    const messageDate = new Date(2026, 0, 3, 12, 0, 0);
    const expected = new Intl.DateTimeFormat(undefined, { dateStyle: 'short' }).format(messageDate);

    expect(formatInboxTimestamp(messageDate, now)).toBe(expected);
  });

  it('builds chats query params from active filters', () => {
    const query = buildChatsQuery({
      query: ' release ',
      agentId: 'agent-1',
      state: 'Open',
      archived: false,
      limit: 50,
    });

    expect(query).toBe('?archived=false&query=release&agentId=agent-1&state=Open&limit=50');
  });

  it('sums pending request counts defensively', () => {
    const total = getPendingRequestsTotal([
      { pending_requests_count: 2 },
      { pending_requests_count: null },
      { pending_requests_count: -10 },
      { pending_requests_count: 1 },
    ]);

    expect(total).toBe(3);
  });

  it('sorts chats with pinned first then last_message_at desc', () => {
    const sorted = sortInboxChats([
      { id: 'a', pinned: false, last_message_at: '2026-02-18T10:00:00.000Z' },
      { id: 'b', pinned: true, last_message_at: null },
      { id: 'c', pinned: false, last_message_at: '2026-02-18T12:00:00.000Z' },
    ]);

    expect(sorted.map((chat) => chat.id)).toEqual(['b', 'c', 'a']);
  });
});
