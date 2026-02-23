// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
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

type MockTrack = { stop: ReturnType<typeof vi.fn> };

describe('chat voice notes', () => {
  let fetchMock: FetchMock;
  let messageBodyLog: Array<Record<string, unknown>>;
  let mediaUploadCount: number;
  let mediaDeleteCount: number;
  let messageCreateStatus: number;
  let mediaStreamTracks: MockTrack[];
  let getUserMediaMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    streamMock.listener = null;
    streamMock.unsubscribe.mockReset();
    Element.prototype.scrollTo = vi.fn();
    messageBodyLog = [];
    mediaUploadCount = 0;
    mediaDeleteCount = 0;
    messageCreateStatus = 201;

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

      if (url === '/api/v1/media/aud-up-1' && init?.method === 'DELETE') {
        mediaDeleteCount += 1;
        return new Response(
          JSON.stringify({
            id: 'aud-up-1',
          }),
          { status: 200 },
        );
      }

      if (url === '/api/v1/chats/chat-1/messages' && init?.method === 'POST') {
        const payload = JSON.parse(String(init.body ?? '{}')) as Record<string, unknown>;
        messageBodyLog.push(payload);
        if (messageCreateStatus >= 400) {
          return new Response(JSON.stringify({ error: 'failed' }), { status: messageCreateStatus });
        }
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
    renderChatPage();

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

  it('uploads voice notes even when recording is stopped before one second', async () => {
    renderChatPage();
    await screen.findByText('Chat 1');

    fireEvent.click(screen.getByRole('button', { name: 'Record voice note' }));
    await screen.findByText('Recording 0:00');
    fireEvent.click(screen.getByRole('button', { name: 'Record voice note' }));

    await waitFor(() => {
      expect(mediaUploadCount).toBe(1);
      expect(messageBodyLog).toHaveLength(1);
    });
  });

  it('deletes uploaded media if voice message creation fails', async () => {
    messageCreateStatus = 500;

    renderChatPage();
    await screen.findByText('Chat 1');

    fireEvent.click(screen.getByRole('button', { name: 'Record voice note' }));
    await screen.findByText('Recording 0:00');
    fireEvent.click(screen.getByRole('button', { name: 'Record voice note' }));

    await waitFor(() => {
      expect(mediaUploadCount).toBe(1);
      expect(mediaDeleteCount).toBe(1);
    });

    expect(screen.queryByRole('button', { name: 'Play voice-upload.webm' })).toBeNull();
    expect(await screen.findByText('Failed to upload voice note.')).toBeTruthy();
  });

  it('supports inline audio playback controls and seek', async () => {
    renderChatPage();
    await screen.findByText('Chat 1');

    fireEvent.click(screen.getByRole('button', { name: 'Record voice note' }));
    await screen.findByText('Recording 0:00');
    fireEvent.click(screen.getByRole('button', { name: 'Record voice note' }));
    const playButton = await screen.findByRole('button', { name: 'Play voice-upload.webm' });

    const audio = document.querySelector('audio[src="/api/v1/files/aud-up-1"]') as HTMLAudioElement | null;
    expect(audio).toBeTruthy();
    if (!audio) {
      return;
    }

    let pausedState = true;
    Object.defineProperty(audio, 'paused', {
      configurable: true,
      get: () => pausedState,
    });
    const playSpy = vi.fn(async () => {
      pausedState = false;
    });
    const pauseSpy = vi.fn(() => {
      pausedState = true;
    });
    Object.defineProperty(audio, 'play', { configurable: true, value: playSpy });
    Object.defineProperty(audio, 'pause', { configurable: true, value: pauseSpy });
    Object.defineProperty(audio, 'duration', { configurable: true, value: 75 });
    Object.defineProperty(audio, 'currentTime', { configurable: true, value: 0, writable: true });

    fireEvent(audio, new Event('loadedmetadata'));
    expect(screen.getByText('0:00 / 1:15')).toBeTruthy();

    fireEvent.click(playButton);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Pause voice-upload.webm' })).toBeTruthy();
    });
    expect(playSpy).toHaveBeenCalledTimes(1);

    audio.currentTime = 10;
    fireEvent(audio, new Event('timeupdate'));
    expect(screen.getByText('0:10 / 1:15')).toBeTruthy();

    fireEvent.change(screen.getByRole('slider', { name: 'Progress voice-upload.webm' }), {
      target: { value: '20' },
    });
    expect(audio.currentTime).toBe(20);
    expect(screen.getByText('0:20 / 1:15')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Pause voice-upload.webm' }));
    expect(pauseSpy).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Play voice-upload.webm' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Play voice-upload.webm' }));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Pause voice-upload.webm' })).toBeTruthy();
    });

    fireEvent(audio, new Event('ended'));
    expect(screen.getByRole('button', { name: 'Play voice-upload.webm' })).toBeTruthy();
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

    renderChatPage();
    await screen.findByText('Chat 1');

    fireEvent.click(screen.getByRole('button', { name: 'Record voice note' }));

    expect(await screen.findByText(/Microphone access is blocked/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Retry microphone access' })).toBeTruthy();
  });
});
