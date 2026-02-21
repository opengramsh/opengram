// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';

import ChatPage from '@/src/client/pages/chat';
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

function renderChatPage() {
  return render(
    <MemoryRouter initialEntries={['/chats/chat-1']}>
      <Routes>
        <Route path="/chats/:chatId" element={<ChatPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

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

describe('chat screen event subscriptions', () => {
  let fetchMock: FetchMock;
  let requestsPayload: Array<Record<string, unknown>>;
  let messagesPayload: Array<Record<string, unknown>>;

  beforeEach(() => {
    streamMock.listener = null;
    streamMock.unsubscribe.mockReset();
    eventId = 0;
    requestsPayload = [];
    messagesPayload = [];
    Element.prototype.scrollTo = vi.fn();

    fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();

      if (url === '/api/v1/config') {
        return new Response(
          JSON.stringify({
            agents: [{ id: 'agent-a', name: 'Agent A', description: 'Alpha' }],
            models: [{ id: 'model-a', name: 'Model A', description: 'Alpha' }],
            customStates: ['Open', 'Closed'],
          }),
          { status: 200 },
        );
      }

      if (url === '/api/v1/chats/chat-1') {
        return new Response(
          JSON.stringify({
            id: 'chat-1',
            title: 'Chat 1',
            tags: [],
            custom_state: 'Open',
            model_id: 'model-a',
            pinned: false,
            is_archived: false,
            agent_ids: ['agent-a'],
            pending_requests_count: 0,
          }),
          { status: 200 },
        );
      }

      if (url === '/api/v1/chats/chat-1/messages?limit=200') {
        return new Response(JSON.stringify({ data: messagesPayload }), { status: 200 });
      }

      if (url === '/api/v1/chats/chat-1/requests?status=pending') {
        return new Response(JSON.stringify({ data: requestsPayload }), { status: 200 });
      }

      if (url === '/api/v1/chats/chat-1/media') {
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      }

      return new Response('not found', { status: 404 });
    });

    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders streaming chunks and transitions to complete/cancelled states', async () => {
    renderChatPage();

    await screen.findByText('Chat 1');
    await waitFor(() => {
      expect(streamMock.listener).toBeTruthy();
    });

    await emitEvent('message.created', {
      chatId: 'chat-1',
      messageId: 'msg-1',
      role: 'agent',
      senderId: 'agent-a',
      streamState: 'streaming',
    });

    await screen.findByText('Streaming...');

    messagesPayload = [
      {
        id: 'msg-1',
        role: 'agent',
        sender_id: 'agent-a',
        created_at: '2026-02-18T20:40:00.000Z',
        content_final: null,
        content_partial: 'Hello',
        stream_state: 'streaming',
      },
    ];

    await emitEvent('message.streaming.chunk', {
      chatId: 'chat-1',
      messageId: 'msg-1',
      deltaText: 'Hello',
    });

    await screen.findByText('Hello');

    messagesPayload = [
      {
        id: 'msg-1',
        role: 'agent',
        sender_id: 'agent-a',
        created_at: '2026-02-18T20:40:00.000Z',
        content_final: 'Hello final',
        content_partial: null,
        stream_state: 'complete',
      },
    ];

    await emitEvent('message.streaming.complete', {
      chatId: 'chat-1',
      messageId: 'msg-1',
      finalText: 'Hello final',
      streamState: 'complete',
    });

    await screen.findByText('Hello final');
    expect(screen.queryByText('Streaming...')).toBeNull();

    await emitEvent('message.created', {
      chatId: 'chat-1',
      messageId: 'msg-2',
      role: 'agent',
      senderId: 'agent-a',
      streamState: 'streaming',
    });
    await emitEvent('message.streaming.chunk', {
      chatId: 'chat-1',
      messageId: 'msg-2',
      deltaText: 'still here',
    });

    messagesPayload = [
      {
        id: 'msg-1',
        role: 'agent',
        sender_id: 'agent-a',
        created_at: '2026-02-18T20:40:00.000Z',
        content_final: 'Hello final',
        content_partial: null,
        stream_state: 'complete',
      },
      {
        id: 'msg-2',
        role: 'agent',
        sender_id: 'agent-a',
        created_at: '2026-02-18T20:41:00.000Z',
        content_final: null,
        content_partial: 'still here',
        stream_state: 'cancelled',
      },
    ];
    await emitEvent('message.streaming.complete', {
      chatId: 'chat-1',
      messageId: 'msg-2',
      streamState: 'cancelled',
    });

    await screen.findByText('still here');
  });

  it('patches non-streaming message into state without full refetch', async () => {
    renderChatPage();

    await screen.findByText('Chat 1');
    await waitFor(() => {
      expect(streamMock.listener).toBeTruthy();
    });

    const fetchCountBefore = fetchMock.mock.calls.length;

    await emitEvent('message.created', {
      chatId: 'chat-1',
      messageId: 'msg-inline',
      role: 'user',
      senderId: 'user:primary',
      streamState: 'none',
      contentFinal: 'Inlined message',
      createdAt: '2026-02-18T20:42:00.000Z',
    });

    await screen.findByText('Inlined message');

    const messagesFetches = fetchMock.mock.calls
      .slice(fetchCountBefore)
      .filter(([url]: [string]) => url.includes('/messages'));
    expect(messagesFetches).toHaveLength(0);
  });

  it('refreshes pending requests on request lifecycle events', async () => {
    renderChatPage();

    await screen.findByText('Chat 1');

    requestsPayload = [
      {
        id: 'req-1',
        chat_id: 'chat-1',
        type: 'text_input',
        status: 'pending',
        title: 'Need input',
        body: 'Please answer',
        config: {},
        created_at: '2026-02-18T20:00:00.000Z',
      },
    ];

    await emitEvent('request.created', { chatId: 'chat-1', requestId: 'req-1' });

    await waitFor(() => {
      expect(screen.getByText('Pending requests (1)')).toBeTruthy();
    });
    expect(screen.getByText('Need input')).toBeTruthy();
  });
});
