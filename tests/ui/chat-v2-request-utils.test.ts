import { describe, expect, it } from 'vitest';

import {
  choiceOptionClass,
  parseChoiceRequestConfig,
  parseFormRequestConfig,
  parseTextInputRequestConfig,
  validateRequestResolutionPayload,
} from '@/app/chats-v2/[chatId]/_lib/request-utils';
import type { RequestDraftMap, RequestItem } from '@/app/chats-v2/[chatId]/_lib/types';

function makeRequest(overrides: Partial<RequestItem> & Pick<RequestItem, 'type' | 'config'>): RequestItem {
  return {
    id: 'req-1',
    chat_id: 'chat-1',
    status: 'pending',
    title: 'Test',
    body: null,
    created_at: '2026-02-27T00:00:00.000Z',
    ...overrides,
  };
}

describe('v2 request-utils', () => {
  // parseChoiceRequestConfig
  describe('parseChoiceRequestConfig', () => {
    it('parses valid options and normalizes unknown variant to secondary', () => {
      const config = parseChoiceRequestConfig({
        options: [
          { id: 'a', label: 'A', variant: 'primary' },
          { id: 'b', label: 'B', variant: 'danger' },
          { id: 'c', label: 'C', variant: 'unknown' },
          { id: 'd', label: 'D' },
        ],
      });

      expect(config.options).toEqual([
        { id: 'a', label: 'A', variant: 'primary' },
        { id: 'b', label: 'B', variant: 'danger' },
        { id: 'c', label: 'C', variant: 'secondary' },
        { id: 'd', label: 'D', variant: 'secondary' },
      ]);
    });

    it('skips options with empty id or label', () => {
      const config = parseChoiceRequestConfig({
        options: [
          { id: '', label: 'X' },
          { id: 'a', label: '' },
          { id: 'b', label: 'B' },
        ],
      });

      expect(config.options).toEqual([{ id: 'b', label: 'B', variant: 'secondary' }]);
    });

    it('clamps minSelections to maxSelections', () => {
      const config = parseChoiceRequestConfig({ options: [], minSelections: 5, maxSelections: 3 });
      expect(config.minSelections).toBe(3);
      expect(config.maxSelections).toBe(3);
    });

    it('defaults maxSelections to 1 and minSelections to 0', () => {
      const config = parseChoiceRequestConfig({ options: [] });
      expect(config.maxSelections).toBe(1);
      expect(config.minSelections).toBe(0);
    });

    it('handles non-array options gracefully', () => {
      const config = parseChoiceRequestConfig({ options: 'not-an-array' });
      expect(config.options).toEqual([]);
    });
  });

  // parseTextInputRequestConfig
  describe('parseTextInputRequestConfig', () => {
    it('uses default placeholder when empty', () => {
      const config = parseTextInputRequestConfig({ placeholder: '' });
      expect(config.placeholder).toBe('Type your response');
    });

    it('extracts minLength and maxLength from validation', () => {
      const config = parseTextInputRequestConfig({
        validation: { minLength: 3, maxLength: 100 },
      });
      expect(config.validation.minLength).toBe(3);
      expect(config.validation.maxLength).toBe(100);
    });

    it('clamps minLength to maxLength when min exceeds max', () => {
      const config = parseTextInputRequestConfig({
        validation: { minLength: 20, maxLength: 10 },
      });
      expect(config.validation.minLength).toBe(10);
      expect(config.validation.maxLength).toBe(10);
    });

    it('silently ignores invalid regex pattern', () => {
      const config = parseTextInputRequestConfig({
        validation: { pattern: '([' },
      });
      expect(config.validation.pattern).toBeUndefined();
    });

    it('accepts valid regex pattern', () => {
      const config = parseTextInputRequestConfig({
        validation: { pattern: '^[a-z]+$' },
      });
      expect(config.validation.pattern).toBe('^[a-z]+$');
    });
  });

  // parseFormRequestConfig
  describe('parseFormRequestConfig', () => {
    it('parses fields and uses name as label fallback', () => {
      const config = parseFormRequestConfig({
        fields: [
          { name: 'email', type: 'text', required: true },
          { name: 'notes', type: 'textarea', label: 'Notes', required: false },
        ],
      });

      expect(config.fields).toHaveLength(2);
      expect(config.fields[0]?.label).toBe('email');
      expect(config.fields[1]?.label).toBe('Notes');
    });

    it('defaults submitLabel to Submit', () => {
      const config = parseFormRequestConfig({ fields: [] });
      expect(config.submitLabel).toBe('Submit');
    });

    it('rejects fields with unknown type', () => {
      const config = parseFormRequestConfig({
        fields: [{ name: 'foo', type: 'unknown', required: false }],
      });
      expect(config.fields).toHaveLength(0);
    });

    it('filters options for select/multiselect types', () => {
      const config = parseFormRequestConfig({
        fields: [{ name: 'tags', type: 'multiselect', options: ['a', 42, '', 'b'], required: false }],
      });
      expect(config.fields[0]?.options).toEqual(['a', 'b']);
    });
  });

  // validateRequestResolutionPayload
  describe('validateRequestResolutionPayload', () => {
    it('validates choice request with correct selections', () => {
      const request = makeRequest({
        type: 'choice',
        config: {
          options: [
            { id: 'opt1', label: 'One' },
            { id: 'opt2', label: 'Two' },
          ],
          minSelections: 1,
          maxSelections: 2,
        },
      });
      const drafts: RequestDraftMap = { 'req-1': { selectedOptionIds: ['opt1'] } };
      const result = validateRequestResolutionPayload(request, drafts);
      expect(result.error).toBeNull();
      expect(result.payload).toEqual({ selectedOptionIds: ['opt1'] });
    });

    it('rejects choice when below min selections', () => {
      const request = makeRequest({
        type: 'choice',
        config: {
          options: [{ id: 'opt1', label: 'One' }],
          minSelections: 1,
          maxSelections: 1,
        },
      });
      const result = validateRequestResolutionPayload(request, {});
      expect(result.error).toBe('Select at least 1 option.');
      expect(result.payload).toBeNull();
    });

    it('rejects choice when above max selections', () => {
      const request = makeRequest({
        type: 'choice',
        config: {
          options: [
            { id: 'opt1', label: 'One' },
            { id: 'opt2', label: 'Two' },
            { id: 'opt3', label: 'Three' },
          ],
          minSelections: 0,
          maxSelections: 1,
        },
      });
      const drafts: RequestDraftMap = { 'req-1': { selectedOptionIds: ['opt1', 'opt2'] } };
      const result = validateRequestResolutionPayload(request, drafts);
      expect(result.error).toBe('Select no more than 1 options.');
    });

    it('validates text_input and rejects empty text', () => {
      const request = makeRequest({
        type: 'text_input',
        config: { placeholder: 'Enter text' },
      });
      const result = validateRequestResolutionPayload(request, {});
      expect(result.error).toBe('Response cannot be empty.');
    });

    it('validates text_input with pattern', () => {
      const request = makeRequest({
        type: 'text_input',
        config: { validation: { pattern: '^\\d+$' } },
      });
      const drafts: RequestDraftMap = { 'req-1': { text: 'abc' } };
      const result = validateRequestResolutionPayload(request, drafts);
      expect(result.error).toBe('Response does not match the required format.');
    });

    it('validates text_input success', () => {
      const request = makeRequest({
        type: 'text_input',
        config: { validation: { minLength: 2 } },
      });
      const drafts: RequestDraftMap = { 'req-1': { text: 'hello' } };
      const result = validateRequestResolutionPayload(request, drafts);
      expect(result.error).toBeNull();
      expect(result.payload).toEqual({ text: 'hello' });
    });

    it('validates form with required fields', () => {
      const request = makeRequest({
        type: 'form',
        config: {
          fields: [
            { name: 'name', type: 'text', required: true },
            { name: 'bio', type: 'textarea', required: false },
          ],
        },
      });

      // Missing required field
      const missing = validateRequestResolutionPayload(request, { 'req-1': { values: { bio: 'hi' } } });
      expect(missing.error).toBe('name is required.');

      // All required present
      const success = validateRequestResolutionPayload(request, { 'req-1': { values: { name: 'John', bio: 'hi' } } });
      expect(success.error).toBeNull();
      expect(success.payload).toEqual({ values: { name: 'John', bio: 'hi' } });
    });
  });

  // choiceOptionClass
  describe('choiceOptionClass', () => {
    it('returns selected primary class', () => {
      const cls = choiceOptionClass('primary', true, false);
      expect(cls).toContain('bg-sky-400/30');
    });

    it('returns unselected danger class', () => {
      const cls = choiceOptionClass('danger', false, false);
      expect(cls).toContain('border-rose-200/50');
    });

    it('includes opacity when disabled', () => {
      const cls = choiceOptionClass('secondary', false, true);
      expect(cls).toContain('opacity-50');
    });
  });
});
