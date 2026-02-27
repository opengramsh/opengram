import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { setApiSecret } from '@/src/lib/api-fetch';
import { prepareSendMessagesRequest } from '@/app/chats-v2/[chatId]/_lib/prepare-send-request';

describe('v2 send transport', () => {
  beforeEach(() => {
    setApiSecret(null);
  });

  afterEach(() => {
    setApiSecret(null);
  });

  it('includes Authorization header when instance secret is set', () => {
    setApiSecret('my-secret-token');

    const result = prepareSendMessagesRequest(
      [{ parts: [{ type: 'text', text: 'Hello' }] }],
      [],
    );

    expect(result.headers['authorization']).toBe('Bearer my-secret-token');
    expect(result.headers['content-type']).toBe('application/json');
  });

  it('omits Authorization header when no secret is set', () => {
    const result = prepareSendMessagesRequest(
      [{ parts: [{ type: 'text', text: 'Hello' }] }],
      [],
    );

    expect(result.headers['authorization']).toBeUndefined();
    expect(result.headers['content-type']).toBe('application/json');
  });

  it('extracts text from last message text parts', () => {
    const result = prepareSendMessagesRequest(
      [
        { parts: [{ type: 'text', text: 'First' }] },
        { parts: [{ type: 'text', text: 'Hello ' }, { type: 'text', text: 'World' }] },
      ],
      [],
    );

    expect(result.body.message).toBe('Hello World');
  });

  it('ignores non-text parts', () => {
    const result = prepareSendMessagesRequest(
      [{ parts: [{ type: 'image' }, { type: 'text', text: 'Hello' }] }],
      [],
    );

    expect(result.body.message).toBe('Hello');
  });

  it('returns empty message when no parts', () => {
    const result = prepareSendMessagesRequest([{ parts: [] }], []);
    expect(result.body.message).toBe('');
  });

  it('returns empty message when messages array is empty', () => {
    const result = prepareSendMessagesRequest([], []);
    expect(result.body.message).toBe('');
  });

  it('includes attachment IDs in body', () => {
    const result = prepareSendMessagesRequest(
      [{ parts: [{ type: 'text', text: 'Hi' }] }],
      ['media-1', 'media-2'],
    );

    expect(result.body.attachmentIds).toEqual(['media-1', 'media-2']);
  });
});
