// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import Home from '@/app/page';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock('facehash', () => ({
  Facehash: ({ name }: { name: string }) => <div data-testid={`facehash-${name}`} />,
}));

type FetchMock = ReturnType<typeof vi.fn>;

describe('new chat flow UI', () => {
  let fetchMock: FetchMock;
  const createChatBodies: Array<Record<string, unknown>> = [];

  beforeEach(() => {
    createChatBodies.length = 0;
    fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      const method = init?.method ?? 'GET';

      if (url === '/api/v1/config') {
        return new Response(
          JSON.stringify({
            appName: 'OpenGram',
            customStates: ['Open', 'Closed'],
            agents: [
              { id: 'agent-a', name: 'Agent A', description: 'Alpha agent' },
              { id: 'agent-b', name: 'Agent B', description: 'Beta agent' },
            ],
            models: [
              { id: 'model-a', name: 'Model A', description: 'Alpha model' },
              { id: 'model-b', name: 'Model B', description: 'Beta model' },
            ],
            defaultModelIdForNewChats: 'model-a',
          }),
          { status: 200 },
        );
      }

      if (url.startsWith('/api/v1/chats/pending-summary')) {
        return new Response(JSON.stringify({ pending_requests_total: 0 }), { status: 200 });
      }

      if (url.startsWith('/api/v1/chats') && method === 'GET') {
        return new Response(JSON.stringify({ data: [], cursor: { next: null, hasMore: false } }), {
          status: 200,
        });
      }

      if (url === '/api/v1/chats' && method === 'POST') {
        if (init?.body) {
          createChatBodies.push(JSON.parse(String(init.body)) as Record<string, unknown>);
        }
        return new Response(
          JSON.stringify({
            id: 'chat-1',
            title: 'Hello from the first message',
          }),
          { status: 201 },
        );
      }

      return new Response('not found', { status: 404 });
    });

    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('creates chat only when first message is sent with selected agent/model payload', async () => {
    render(<Home />);
    const user = userEvent.setup();

    await screen.findByLabelText('New chat');

    await user.click(screen.getByLabelText('New chat'));

    expect(screen.getByText('New Chat')).toBeTruthy();
    expect(createChatBodies).toHaveLength(0);

    await user.click(screen.getByRole('button', { name: /Agent B.*Beta agent/ }));

    const modelSelect = screen.getByRole('combobox') as HTMLSelectElement;
    await user.selectOptions(modelSelect, 'model-b');
    expect(modelSelect.value).toBe('model-b');

    const firstMessage = screen.getByPlaceholderText('Start with a message...');
    await user.type(firstMessage, '  First message from sheet   ');

    const sendButton = screen.getByRole('button', { name: 'Send' });
    await user.click(sendButton);

    await waitFor(() => {
      expect(createChatBodies).toHaveLength(1);
    });

    expect(createChatBodies[0]).toEqual({
      agentIds: ['agent-b'],
      modelId: 'model-b',
      firstMessage: 'First message from sheet',
    });

    await waitFor(() => {
      expect(screen.queryByText('New Chat')).toBeNull();
    });

    const postCalls = fetchMock.mock.calls.filter(([input, init]) => {
      const url = typeof input === 'string' ? input : input.toString();
      return url === '/api/v1/chats' && (init?.method ?? 'GET') === 'POST';
    });
    expect(postCalls).toHaveLength(1);
  });

  it('does not create chat when dismissing the sheet without sending', async () => {
    render(<Home />);
    const user = userEvent.setup();

    await screen.findByLabelText('New chat');

    await user.click(screen.getByLabelText('New chat'));
    expect(screen.getByText('New Chat')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    await waitFor(() => {
      expect(screen.queryByText('New Chat')).toBeNull();
    });

    const postCalls = fetchMock.mock.calls.filter(([input, init]) => {
      const url = typeof input === 'string' ? input : input.toString();
      return url === '/api/v1/chats' && (init?.method ?? 'GET') === 'POST';
    });
    expect(postCalls).toHaveLength(0);
    expect(createChatBodies).toHaveLength(0);
  });
});
