// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

import ChatPage from '@/app/chats/[chatId]/page';
import type { FrontendStreamEvent } from '@/src/lib/events-stream';

const streamMock = vi.hoisted(() => ({
  listener: null as ((event: FrontendStreamEvent) => void) | null,
  unsubscribe: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), back: vi.fn() }),
  useParams: () => ({ chatId: 'chat-1' }),
}));

vi.mock('next/image', () => ({
  default: ({ src, alt, unoptimized: _unoptimized, fill: _fill, ...rest }: { src: string; alt: string }) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt={alt} {...rest} />
  ),
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

type MockTrack = { stop: ReturnType<typeof vi.fn> };

describe('chat voice notes', () => {
  let fetchMock: FetchMock;
  let messageBodyLog: Array<Record<string, unknown>>;
  let mediaUploadCount: number;
  let mediaStreamTracks: MockTrack[];
  let getUserMediaMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    streamMock.listener = null;
    streamMock.unsubscribe.mockReset();
    Element.prototype.scrollTo = vi.fn();
    messageBodyLog = [];
    mediaUploadCount = 0;

    mediaStreamTracks = [{ stop: vi.fn() }];

    const stream = {
      getTracks: () => mediaStreamTracks,
    };

    getUserMediaMock = vi.fn(async () => stream);
    vi.stubGlobal('navigator', {
      ...globalThis.navigator,
      mediaDevices: {
        getUserMedia: getUserMediaMock,
      },
    });

    class TestMediaRecorder {
      ondataavailable: ((event: { data: Blob }) => void) | null = null;
      onstop: (() => void) | null = null;
      start = vi.fn(() => {
        this.state = 'recording';
      });
      stop = vi.fn(() => {
        this.state = 'inactive';
        this.ondataavailable?.({ data: new Blob(['voice-bytes'], { type: 'audio/webm' }) });
        this.onstop?.();
      });
      mimeType = 'audio/webm';
      state: 'inactive' | 'recording' = 'inactive';
    }

    vi.stubGlobal('MediaRecorder', TestMediaRecorder);

    fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();

      if (url === '/api/v1/config') {
        return new Response(
          JSON.stringify({
            agents: [{ id: 'agent-a', name: 'Agent A', description: 'Alpha' }],
            models: [{ id: 'model-a', name: 'Model A', description: 'Alpha' }],
            customStates: ['Open'],
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
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      }

      if (url === '/api/v1/chats/chat-1/requests?status=pending') {
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      }

      if (url === '/api/v1/chats/chat-1/media' && (!init?.method || init.method === 'GET')) {
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      }

      if (url === '/api/v1/chats/chat-1/media' && init?.method === 'POST') {
        mediaUploadCount += 1;
        return new Response(
          JSON.stringify({
            id: 'aud-up-1',
            message_id: null,
            filename: 'voice-upload.webm',
            created_at: '2026-02-19T00:00:00.000Z',
            byte_size: 3200,
            content_type: 'audio/webm',
            kind: 'audio',
          }),
          { status: 201 },
        );
      }

      if (url === '/api/v1/chats/chat-1/messages' && init?.method === 'POST') {
        const payload = JSON.parse(String(init.body ?? '{}')) as Record<string, unknown>;
        messageBodyLog.push(payload);
        return new Response(
          JSON.stringify({
            id: 'msg-aud-1',
            role: 'user',
            sender_id: 'user:primary',
            created_at: '2026-02-19T00:00:00.000Z',
            content_final: null,
            content_partial: null,
            stream_state: 'complete',
            trace: payload.trace,
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

  it('records then uploads voice note and creates media-referenced user message', async () => {
    render(<ChatPage />);

    await screen.findByText('Chat 1');

    fireEvent.click(screen.getByRole('button', { name: 'Record voice note' }));

    expect(getUserMediaMock).toHaveBeenCalledTimes(1);
    await screen.findByText('Recording 0:00');
    await act(async () => {
      await new Promise((resolve) => {
        setTimeout(resolve, 1100);
      });
    });

    fireEvent.click(screen.getByRole('button', { name: 'Record voice note' }));

    await waitFor(() => {
      expect(mediaUploadCount).toBe(1);
      expect(messageBodyLog).toHaveLength(1);
    });

    expect(messageBodyLog[0]).toMatchObject({
      role: 'user',
      senderId: 'user:primary',
      trace: { mediaId: 'aud-up-1', kind: 'audio' },
    });
    expect('content' in messageBodyLog[0]).toBe(false);
    expect(mediaStreamTracks[0]?.stop).toHaveBeenCalled();

    expect(await screen.findByRole('button', { name: 'Play voice-upload.webm' })).toBeTruthy();
  });

  it('shows settings prompt when microphone permission is denied', async () => {
    vi.stubGlobal('navigator', {
      ...globalThis.navigator,
      mediaDevices: {
        getUserMedia: vi.fn(async () => {
          throw new DOMException('blocked', 'NotAllowedError');
        }),
      },
    });

    render(<ChatPage />);
    await screen.findByText('Chat 1');

    fireEvent.click(screen.getByRole('button', { name: 'Record voice note' }));

    expect(await screen.findByText(/Microphone access is blocked/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Retry microphone access' })).toBeTruthy();
  });
});
