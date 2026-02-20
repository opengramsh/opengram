import { describe, expect, it } from 'vitest';

import type { Chat } from '@/src/components/chats/types';
import { chatMatchesListFilters } from '@/src/components/chats/use-chat-list';

const baseChat: Chat = {
  id: 'chat-1',
  is_archived: false,
  custom_state: 'Open',
  title: 'Alpha Chat',
  tags: [],
  pinned: false,
  agent_ids: ['agent-a', 'agent-b'],
  model_id: 'model-a',
  last_message_preview: 'hello',
  last_message_role: 'agent',
  pending_requests_count: 0,
  last_read_at: null,
  unread_count: 0,
  created_at: '2026-02-18T10:00:00.000Z',
  updated_at: '2026-02-18T10:00:00.000Z',
  last_message_at: '2026-02-18T10:00:00.000Z',
};

describe('chatMatchesListFilters', () => {
  it('requires archived flag to match list mode', () => {
    expect(
      chatMatchesListFilters(
        { ...baseChat, is_archived: true },
        { searchQuery: '', selectedAgentId: '', selectedState: '' },
        false,
      ),
    ).toBe(false);
  });

  it('matches by selected agent when agent is present', () => {
    expect(
      chatMatchesListFilters(
        baseChat,
        { searchQuery: '', selectedAgentId: 'agent-b', selectedState: '' },
        false,
      ),
    ).toBe(true);
  });

  it('rejects when selected agent is not in chat agent ids', () => {
    expect(
      chatMatchesListFilters(
        baseChat,
        { searchQuery: '', selectedAgentId: 'agent-z', selectedState: '' },
        false,
      ),
    ).toBe(false);
  });

  it('matches only the selected state when state filter is set', () => {
    expect(
      chatMatchesListFilters(
        baseChat,
        { searchQuery: '', selectedAgentId: '', selectedState: 'Open' },
        false,
      ),
    ).toBe(true);

    expect(
      chatMatchesListFilters(
        baseChat,
        { searchQuery: '', selectedAgentId: '', selectedState: 'Closed' },
        false,
      ),
    ).toBe(false);
  });

  it('applies case-insensitive title search', () => {
    expect(
      chatMatchesListFilters(
        baseChat,
        { searchQuery: 'alpha', selectedAgentId: '', selectedState: '' },
        false,
      ),
    ).toBe(true);

    expect(
      chatMatchesListFilters(
        baseChat,
        { searchQuery: 'missing', selectedAgentId: '', selectedState: '' },
        false,
      ),
    ).toBe(false);
  });
});
