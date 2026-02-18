// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import Home from '@/app/page';
import ArchivedPage from '@/app/archived/page';

const navigationState = vi.hoisted(() => ({
  pathname: '/',
  push: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: navigationState.push }),
  usePathname: () => navigationState.pathname,
}));

vi.mock('facehash', () => ({
  Facehash: ({ name }: { name: string }) => <div data-testid={`facehash-${name}`} />,
}));

type FetchMock = ReturnType<typeof vi.fn>;

const archivedChat = {
  id: 'chat-archived',
  is_archived: true,
  custom_state: 'Open',
  title: 'Archived chat',
  tags: [],
  pinned: false,
  agent_ids: ['agent-a'],
  model_id: 'model-a',
  last_message_preview: 'hello',
  last_message_role: 'agent',
  pending_requests_count: 0,
  last_read_at: null,
  unread_count: 1,
  created_at: '2026-02-18T10:00:00.000Z',
  updated_at: '2026-02-18T10:00:00.000Z',
  last_message_at: '2026-02-18T10:00:00.000Z',
};

describe('hamburger + archived chats UI', () => {
  let fetchMock: FetchMock;

  beforeEach(() => {
    navigationState.pathname = '/';
    navigationState.push.mockReset();

    fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      const method = init?.method ?? 'GET';

      if (url === '/api/v1/config') {
        return new Response(
          JSON.stringify({
            appName: 'OpenGram',
            customStates: ['Open', 'Closed'],
            defaultCustomState: 'Open',
            defaultModelIdForNewChats: 'model-a',
            agents: [{ id: 'agent-a', name: 'Agent A', description: 'Alpha agent' }],
            models: [{ id: 'model-a', name: 'Model A', description: 'Alpha model' }],
          }),
          { status: 200 },
        );
      }

      if (url.startsWith('/api/v1/chats/pending-summary')) {
        return new Response(JSON.stringify({ pending_requests_total: 0 }), { status: 200 });
      }

      if (url.startsWith('/api/v1/chats') && method === 'GET') {
        if (url.includes('archived=true')) {
          return new Response(JSON.stringify({ data: [archivedChat], cursor: { next: null, hasMore: false } }), {
            status: 200,
          });
        }

        return new Response(JSON.stringify({ data: [], cursor: { next: null, hasMore: false } }), { status: 200 });
      }

      if (url === '/api/v1/chats/chat-archived/unarchive' && method === 'POST') {
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }

      if (url === '/api/v1/chats/chat-archived/mark-read' && method === 'POST') {
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }

      if (url === '/api/v1/chats/chat-archived/mark-unread' && method === 'POST') {
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }

      if (url === '/api/v1/chats/chat-archived' && method === 'PATCH') {
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }

      if (url === '/api/v1/chats' && method === 'POST') {
        return new Response(JSON.stringify({ id: 'chat-new' }), { status: 200 });
      }

      return new Response('not found', { status: 404 });
    });

    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('opens hamburger menu and navigates to Archived chats', async () => {
    render(<Home />);
    const user = userEvent.setup();

    await screen.findByLabelText('Open menu');
    await user.click(screen.getByLabelText('Open menu'));
    await user.click(screen.getByRole('button', { name: 'Archived chats' }));

    expect(navigationState.push).toHaveBeenCalledWith('/archived');
  });

  it('loads archived screen using archived=true filter', async () => {
    navigationState.pathname = '/archived';
    render(<ArchivedPage />);

    await screen.findByText('Archived chat');
    expect(
      fetchMock.mock.calls.some(([input]) => {
        const url = typeof input === 'string' ? input : input.toString();
        return url.includes('/api/v1/chats?') && url.includes('archived=true');
      }),
    ).toBe(true);
  });

  it('unarchives from archived list via context menu', async () => {
    navigationState.pathname = '/archived';
    render(<ArchivedPage />);
    const user = userEvent.setup();

    const chatTitle = await screen.findByText('Archived chat');
    fireEvent.contextMenu(chatTitle, { clientX: 120, clientY: 80 });

    const unarchiveButtons = screen.getAllByRole('button', { name: 'Unarchive' });
    await user.click(unarchiveButtons[unarchiveButtons.length - 1]);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/v1/chats/chat-archived/unarchive', { method: 'POST' });
    });
  });

  it('unarchives from archived list via swipe gesture', async () => {
    navigationState.pathname = '/archived';
    const { container } = render(<ArchivedPage />);

    await screen.findByText('Archived chat');
    const swipeSurface = container.querySelector('div[style*="translateX"]');
    expect(swipeSurface).toBeTruthy();

    fireEvent.pointerDown(swipeSurface as Element, { pointerId: 1, clientX: 200, clientY: 20, button: 0 });
    fireEvent.pointerMove(swipeSurface as Element, { pointerId: 1, clientX: 60, clientY: 24 });
    fireEvent.pointerUp(swipeSurface as Element, { pointerId: 1, clientX: 60, clientY: 24 });

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/v1/chats/chat-archived/unarchive', { method: 'POST' });
    });
  });

  it('shows the global + action on archived and opens new chat sheet', async () => {
    navigationState.pathname = '/archived';
    render(<ArchivedPage />);
    const user = userEvent.setup();

    await screen.findByText('Archived chat');
    const newChatButton = screen.getByRole('button', { name: 'New chat' });
    await user.click(newChatButton);

    expect(screen.getByText('New Chat')).toBeTruthy();
  });
});
