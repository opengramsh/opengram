// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';

import Home from '@/src/client/pages/home';

vi.mock('facehash', () => ({
  Facehash: ({ name }: { name: string }) => <div data-testid={`facehash-${name}`} />,
}));

function renderHome() {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <Home />
    </MemoryRouter>,
  );
}

describe('inbox pending badge', () => {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
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
      return new Response(JSON.stringify({ pending_requests_total: 3 }), { status: 200 });
    }

    if (url.startsWith('/api/v1/chats?')) {
      return new Response(
        JSON.stringify({
          data: [
            {
              id: 'chat-1',
              is_archived: false,
              title: 'Chat 1',
              tags: [],
              pinned: false,
              agent_ids: ['agent-a'],
              model_id: 'model-a',
              last_message_preview: 'hello',
              last_message_role: 'agent',
              pending_requests_count: 3,
              last_read_at: null,
              unread_count: 0,
              created_at: '2026-02-18T10:00:00.000Z',
              updated_at: '2026-02-18T10:00:00.000Z',
              last_message_at: '2026-02-18T10:00:00.000Z',
            },
          ],
          cursor: { next: null, hasMore: false },
        }),
        { status: 200 },
      );
    }

    return new Response('not found', { status: 404 });
  });

  beforeEach(() => {
    fetchMock.mockClear();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('shows pending request count in header and row badge', async () => {
    renderHome();

    expect(await screen.findByText('3 pending requests')).toBeTruthy();
    expect(await screen.findByLabelText('3 pending requests')).toBeTruthy();
  });
});
