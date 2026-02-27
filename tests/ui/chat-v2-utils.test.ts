import { describe, expect, it } from 'vitest';

import {
  buildInlineMessageMedia,
  formatBytes,
  formatDuration,
  isMessageTyping,
  mediaSortAsc,
  messageText,
  mediaIdFromTrace,
  mediaIdsFromTrace,
  requestSortAsc,
} from '@/app/chats-v2/[chatId]/_lib/chat-utils';
import type { MediaItem, Message } from '@/app/chats-v2/[chatId]/_lib/types';

function makeMessage(overrides: Partial<Message> & Pick<Message, 'id'>): Message {
  return {
    role: 'agent',
    sender_id: 'agent-default',
    created_at: '2026-02-27T00:00:00.000Z',
    content_final: null,
    content_partial: null,
    stream_state: 'none',
    ...overrides,
  };
}

function makeMedia(overrides: Partial<MediaItem> & Pick<MediaItem, 'id'>): MediaItem {
  return {
    message_id: null,
    filename: 'test.jpg',
    created_at: '2026-02-27T00:00:00.000Z',
    byte_size: 1024,
    content_type: 'image/jpeg',
    kind: 'image',
    ...overrides,
  };
}

describe('v2 chat-utils', () => {
  describe('isMessageTyping', () => {
    it('returns true for streaming message with no content', () => {
      const msg = makeMessage({ id: 'm1', stream_state: 'streaming', content_partial: '', content_final: '' });
      expect(isMessageTyping(msg)).toBe(true);
    });

    it('returns false for streaming message with partial content', () => {
      const msg = makeMessage({ id: 'm1', stream_state: 'streaming', content_partial: 'hello' });
      expect(isMessageTyping(msg)).toBe(false);
    });

    it('returns false for non-streaming message', () => {
      const msg = makeMessage({ id: 'm1', stream_state: 'complete', content_final: 'done' });
      expect(isMessageTyping(msg)).toBe(false);
    });
  });

  describe('messageText', () => {
    it('prefers content_final over content_partial', () => {
      const msg = makeMessage({ id: 'm1', content_final: 'final', content_partial: 'partial' });
      expect(messageText(msg)).toBe('final');
    });

    it('falls back to content_partial', () => {
      const msg = makeMessage({ id: 'm1', content_partial: 'partial' });
      expect(messageText(msg)).toBe('partial');
    });

    it('returns Streaming... for streaming messages with no text', () => {
      const msg = makeMessage({ id: 'm1', stream_state: 'streaming' });
      expect(messageText(msg)).toBe('Streaming...');
    });

    it('returns empty string when no content and not streaming', () => {
      const msg = makeMessage({ id: 'm1' });
      expect(messageText(msg)).toBe('');
    });
  });

  describe('mediaIdFromTrace', () => {
    it('extracts mediaId from trace', () => {
      const msg = makeMessage({ id: 'm1', trace: { mediaId: 'media-1' } });
      expect(mediaIdFromTrace(msg)).toBe('media-1');
    });

    it('returns null when no trace', () => {
      const msg = makeMessage({ id: 'm1' });
      expect(mediaIdFromTrace(msg)).toBeNull();
    });
  });

  describe('mediaIdsFromTrace', () => {
    it('extracts mediaIds array from trace', () => {
      const msg = makeMessage({ id: 'm1', trace: { mediaIds: ['a', 'b'] } });
      expect(mediaIdsFromTrace(msg)).toEqual(['a', 'b']);
    });

    it('falls back to single mediaId', () => {
      const msg = makeMessage({ id: 'm1', trace: { mediaId: 'a' } });
      expect(mediaIdsFromTrace(msg)).toEqual(['a']);
    });

    it('filters non-string entries from mediaIds', () => {
      const msg = makeMessage({ id: 'm1', trace: { mediaIds: ['a', 42, null, 'b'] } });
      expect(mediaIdsFromTrace(msg)).toEqual(['a', 'b']);
    });

    it('returns empty array when no trace', () => {
      const msg = makeMessage({ id: 'm1' });
      expect(mediaIdsFromTrace(msg)).toEqual([]);
    });
  });

  describe('formatBytes', () => {
    it('formats bytes', () => {
      expect(formatBytes(500)).toBe('500 B');
    });

    it('formats kilobytes', () => {
      expect(formatBytes(2048)).toBe('2 KB');
    });

    it('formats megabytes', () => {
      expect(formatBytes(3_145_728)).toBe('3 MB');
    });
  });

  describe('formatDuration', () => {
    it('formats minutes and seconds', () => {
      expect(formatDuration(125)).toBe('2:05');
    });

    it('handles zero', () => {
      expect(formatDuration(0)).toBe('0:00');
    });

    it('handles negative values', () => {
      expect(formatDuration(-5)).toBe('0:00');
    });

    it('handles NaN', () => {
      expect(formatDuration(NaN)).toBe('0:00');
    });
  });

  describe('mediaSortAsc', () => {
    it('sorts by created_at then id', () => {
      const a = makeMedia({ id: 'b', created_at: '2026-01-01T00:00:00Z' });
      const b = makeMedia({ id: 'a', created_at: '2026-01-01T00:00:00Z' });
      const c = makeMedia({ id: 'c', created_at: '2026-01-02T00:00:00Z' });

      const sorted = [c, a, b].sort(mediaSortAsc);
      expect(sorted.map((m) => m.id)).toEqual(['a', 'b', 'c']);
    });
  });

  describe('requestSortAsc', () => {
    it('sorts by created_at then id', () => {
      const items = [
        { id: 'b', created_at: '2026-01-01T00:00:00Z' },
        { id: 'a', created_at: '2026-01-01T00:00:00Z' },
        { id: 'c', created_at: '2026-01-02T00:00:00Z' },
      ];
      const sorted = [...items].sort(requestSortAsc);
      expect(sorted.map((r) => r.id)).toEqual(['a', 'b', 'c']);
    });
  });

  describe('buildInlineMessageMedia', () => {
    it('merges media by message_id and trace mediaIds', () => {
      const messages = [makeMessage({ id: 'm1', trace: { mediaIds: ['media-2'] } })];
      const byMsgId = new Map<string, MediaItem[]>([
        ['m1', [makeMedia({ id: 'media-1', message_id: 'm1' })]],
      ]);
      const byId = new Map<string, MediaItem>([
        ['media-1', makeMedia({ id: 'media-1', message_id: 'm1' })],
        ['media-2', makeMedia({ id: 'media-2', message_id: null })],
      ]);

      const result = buildInlineMessageMedia(messages, byMsgId, byId);
      const m1Media = result.get('m1');
      expect(m1Media).toHaveLength(2);
      expect(m1Media?.map((m) => m.id)).toEqual(['media-1', 'media-2']);
    });

    it('deduplicates media appearing in both message_id and trace', () => {
      const messages = [makeMessage({ id: 'm1', trace: { mediaIds: ['media-1'] } })];
      const media1 = makeMedia({ id: 'media-1', message_id: 'm1' });
      const byMsgId = new Map<string, MediaItem[]>([['m1', [media1]]]);
      const byId = new Map<string, MediaItem>([['media-1', media1]]);

      const result = buildInlineMessageMedia(messages, byMsgId, byId);
      expect(result.get('m1')).toHaveLength(1);
    });

    it('returns empty map for messages with no media', () => {
      const messages = [makeMessage({ id: 'm1' })];
      const result = buildInlineMessageMedia(messages, new Map(), new Map());
      expect(result.size).toBe(0);
    });
  });
});
