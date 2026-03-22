// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';

import Home from '@/src/client/pages/inbox-layout';
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

vi.mock('@/src/lib/notification-sound', () => ({
  playNotificationSound: vi.fn(),
}));

vi.mock('@/src/lib/notification-preferences', () => ({
  isSoundEnabled: () => false,
}));

type FetchMock = ReturnType<typeof vi.fn>;

function renderHome() {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <Home />
    </MemoryRouter>,
  );
}

describe('iOS return body-lock recovery', () => {
  let fetchMock: FetchMock;

  beforeEach(() => {
    streamMock.listener = null;
    streamMock.unsubscribe.mockReset();

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

      if (url.startsWith('/api/v1/chats/unread-summary')) {
        return new Response(JSON.stringify({ total_unread: 0, unread_by_agent: {} }), { status: 200 });
      }

      if (url.startsWith('/api/v1/chats?')) {
        return new Response(JSON.stringify({ data: [], cursor: { next: null, hasMore: false } }), { status: 200 });
      }

      return new Response('not found', { status: 404 });
    });

    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.removeAttribute('data-scroll-locked');
    document.body.style.pointerEvents = '';
    document.body.style.overflow = '';
    document.body.style.paddingRight = '';
    document.body.style.removeProperty('--removed-body-scroll-bar-size');
  });

  it('clears stale body lock styles on pageshow when no dialog is open', async () => {
    renderHome();
    await screen.findByText('All agents');

    document.body.setAttribute('data-scroll-locked', '1');
    document.body.style.pointerEvents = 'none';
    document.body.style.overflow = 'hidden';
    document.body.style.paddingRight = '12px';
    document.body.style.setProperty('--removed-body-scroll-bar-size', '12px');

    window.dispatchEvent(new Event('pageshow'));

    expect(document.body.getAttribute('data-scroll-locked')).toBeNull();
    expect(document.body.style.pointerEvents).toBe('');
    expect(document.body.style.overflow).toBe('');
    expect(document.body.style.paddingRight).toBe('');
    expect(document.body.style.getPropertyValue('--removed-body-scroll-bar-size')).toBe('');
  });

  it('does not clear lock styles when a dialog is currently open', async () => {
    renderHome();
    await screen.findByText('All agents');

    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    document.body.appendChild(dialog);

    document.body.setAttribute('data-scroll-locked', '1');
    document.body.style.pointerEvents = 'none';
    document.body.style.overflow = 'hidden';

    window.dispatchEvent(new Event('pageshow'));

    expect(document.body.getAttribute('data-scroll-locked')).toBe('1');
    expect(document.body.style.pointerEvents).toBe('none');
    expect(document.body.style.overflow).toBe('hidden');

    dialog.remove();
  });
});
