// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import Home from '@/src/client/pages/inbox-layout';
import type { Chat } from '@/src/components/chats/types';
import type { FrontendStreamEvent } from '@/src/lib/events-stream';

const streamMock = vi.hoisted(() => ({
  listener: null as ((event: FrontendStreamEvent) => void) | null,
  unsubscribe: vi.fn(),
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

function renderHome() {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <Home />
    </MemoryRouter>,
  );
}

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
  title_source: 'default',
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

  it('refreshes pending summary only for request events', async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();

      if (url === '/api/v1/config') {
        return new Response(
          JSON.stringify({
            appName: 'OpenGram',
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
        return new Response(JSON.stringify({ data: [], cursor: { next: null, hasMore: false } }), { status: 200 });
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

    renderHome();
    await screen.findByText('All agents');

    const pendingSummaryCallCount = () =>
      fetchMock.mock.calls.filter(([input]) => {
        const url = typeof input === 'string' ? input : input.toString();
        return url.startsWith('/api/v1/chats/pending-summary');
      }).length;

    const initialSummaryCalls = pendingSummaryCallCount();

    await emitEvent('chat.updated', { chatId: 'chat-live' });
    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(([input]) => {
          const url = typeof input === 'string' ? input : input.toString();
          return url === '/api/v1/chats/chat-live';
        }),
      ).toBe(true);
    });
    expect(pendingSummaryCallCount()).toBe(initialSummaryCalls);

    await emitEvent('request.created', { chatId: 'chat-live' });
    await waitFor(() => {
      expect(pendingSummaryCallCount()).toBe(initialSummaryCalls + 1);
    });
  });

  it('removes archived chats immediately and re-adds on unarchive event', async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();

      if (url === '/api/v1/config') {
        return new Response(
          JSON.stringify({
            appName: 'OpenGram',
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

    renderHome();

    await screen.findByText('Live chat');

    await emitEvent('chat.archived', { chatId: 'chat-live' });

    await waitFor(() => {
      expect(screen.queryByText('Live chat')).toBeNull();
    });

    await emitEvent('chat.unarchived', { chatId: 'chat-live' });

    await screen.findByText('Live chat');
  });
});
