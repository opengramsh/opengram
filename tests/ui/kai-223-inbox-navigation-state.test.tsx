// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';

import { ChatListPage } from '@/src/components/chats/chat-list-page';
import type { Chat } from '@/src/components/chats/types';
import type { UseChatListReturn } from '@/src/components/chats/use-chat-list';

vi.mock('facehash', () => ({
  Facehash: ({ name }: { name: string }) => <div data-testid={`facehash-${name}`} />,
}));

function LocationStateProbe() {
  const location = useLocation();

  return (
    <pre data-testid="location-state">
      {JSON.stringify(location.state)}
    </pre>
  );
}

function makeChatList(chat: Chat): UseChatListReturn {
  return {
    appName: 'OpenGram',
    agents: [],
    models: [],
    chats: [chat],
    setChats: vi.fn(),
    loading: false,
    error: null,
    searchInput: '',
    setSearchInput: vi.fn(),
    selectedAgentId: '',
    setSelectedAgentId: vi.fn(),
    agentsById: new Map(),
    loadChats: vi.fn(async () => {}),
    refreshChats: vi.fn(async () => {}),
    markChatRead: vi.fn(async () => {}),
    markChatUnread: vi.fn(async () => {}),
    togglePin: vi.fn(async () => {}),
    toggleArchive: vi.fn(async () => {}),
    isNewChatOpen: false,
    openNewChatSheet: vi.fn(),
    closeNewChatSheet: vi.fn(),
    newChatAgentId: '',
    setNewChatAgentId: vi.fn(),
    newChatModelId: '',
    setNewChatModelId: vi.fn(),
    newChatFirstMessage: '',
    setNewChatFirstMessage: vi.fn(),
    newChatError: null,
    setNewChatError: vi.fn(),
    isCreatingNewChat: false,
    canSendNewChat: false,
    createNewChat: vi.fn(async () => {}),
    matchesActiveFilters: vi.fn(() => true),
    searchQuery: '',
    searchResults: null,
    isSearchResultsLoading: false,
  };
}

describe('KAI-223 inbox navigation', () => {
  it('pushes selected chat in navigation state when opening from inbox list', async () => {
    const chat: Chat = {
      id: 'chat-1',
      is_archived: false,
      title: 'Seeded Inbox Chat',
      title_source: 'manual',
      tags: [],
      pinned: false,
      agent_ids: ['agent-a'],
      model_id: 'model-a',
      last_message_preview: null,
      last_message_role: null,
      pending_requests_count: 0,
      last_read_at: null,
      unread_count: 0,
      notifications_muted: false,
      created_at: '2026-02-25T00:00:00.000Z',
      updated_at: '2026-02-25T00:00:00.000Z',
      last_message_at: null,
    };

    render(
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route
            path="/"
            element={(
              <ChatListPage
                chatList={makeChatList(chat)}
                headerContent={<span>Inbox</span>}
                emptyLabel="No chats"
                rowActionLabel="Archive"
                searchPlaceholder="Search"
              />
            )}
          />
          <Route path="/chats/:chatId" element={<LocationStateProbe />} />
        </Routes>
      </MemoryRouter>,
    );

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /Seeded Inbox Chat/i }));

    const state = screen.getByTestId('location-state').textContent ?? '';
    expect(state).toContain('"chat"');
    expect(state).toContain('"id":"chat-1"');
    expect(state).toContain('"title":"Seeded Inbox Chat"');
    expect(state).toContain('"agent_ids":["agent-a"]');
  });
});
