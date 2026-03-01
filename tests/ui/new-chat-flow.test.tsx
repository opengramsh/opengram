// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import userEvent from '@testing-library/user-event';

import NewChatPage from '@/src/client/pages/new-chat';

vi.mock('facehash', () => ({
  Facehash: ({ name }: { name: string }) => <div data-testid={`facehash-${name}`} />,
}));

type FetchMock = ReturnType<typeof vi.fn>;

function renderNewChatPage(initialPath = '/chats/new') {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        <Route path="/chats/new" element={<NewChatPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

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
    renderNewChatPage('/chats/new?agentId=agent-b&modelId=model-b');
    const user = userEvent.setup();

    await screen.findByText(/send a message to start a new chat/i);
    expect(createChatBodies).toHaveLength(0);

    const firstMessage = screen.getByPlaceholderText('Message');
    await user.type(firstMessage, 'First message from sheet');

    const sendButton = screen.getByRole('button', { name: 'Send message' });
    await user.click(sendButton);

    await waitFor(() => {
      expect(createChatBodies).toHaveLength(1);
    });

    expect(createChatBodies[0]).toEqual({
      agentIds: ['agent-b'],
      modelId: 'model-a',
      firstMessage: 'First message from sheet',
    });

    const postCalls = fetchMock.mock.calls.filter(([input, init]) => {
      const url = typeof input === 'string' ? input : input.toString();
      return url === '/api/v1/chats' && (init?.method ?? 'GET') === 'POST';
    });
    expect(postCalls).toHaveLength(1);
  });

  it('does not create chat when navigating back without sending', async () => {
    renderNewChatPage();
    const user = userEvent.setup();

    await screen.findByRole('button', { name: 'Back' });
    await user.click(screen.getByRole('button', { name: 'Back' }));

    const postCalls = fetchMock.mock.calls.filter(([input, init]) => {
      const url = typeof input === 'string' ? input : input.toString();
      return url === '/api/v1/chats' && (init?.method ?? 'GET') === 'POST';
    });
    expect(postCalls).toHaveLength(0);
    expect(createChatBodies).toHaveLength(0);
  });
});
