// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import Home from '@/app/page';
import type { Chat } from '@/src/components/chats/types';
import type { FrontendStreamEvent } from '@/src/lib/events-stream';

const streamMock = vi.hoisted(() => ({
  listener: null as ((event: FrontendStreamEvent) => void) | null,
  unsubscribe: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => '/',
}));

vi.mock('facehash', () => ({
  Facehash: ({ name }: { name: string }) => <div data-testid={`facehash-${name}`} />,
}));

vi.mock('@/src/lib/events-stream', () => ({
  subscribeToEventsStream: (listener: (event: FrontendStreamEvent) => void) => {
    streamMock.listener = listener;
    return streamMock.unsubscribe;
  },
}));

type FetchMock = ReturnType<typeof vi.fn>;

let eventId = 0;

async function emitEvent(type: FrontendStreamEvent['type'], payload: Record<string, unknown>) {
  await act(async () => {
    eventId += 1;
    streamMock.listener?.({
      id: `evt-${eventId}`,
      type,
      timestamp: '2026-02-18T20:40:00.000Z',
      payload,
    });
  });
}

const baseChat: Chat = {
  id: 'chat-base',
  is_archived: false,
  custom_state: 'Open',
  title: 'Base chat',
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
};

describe('inbox event subscriptions', () => {
  let fetchMock: FetchMock;

  beforeEach(() => {
    streamMock.listener = null;
    streamMock.unsubscribe.mockReset();
    eventId = 0;

    fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();

      if (url === '/api/v1/config') {
        return new Response(
          JSON.stringify({
            appName: 'OpenGram',
            customStates: ['Open', 'Closed'],
            defaultModelIdForNewChats: 'model-a',
            agents: [{ id: 'agent-a', name: 'Agent A', description: 'Alpha' }],
            models: [{ id: 'model-a', name: 'Model A', description: 'Alpha' }],
          }),
          { status: 200 },
        );
      }

      if (url.startsWith('/api/v1/chats/pending-summary')) {
        return new Response(JSON.stringify({ pending_requests_total: 0 }), { status: 200 });
      }

      return new Response('not found', { status: 404 });
    });

    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('uses latest filter values when a single-chat refresh resolves after filter change', async () => {
    let resolveSingleChatFetch: ((value: Response) => void) | null = null;
    const singleChatFetch = new Promise<Response>((resolve) => {
      resolveSingleChatFetch = resolve;
    });

    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();

      if (url === '/api/v1/config') {
        return new Response(
          JSON.stringify({
            appName: 'OpenGram',
            customStates: ['Open', 'Closed'],
            defaultModelIdForNewChats: 'model-a',
            agents: [{ id: 'agent-a', name: 'Agent A', description: 'Alpha' }],
            models: [{ id: 'model-a', name: 'Model A', description: 'Alpha' }],
          }),
          { status: 200 },
        );
      }

      if (url.startsWith('/api/v1/chats/pending-summary')) {
        return new Response(JSON.stringify({ pending_requests_total: 0 }), { status: 200 });
      }

      if (url.startsWith('/api/v1/chats?')) {
        const parsed = new URL(url, 'http://localhost');
        const state = parsed.searchParams.get('state');

        if (state === 'Closed') {
          return new Response(
            JSON.stringify({ data: [{ ...baseChat, id: 'chat-closed', title: 'Closed list chat', custom_state: 'Closed' }], cursor: { next: null, hasMore: false } }),
            { status: 200 },
          );
        }

        return new Response(JSON.stringify({ data: [], cursor: { next: null, hasMore: false } }), { status: 200 });
      }

      if (url === '/api/v1/chats/chat-open') {
        return singleChatFetch;
      }

      return new Response('not found', { status: 404 });
    });

    render(<Home />);
    const user = userEvent.setup();

    await screen.findByText('All states');

    await user.click(screen.getByRole('button', { name: 'Open' }));

    await emitEvent('chat.updated', { chatId: 'chat-open' });

    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(([input]) => {
          const url = typeof input === 'string' ? input : input.toString();
          return url === '/api/v1/chats/chat-open';
        }),
      ).toBe(true);
    });

    await user.click(screen.getByRole('button', { name: 'Closed' }));
    await screen.findByText('Closed list chat');

    resolveSingleChatFetch?.(
      new Response(
        JSON.stringify({
          ...baseChat,
          id: 'chat-open',
          title: 'Open event chat',
          custom_state: 'Open',
        }),
        { status: 200 },
      ),
    );

    await waitFor(() => {
      expect(screen.queryByText('Open event chat')).toBeNull();
    });

    expect(screen.getByText('Closed list chat')).toBeTruthy();
  });

  it('removes archived chats immediately and re-adds on unarchive event', async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();

      if (url === '/api/v1/config') {
        return new Response(
          JSON.stringify({
            appName: 'OpenGram',
            customStates: ['Open', 'Closed'],
            defaultModelIdForNewChats: 'model-a',
            agents: [{ id: 'agent-a', name: 'Agent A', description: 'Alpha' }],
            models: [{ id: 'model-a', name: 'Model A', description: 'Alpha' }],
          }),
          { status: 200 },
        );
      }

      if (url.startsWith('/api/v1/chats/pending-summary')) {
        return new Response(JSON.stringify({ pending_requests_total: 0 }), { status: 200 });
      }

      if (url.startsWith('/api/v1/chats?')) {
        return new Response(
          JSON.stringify({
            data: [{ ...baseChat, id: 'chat-live', title: 'Live chat' }],
            cursor: { next: null, hasMore: false },
          }),
          { status: 200 },
        );
      }

      if (url === '/api/v1/chats/chat-live') {
        return new Response(
          JSON.stringify({
            ...baseChat,
            id: 'chat-live',
            title: 'Live chat',
            is_archived: false,
          }),
          { status: 200 },
        );
      }

      return new Response('not found', { status: 404 });
    });

    render(<Home />);

    await screen.findByText('Live chat');

    await emitEvent('chat.archived', { chatId: 'chat-live' });

    await waitFor(() => {
      expect(screen.queryByText('Live chat')).toBeNull();
    });

    await emitEvent('chat.unarchived', { chatId: 'chat-live' });

    await screen.findByText('Live chat');
  });
});
