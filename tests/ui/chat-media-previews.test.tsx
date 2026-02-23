// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
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

describe('chat media previews', () => {
  let fetchMock: FetchMock;
  let messagesPayload: Array<Record<string, unknown>>;
  let mediaPayload: Array<Record<string, unknown>>;

  beforeEach(() => {
    streamMock.listener = null;
    streamMock.unsubscribe.mockReset();
    Element.prototype.scrollTo = vi.fn();

    messagesPayload = [
      {
        id: 'msg-1',
        role: 'user',
        sender_id: 'user:primary',
        created_at: '2026-02-18T20:40:00.000Z',
        content_final: 'Media message',
        content_partial: null,
        stream_state: 'none',
        trace: { mediaId: 'aud-1' },
      },
    ];

    mediaPayload = [
      {
        id: 'img-1',
        message_id: 'msg-1',
        filename: 'image-1.png',
        created_at: '2026-02-18T20:40:01.000Z',
        byte_size: 1337,
        content_type: 'image/png',
        kind: 'image',
      },
      {
        id: 'aud-1',
        message_id: 'msg-1',
        filename: 'voice-1.webm',
        created_at: '2026-02-18T20:40:02.000Z',
        byte_size: 2048,
        content_type: 'audio/webm',
        kind: 'audio',
      },
      {
        id: 'file-1',
        message_id: 'msg-1',
        filename: 'report.pdf',
        created_at: '2026-02-18T20:40:03.000Z',
        byte_size: 8192,
        content_type: 'application/pdf',
        kind: 'file',
      },
    ];

    fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();

      if (url === '/api/v1/config') {
        return new Response(
          JSON.stringify({
            agents: [{ id: 'agent-a', name: 'Agent A', description: 'Alpha' }],
            models: [{ id: 'model-a', name: 'Model A', description: 'Alpha' }],
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
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      }

      if (url === '/api/v1/chats/chat-1/media') {
        return new Response(JSON.stringify({ data: mediaPayload }), { status: 200 });
      }

      return new Response('not found', { status: 404 });
    });

    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders inline image/file/audio previews and opens full image viewer', async () => {
    const { container } = renderChatPage();

    await screen.findByText('Chat 1');
    await screen.findByText('Media message');

    expect(screen.getByRole('button', { name: 'Open image image-1.png' })).toBeTruthy();
    expect(screen.getByText('report.pdf')).toBeTruthy();
    expect(screen.getByText('8 KB')).toBeTruthy();
    expect(container.querySelectorAll('audio')).toHaveLength(1);

    fireEvent.click(screen.getByRole('button', { name: 'Open image image-1.png' }));

    const viewerDownload = await screen.findByRole('link', { name: 'Download image-1.png' });
    expect(viewerDownload.getAttribute('href')).toBe('/api/v1/files/img-1');
    expect(screen.getByRole('button', { name: 'Close' })).toBeTruthy();
  });

  it('applies gallery filters and supports image view + file download links', async () => {
    renderChatPage();

    await screen.findByText('Chat 1');

    fireEvent.click(screen.getByText('Chat 1'));
    const chatMenu = await screen.findByRole('dialog', { name: 'Chat menu' });
    fireEvent.click(within(chatMenu).getByRole('button', { name: /Media/i }));

    const gallery = await screen.findByRole('dialog', { name: 'Media gallery' });
    expect(within(gallery).getByText('voice-1.webm')).toBeTruthy();
    expect(within(gallery).getByRole('link', { name: 'Download report.pdf' })).toBeTruthy();
    expect(within(gallery).getByRole('button', { name: 'View image image-1.png' })).toBeTruthy();

    fireEvent.click(within(gallery).getByRole('button', { name: 'Images' }));
    expect(within(gallery).queryByText('voice-1.webm')).toBeNull();
    expect(within(gallery).queryByText('report.pdf')).toBeNull();

    fireEvent.click(within(gallery).getByRole('button', { name: 'Audio' }));
    expect(within(gallery).getByText('voice-1.webm')).toBeTruthy();
    expect(within(gallery).queryByText('report.pdf')).toBeNull();

    fireEvent.click(within(gallery).getByRole('button', { name: 'Files' }));
    expect(within(gallery).getByText('report.pdf')).toBeTruthy();
    expect(within(gallery).queryByText('voice-1.webm')).toBeNull();

    fireEvent.click(within(gallery).getByRole('button', { name: 'All' }));
    fireEvent.click(within(gallery).getByRole('button', { name: 'View image image-1.png' }));

    const viewer = await screen.findByRole('dialog', { name: 'Image viewer' });
    const downloadLink = within(viewer).getByRole('link', { name: 'Download image-1.png' });
    expect(downloadLink.getAttribute('href')).toBe('/api/v1/files/img-1');

    const reportDownloads = within(gallery).getAllByRole('link', { name: 'Download report.pdf', hidden: true });
    expect(reportDownloads.some((link) => link.getAttribute('href') === '/api/v1/files/file-1')).toBe(true);
    expect(reportDownloads.some((link) => link.hasAttribute('download'))).toBe(true);
  });
});
