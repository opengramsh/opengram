import { describe, expect, it } from 'vitest';

import { buildInlineMessageMedia, formatBytes, formatDuration, mediaSortAsc } from '@/app/chats/[chatId]/_lib/chat-utils';
import type { MediaItem, Message } from '@/app/chats/[chatId]/_lib/types';

describe('chat utils derived helpers', () => {
  it('builds inline message media by merging message linkage and trace media', () => {
    const messages: Message[] = [
      {
        id: 'm1',
        role: 'user',
        sender_id: 'user:primary',
        created_at: '2026-02-19T00:00:00.000Z',
        content_final: 'hello',
        content_partial: null,
        stream_state: 'none',
        trace: { mediaId: 'img-2' },
      },
    ];

    const image1: MediaItem = {
      id: 'img-1',
      message_id: 'm1',
      filename: 'first.png',
      created_at: '2026-02-19T00:00:02.000Z',
      byte_size: 10,
      content_type: 'image/png',
      kind: 'image',
    };
    const image2: MediaItem = {
      id: 'img-2',
      message_id: null,
      filename: 'second.png',
      created_at: '2026-02-19T00:00:01.000Z',
      byte_size: 12,
      content_type: 'image/png',
      kind: 'image',
    };

    const byMessage = new Map<string, MediaItem[]>([['m1', [image1]]]);
    const byId = new Map<string, MediaItem>([
      ['img-1', image1],
      ['img-2', image2],
    ]);

    const result = buildInlineMessageMedia(messages, byMessage, byId);
    expect(result.get('m1')?.map((item) => item.id)).toEqual(['img-2', 'img-1']);
  });

  it('formats bytes and duration consistently', () => {
    expect(formatBytes(900)).toBe('900 B');
    expect(formatBytes(2048)).toBe('2 KB');
    expect(formatDuration(65.8)).toBe('1:05');
    expect(formatDuration(-1)).toBe('0:00');
  });

  it('sorts media chronologically with id tie-breaker', () => {
    const a = { created_at: '2026-02-19T00:00:00.000Z', id: 'b' } as MediaItem;
    const b = { created_at: '2026-02-19T00:00:00.000Z', id: 'a' } as MediaItem;
    const c = { created_at: '2026-02-19T00:00:01.000Z', id: 'c' } as MediaItem;

    expect([a, b, c].sort(mediaSortAsc).map((item) => item.id)).toEqual(['a', 'b', 'c']);
  });
});
