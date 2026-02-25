// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';

import ChatPage from '@/src/client/pages/chat';

vi.mock('facehash', () => ({
  Facehash: ({ name }: { name: string }) => <div data-testid={`facehash-${name}`} />,
}));

vi.mock('@/src/lib/events-stream', () => ({
  subscribeToEventsStream: () => () => {},
}));

describe('KAI-223 chat open loading regression', () => {
  beforeEach(() => {
    Element.prototype.scrollTo = vi.fn();

    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => {})));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders seeded chat header data immediately when arriving from inbox state', () => {
    render(
      <MemoryRouter
        initialEntries={[
          {
            pathname: '/chats/chat-1',
            state: {
              chat: {
                id: 'chat-1',
                title: 'Inbox Seeded Chat',
                title_source: 'manual',
                tags: [],
                model_id: 'model-a',
                pinned: false,
                is_archived: false,
                notifications_muted: false,
                agent_ids: ['agent-a'],
                pending_requests_count: 0,
              },
            },
          },
        ]}
      >
        <Routes>
          <Route path="/chats/:chatId" element={<ChatPage />} />
        </Routes>
      </MemoryRouter>,
    );

    // Expected behavior for KAI-223:
    // - Header should use inbox-seeded chat title instantly.
    // - Chat body should not block on "Loading chat..." when seeded data exists.
    // - "Unknown Agent" fallback should never flash.
    expect(screen.getAllByText('Inbox Seeded Chat').length).toBeGreaterThan(0);
    expect(screen.queryByText('Loading chat...')).toBeNull();
    expect(screen.queryByText('Unknown Agent')).toBeNull();
  });

  it('does not render Unknown Agent while loading a cold-opened chat', () => {
    render(
      <MemoryRouter initialEntries={['/chats/chat-1']}>
        <Routes>
          <Route path="/chats/:chatId" element={<ChatPage />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.queryByText('Unknown Agent')).toBeNull();
  });
});
