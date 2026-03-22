// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router';

const {
  clearActiveChatHintForSwMock,
  enablePushNotificationsMock,
  fetchPushConfigMock,
  getPushPermissionStateMock,
  registerPushServiceWorkerMock,
} = vi.hoisted(() => ({
  clearActiveChatHintForSwMock: vi.fn(),
  enablePushNotificationsMock: vi.fn(),
  fetchPushConfigMock: vi.fn(),
  getPushPermissionStateMock: vi.fn(),
  registerPushServiceWorkerMock: vi.fn(),
}));

vi.mock('@/src/lib/push-client', () => ({
  clearActiveChatHintForSw: clearActiveChatHintForSwMock,
  enablePushNotifications: enablePushNotificationsMock,
  fetchPushConfig: fetchPushConfigMock,
  getPushPermissionState: getPushPermissionStateMock,
  registerPushServiceWorker: registerPushServiceWorkerMock,
}));

import { PushBootstrap } from '@/src/components/push/push-bootstrap';

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="path">{location.pathname}</div>;
}

describe('PushBootstrap', () => {
  beforeEach(() => {
    clearActiveChatHintForSwMock.mockReset();
    enablePushNotificationsMock.mockReset();
    fetchPushConfigMock.mockReset();
    getPushPermissionStateMock.mockReset();
    registerPushServiceWorkerMock.mockReset();
    clearActiveChatHintForSwMock.mockResolvedValue(undefined);
    fetchPushConfigMock.mockResolvedValue({ enabled: false, vapidPublicKey: '' });
    getPushPermissionStateMock.mockReturnValue('default');
    registerPushServiceWorkerMock.mockResolvedValue(null);
  });

  it('navigates when receiving a push:navigate service worker message with URL', async () => {
    let onMessage: ((event: MessageEvent) => void) | null = null;
    Object.defineProperty(globalThis.navigator, 'serviceWorker', {
      configurable: true,
      value: {
        addEventListener: vi.fn((type: string, listener: (event: MessageEvent) => void) => {
          if (type === 'message') {
            onMessage = listener;
          }
        }),
        removeEventListener: vi.fn(),
      },
    });

    render(
      <MemoryRouter initialEntries={['/']}>
        <PushBootstrap />
        <LocationProbe />
      </MemoryRouter>,
    );

    expect(screen.getByTestId('path').textContent).toBe('/');
    expect(onMessage).toBeTypeOf('function');

    act(() => {
      onMessage?.({
        data: {
          type: 'push:navigate',
          url: '/chats/abc',
        },
      } as MessageEvent);
    });

    await waitFor(() => {
      expect(screen.getByTestId('path').textContent).toBe('/chats/abc');
    });
  });

  it('navigates using chatId when URL is missing', async () => {
    let onMessage: ((event: MessageEvent) => void) | null = null;
    Object.defineProperty(globalThis.navigator, 'serviceWorker', {
      configurable: true,
      value: {
        addEventListener: vi.fn((type: string, listener: (event: MessageEvent) => void) => {
          if (type === 'message') {
            onMessage = listener;
          }
        }),
        removeEventListener: vi.fn(),
      },
    });

    render(
      <MemoryRouter initialEntries={['/']}>
        <PushBootstrap />
        <LocationProbe />
      </MemoryRouter>,
    );

    expect(onMessage).toBeTypeOf('function');
    act(() => {
      onMessage?.({
        data: {
          type: 'push:navigate',
          chatId: 'chat 42',
        },
      } as MessageEvent);
    });

    await waitFor(() => {
      expect(screen.getByTestId('path').textContent).toBe('/chats/chat%2042');
    });
  });
});
