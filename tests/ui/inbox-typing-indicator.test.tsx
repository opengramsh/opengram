// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('facehash', () => ({
  Facehash: ({ name, enableBlink }: { name: string; enableBlink?: boolean }) => (
    <div data-testid={`facehash-${name}`} data-blink={enableBlink ? 'true' : 'false'} />
  ),
}));

import { ChatList } from '@/src/components/chats/chat-list';
import type { Chat } from '@/src/components/chats/types';

const MOCK_CHAT_A: Chat = {
  id: 'chat-a',
  is_archived: false,
  title: 'Chat A',
  tags: [],
  pinned: false,
  agent_ids: ['agent-a'],
  model_id: 'model-a',
  last_message_preview: 'hello',
  last_message_role: 'agent',
  pending_requests_count: 0,
  last_read_at: null,
  unread_count: 0,
  created_at: '2026-02-18T10:00:00.000Z',
  updated_at: '2026-02-18T10:00:00.000Z',
  last_message_at: '2026-02-18T10:00:00.000Z',
  title_source: 'default',
};

const MOCK_CHAT_B: Chat = {
  ...MOCK_CHAT_A,
  id: 'chat-b',
  title: 'Chat B',
};

function renderChatList(streamingChatIds?: Set<string>) {
  return render(
    <ChatList
      chats={[MOCK_CHAT_A, MOCK_CHAT_B]}
      agentsById={new Map([['agent-a', { id: 'agent-a', name: 'Agent A', description: '' }]])}
      loading={false}
      error={null}
      emptyLabel="No chats"
      onOpenChat={vi.fn()}
      onMarkRead={vi.fn(async () => {})}
      onMarkUnread={vi.fn(async () => {})}
      onTogglePin={vi.fn(async () => {})}
      onToggleArchive={vi.fn(async () => {})}
      rowActionLabel="Archive"
      streamingChatIds={streamingChatIds}
    />,
  );
}

describe('inbox typing indicator', () => {
  it('shows typing indicator on chat row when streamingChatIds includes the chat', () => {
    renderChatList(new Set(['chat-a']));

    // Chat A should show typing text
    expect(screen.getByText(/Agent A · typing\.\.\./)).toBeTruthy();

    // Chat B should NOT show typing text
    const chatBAgentTexts = screen.getAllByText(/Agent A/);
    const chatBAgent = chatBAgentTexts.find((el) => !el.textContent?.includes('typing'));
    expect(chatBAgent).toBeTruthy();
  });

  it('shows blink animation on avatar when streaming', () => {
    renderChatList(new Set(['chat-a']));

    const facehashes = screen.getAllByTestId('facehash-Agent A');
    // At least one should have blink enabled (chat-a), and one not (chat-b)
    const blinkValues = facehashes.map((el) => el.getAttribute('data-blink'));
    expect(blinkValues).toContain('true');
    expect(blinkValues).toContain('false');
  });

  it('does not show typing indicator when streamingChatIds is empty', () => {
    renderChatList(new Set());

    expect(screen.queryByText(/typing\.\.\./)).toBeNull();
  });
});
