import { describe, expect, it } from 'vitest';

import {
  parseChoiceRequestConfig,
  parseFormRequestConfig,
  parseTextInputRequestConfig,
  validateRequestResolutionPayload,
} from '@/app/chats/[chatId]/_lib/request-utils';
import type { RequestDraftMap, RequestItem } from '@/app/chats/[chatId]/_lib/types';

describe('chat request utils', () => {
  it('parses choice config and normalizes invalid variants and bounds', () => {
    const parsed = parseChoiceRequestConfig({
      options: [
        { id: 'a', label: 'A', variant: 'primary' },
        { id: 'b', label: 'B', variant: 'unexpected' },
        { id: '', label: 'skip' },
      ],
      minSelections: 3,
      maxSelections: 2,
    });

    expect(parsed.options).toEqual([
      { id: 'a', label: 'A', variant: 'primary' },
      { id: 'b', label: 'B', variant: 'secondary' },
    ]);
    expect(parsed.minSelections).toBe(2);
    expect(parsed.maxSelections).toBe(2);
  });

  it('parses text input config and ignores invalid regex', () => {
    const parsed = parseTextInputRequestConfig({
      placeholder: '',
      validation: {
        minLength: 8,
        maxLength: 4,
        pattern: '([',
      },
    });

    expect(parsed.placeholder).toBe('Type your response');
    expect(parsed.validation).toEqual({ minLength: 4, maxLength: 4 });
  });

  it('parses form config and validates required fields', () => {
    const request = {
      id: 'req-form',
      chat_id: 'chat-1',
      type: 'form',
      status: 'pending',
      title: 'Fill',
      body: null,
      created_at: '2026-02-19T00:00:00.000Z',
      config: {
        fields: [
          { name: 'title', type: 'text', label: 'Title', required: true },
          { name: 'tags', type: 'multiselect', label: 'Tags', required: true, options: ['a', 'b'] },
        ],
      },
    } satisfies RequestItem;

    const parsedForm = parseFormRequestConfig(request.config);
    expect(parsedForm.fields).toHaveLength(2);

    const missingResult = validateRequestResolutionPayload(request, { 'req-form': { values: { title: 'ok' } } });
    expect(missingResult.error).toBe('Tags is required.');

    const successDrafts: RequestDraftMap = {
      'req-form': { values: { title: 'ok', tags: ['a'] } },
    };
    const successResult = validateRequestResolutionPayload(request, successDrafts);
    expect(successResult.error).toBeNull();
    expect(successResult.payload).toEqual({ values: { title: 'ok', tags: ['a'] } });
  });
});
