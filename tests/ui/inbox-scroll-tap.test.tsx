// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

/**
 * KAI-214 Issue 1: Scroll triggers chat click in inbox.
 *
 * When a user scrolls vertically on the chat list, the pointer down/up
 * sequence fires onOpen() because the code doesn't track total pointer
 * displacement — only horizontal swipe intent.
 */

vi.mock('facehash', () => ({
  Facehash: ({ name }: { name: string }) => <div data-testid={`facehash-${name}`} />,
}));

// We import ChatList which internally renders ChatRow
// ChatRow is not exported, so we test through ChatList
import { ChatList } from '@/src/components/chats/chat-list';
import type { Chat } from '@/src/components/chats/types';

const MOCK_CHAT: Chat = {
  id: 'chat-1',
  is_archived: false,
  title: 'Test Chat',
  tags: [],
  pinned: false,
  agent_ids: ['agent-a'],
  model_id: 'model-a',
  last_message_preview: 'hello world',
  last_message_role: 'agent',
  pending_requests_count: 0,
  last_read_at: null,
  unread_count: 0,
  created_at: '2026-02-18T10:00:00.000Z',
  updated_at: '2026-02-18T10:00:00.000Z',
  last_message_at: '2026-02-18T10:00:00.000Z',
  title_source: 'default',
};

function renderChatList(onOpenChat: (chat: Chat) => void) {
  return render(
    <ChatList
      chats={[MOCK_CHAT]}
      agentsById={new Map([['agent-a', { id: 'agent-a', name: 'Agent A', description: '' }]])}
      loading={false}
      error={null}
      emptyLabel="No chats"
      onOpenChat={onOpenChat}
      onMarkRead={vi.fn(async () => {})}
      onMarkUnread={vi.fn(async () => {})}
      onTogglePin={vi.fn(async () => {})}
      onToggleArchive={vi.fn(async () => {})}
      rowActionLabel="Archive"
    />,
  );
}

describe('KAI-214: inbox scroll should not trigger chat open', () => {
  it('should NOT call onOpen when pointer moves vertically (scroll gesture)', () => {
    const onOpenChat = vi.fn();
    renderChatList(onOpenChat);

    const row = screen.getByText('Test Chat').closest('button')!;

    // Simulate a vertical scroll gesture: pointerdown → pointermove (vertical) → pointerup
    fireEvent.pointerDown(row, {
      pointerId: 1,
      clientX: 100,
      clientY: 200,
      button: 0,
      pointerType: 'touch',
    });

    // Move vertically by 40px (clearly a scroll, not a tap)
    fireEvent.pointerMove(row, {
      pointerId: 1,
      clientX: 102,
      clientY: 240,
    });

    fireEvent.pointerUp(row, {
      pointerId: 1,
      clientX: 102,
      clientY: 240,
    });

    // BUG: onOpenChat IS called despite 40px vertical movement (scroll intent)
    // Expected: onOpenChat should NOT be called
    expect(onOpenChat).not.toHaveBeenCalled();
  });

  it('should call onOpen on a clean tap (minimal movement)', () => {
    const onOpenChat = vi.fn();
    renderChatList(onOpenChat);

    const row = screen.getByText('Test Chat').closest('button')!;

    fireEvent.pointerDown(row, {
      pointerId: 1,
      clientX: 100,
      clientY: 200,
      button: 0,
      pointerType: 'touch',
    });

    // Minimal movement — this is a tap
    fireEvent.pointerUp(row, {
      pointerId: 1,
      clientX: 101,
      clientY: 201,
    });

    expect(onOpenChat).toHaveBeenCalledTimes(1);
  });
});
