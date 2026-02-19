// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

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
  default: () => <div data-testid="next-image" />,
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

describe('chat request widget', () => {
  let fetchMock: FetchMock;
  let requestsPayload: Array<Record<string, unknown>>;
  let resolvePayloads: Array<{ requestId: string; payload: Record<string, unknown> }>;

  beforeEach(() => {
    streamMock.listener = null;
    streamMock.unsubscribe.mockReset();
    Element.prototype.scrollTo = vi.fn();
    resolvePayloads = [];
    requestsPayload = [];

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
            pending_requests_count: requestsPayload.length,
          }),
          { status: 200 },
        );
      }

      if (url === '/api/v1/chats/chat-1/messages?limit=200') {
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      }

      if (url === '/api/v1/chats/chat-1/requests?status=pending') {
        return new Response(JSON.stringify({ data: requestsPayload }), { status: 200 });
      }

      if (url === '/api/v1/chats/chat-1/media') {
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      }

      if (url.startsWith('/api/v1/requests/') && url.endsWith('/resolve') && init?.method === 'POST') {
        const requestId = url.split('/')[4] ?? 'unknown';
        const payload = JSON.parse(String(init.body ?? '{}')) as Record<string, unknown>;
        resolvePayloads.push({ requestId, payload });
        return new Response(JSON.stringify({ id: requestId, status: 'resolved' }), { status: 200 });
      }

      return new Response('not found', { status: 404 });
    });

    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('supports grouped collapse and single-select choice resolution with optimistic removal', async () => {
    requestsPayload = [
      {
        id: 'req-choice',
        chat_id: 'chat-1',
        type: 'choice',
        status: 'pending',
        title: 'Pick one',
        body: 'Choose action',
        config: {
          options: [
            { id: 'approve', label: 'Approve', variant: 'primary' },
            { id: 'reject', label: 'Reject', variant: 'danger' },
          ],
          minSelections: 1,
          maxSelections: 1,
        },
        created_at: '2026-02-18T20:00:00.000Z',
      },
      {
        id: 'req-text',
        chat_id: 'chat-1',
        type: 'text_input',
        status: 'pending',
        title: 'Another',
        body: null,
        config: {},
        created_at: '2026-02-18T20:01:00.000Z',
      },
    ];

    const user = userEvent.setup();
    render(<ChatPage />);

    await screen.findByText('Pending requests (2)');
    expect(screen.getByText('Pick one')).toBeTruthy();
    expect(screen.getByText('Another')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: /Pending requests \(2\)/i }));
    expect(screen.queryByText('Pick one')).toBeNull();
    await user.click(screen.getByRole('button', { name: /Pending requests \(2\)/i }));
    await screen.findByText('Pick one');

    await user.click(screen.getByRole('button', { name: 'Approve' }));
    await user.click(screen.getByRole('button', { name: 'Reject' }));
    await user.click(screen.getAllByRole('button', { name: 'Submit' })[0] as HTMLElement);

    await waitFor(() => {
      expect(resolvePayloads).toHaveLength(1);
    });
    expect(resolvePayloads[0]).toMatchObject({
      requestId: 'req-choice',
      payload: { selectedOptionIds: ['reject'] },
    });
    expect(screen.queryByText('Pick one')).toBeNull();
    expect(screen.getByText('Pending requests (1)')).toBeTruthy();
  });

  it('validates text input request using min/max and pattern before submit', async () => {
    requestsPayload = [
      {
        id: 'req-text',
        chat_id: 'chat-1',
        type: 'text_input',
        status: 'pending',
        title: 'Need code',
        body: 'Only lowercase a allowed',
        config: {
          placeholder: 'Type only a',
          validation: {
            minLength: 2,
            maxLength: 4,
            pattern: '^a+$',
          },
        },
        created_at: '2026-02-18T20:00:00.000Z',
      },
    ];

    const user = userEvent.setup();
    render(<ChatPage />);

    const input = await screen.findByPlaceholderText('Type only a');
    await user.type(input, 'b');
    await user.click(screen.getByRole('button', { name: 'Submit' }));
    expect(await screen.findByText('Response must be at least 2 characters.')).toBeTruthy();
    expect(resolvePayloads).toHaveLength(0);

    fireEvent.change(input, { target: { value: 'aaaaa' } });
    await user.click(screen.getByRole('button', { name: 'Submit' }));
    expect(await screen.findByText('Response must be 4 characters or fewer.')).toBeTruthy();
    expect(resolvePayloads).toHaveLength(0);

    await user.clear(input);
    await user.type(input, 'bbb');
    await user.click(screen.getByRole('button', { name: 'Submit' }));
    expect(await screen.findByText('Response does not match the required format.')).toBeTruthy();
    expect(resolvePayloads).toHaveLength(0);

    await user.clear(input);
    await user.type(input, 'aaa');
    await user.click(screen.getByRole('button', { name: 'Submit' }));

    await waitFor(() => {
      expect(resolvePayloads).toHaveLength(1);
    });
    expect(resolvePayloads[0]).toMatchObject({
      requestId: 'req-text',
      payload: { text: 'aaa' },
    });
  });

  it('renders form fields and submits values with custom submit label', async () => {
    requestsPayload = [
      {
        id: 'req-form',
        chat_id: 'chat-1',
        type: 'form',
        status: 'pending',
        title: 'Form title',
        body: 'Fill details',
        config: {
          fields: [
            { name: 'title', type: 'text', label: 'Title', required: true },
            { name: 'details', type: 'textarea', label: 'Details' },
            { name: 'priority', type: 'select', label: 'Priority', required: true, options: ['low', 'high'] },
            { name: 'tags', type: 'multiselect', label: 'Tags', options: ['bug', 'docs'] },
            { name: 'urgent', type: 'checkbox', label: 'Urgent' },
          ],
          submitLabel: 'Send form',
        },
        created_at: '2026-02-18T20:00:00.000Z',
      },
    ];

    const user = userEvent.setup();
    render(<ChatPage />);

    const submitButton = await screen.findByRole('button', { name: 'Send form' });
    await user.click(submitButton);
    expect(await screen.findByText('Title is required.')).toBeTruthy();
    expect(resolvePayloads).toHaveLength(0);

    await user.type(screen.getByLabelText('Title *'), 'Fix bug');
    await user.type(screen.getByLabelText('Details'), 'More details');
    await user.selectOptions(screen.getByLabelText('Priority *'), 'high');

    await user.selectOptions(screen.getByLabelText('Tags'), ['bug', 'docs']);
    await user.click(screen.getByLabelText('Urgent'));
    await user.click(submitButton);

    await waitFor(() => {
      expect(resolvePayloads).toHaveLength(1);
    });
    expect(resolvePayloads[0]).toMatchObject({
      requestId: 'req-form',
      payload: {
        values: {
          title: 'Fix bug',
          details: 'More details',
          priority: 'high',
          tags: ['bug', 'docs'],
          urgent: true,
        },
      },
    });
  });
});
