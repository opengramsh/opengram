// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import userEvent from '@testing-library/user-event';

import NewChatPage from '@/src/client/pages/new-chat';

vi.mock('facehash', () => ({
  Facehash: ({ name }: { name: string }) => <div data-testid={`facehash-${name}`} />,
}));

function renderNewChatPage() {
  return render(
    <MemoryRouter initialEntries={['/chats/new']}>
      <Routes>
        <Route path="/chats/new" element={<NewChatPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('KAI-233: send button enabled state in new chat', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input.toString();
        if (url === '/api/v1/config') {
          return new Response(
            JSON.stringify({
              agents: [{ id: 'agent-a', name: 'Agent A', description: '' }],
              models: [{ id: 'model-a', name: 'Model A', description: '' }],
            }),
            { status: 200 },
          );
        }
        return new Response('{}', { status: 200 });
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('send button becomes enabled when user types text', async () => {
    renderNewChatPage();
    const user = userEvent.setup();

    await screen.findByText(/send a message to start a new chat/i);

    const sendButton = screen.getByRole('button', { name: 'Send message' });
    // Initially disabled (no text)
    expect(sendButton.hasAttribute('disabled')).toBe(true);

    // Type some text
    const textarea = screen.getByPlaceholderText('Message');
    await user.type(textarea, 'Hello');

    // Send button should now be enabled — this fails because
    // allAttachmentsReady is not passed to ChatComposer from NewChatPage,
    // so !allAttachmentsReady is always true, keeping the button disabled.
    expect(sendButton.hasAttribute('disabled')).toBe(false);
  });
});
