import { describe, expect, it } from 'vitest';

import {
  normalizeFirstMessageForNewChat,
  selectNewChatAgentId,
  selectNewChatModelId,
} from '@/src/lib/new-chat';

describe('new chat utils', () => {
  it('keeps preferred agent when available', () => {
    const agentId = selectNewChatAgentId([{ id: 'agent-a' }, { id: 'agent-b' }], 'agent-b');

    expect(agentId).toBe('agent-b');
  });

  it('falls back to first agent when preferred agent is missing', () => {
    const agentId = selectNewChatAgentId([{ id: 'agent-a' }, { id: 'agent-b' }], 'agent-c');

    expect(agentId).toBe('agent-a');
  });

  it('uses preferred model when available', () => {
    const modelId = selectNewChatModelId(
      [{ id: 'model-a' }, { id: 'model-b' }],
      'model-a',
      'model-b',
    );

    expect(modelId).toBe('model-b');
  });

  it('falls back to configured default model when preferred model is invalid', () => {
    const modelId = selectNewChatModelId(
      [{ id: 'model-a' }, { id: 'model-b' }],
      'model-b',
      'model-missing',
    );

    expect(modelId).toBe('model-b');
  });

  it('falls back to first model when configured default model is unavailable', () => {
    const modelId = selectNewChatModelId([{ id: 'model-a' }, { id: 'model-b' }], 'model-c');

    expect(modelId).toBe('model-a');
  });

  it('normalizes first message and blocks whitespace-only content', () => {
    expect(normalizeFirstMessageForNewChat('  first message  ')).toBe('first message');
    expect(normalizeFirstMessageForNewChat('   \n\t   ')).toBeNull();
  });
});
