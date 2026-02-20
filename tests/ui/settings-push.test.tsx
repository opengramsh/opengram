// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const {
  disablePushNotificationsMock,
  enablePushNotificationsMock,
  fetchPushConfigMock,
  getCurrentPushSubscriptionMock,
  getPushPermissionStateMock,
  isPushSupportedMock,
  sendPushTestNotificationMock,
} = vi.hoisted(() => ({
  disablePushNotificationsMock: vi.fn(),
  enablePushNotificationsMock: vi.fn(),
  fetchPushConfigMock: vi.fn(),
  getCurrentPushSubscriptionMock: vi.fn(),
  getPushPermissionStateMock: vi.fn(),
  isPushSupportedMock: vi.fn(),
  sendPushTestNotificationMock: vi.fn(),
}));

vi.mock('@/src/lib/push-client', () => ({
  disablePushNotifications: disablePushNotificationsMock,
  enablePushNotifications: enablePushNotificationsMock,
  fetchPushConfig: fetchPushConfigMock,
  getCurrentPushSubscription: getCurrentPushSubscriptionMock,
  getPushPermissionState: getPushPermissionStateMock,
  isPushSupported: isPushSupportedMock,
  sendPushTestNotification: sendPushTestNotificationMock,
}));

vi.mock('@/src/components/navigation/hamburger-menu', () => ({
  HamburgerMenu: () => <button type="button" aria-label="menu" />,
}));

import SettingsPage from '@/app/settings/page';

describe('settings push notifications', () => {
  beforeEach(() => {
    disablePushNotificationsMock.mockReset();
    enablePushNotificationsMock.mockReset();
    fetchPushConfigMock.mockReset();
    getCurrentPushSubscriptionMock.mockReset();
    getPushPermissionStateMock.mockReset();
    isPushSupportedMock.mockReset();
    sendPushTestNotificationMock.mockReset();

    isPushSupportedMock.mockReturnValue(true);
    getPushPermissionStateMock.mockReturnValue('granted');
    getCurrentPushSubscriptionMock.mockResolvedValue({ endpoint: 'https://example/sub' });
    fetchPushConfigMock.mockResolvedValue({ enabled: true, vapidPublicKey: 'public-key' });
    enablePushNotificationsMock.mockResolvedValue({ endpoint: 'https://example/sub' });
    disablePushNotificationsMock.mockResolvedValue(true);
    sendPushTestNotificationMock.mockResolvedValue(undefined);

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input.toString();
        if (url === '/api/v1/config') {
          return new Response(
            JSON.stringify({
              appName: 'OpenGram',
              push: {
                enabled: true,
                subject: 'mailto:test@example.com',
                vapidPublicKey: 'public-key',
              },
              security: {
                instanceSecretEnabled: false,
              },
            }),
            { status: 200 },
          );
        }

        return new Response('not found', { status: 404 });
      }),
    );
  });

  it('shows permission/subscription state and can send a test notification', async () => {
    const user = userEvent.setup();
    render(<SettingsPage />);

    await screen.findByText('Permission: Granted');
    await screen.findByText('Subscription: Active');

    await user.click(screen.getByRole('button', { name: 'Send test notification' }));

    await waitFor(() => {
      expect(sendPushTestNotificationMock).toHaveBeenCalledTimes(1);
    });

    expect(screen.getByText('Test notification sent.')).toBeTruthy();
  });

  it('enables and disables notifications through push client actions', async () => {
    const user = userEvent.setup();
    render(<SettingsPage />);

    await screen.findByText('Subscription: Active');

    await user.click(screen.getByRole('button', { name: 'Enable notifications' }));

    await waitFor(() => {
      expect(enablePushNotificationsMock).toHaveBeenCalledWith('public-key');
    });

    getCurrentPushSubscriptionMock.mockResolvedValueOnce(null);

    await user.click(screen.getByRole('button', { name: 'Disable notifications' }));

    await waitFor(() => {
      expect(disablePushNotificationsMock).toHaveBeenCalledTimes(1);
    });

    await waitFor(() => {
      expect(screen.getByText('Notifications disabled.')).toBeTruthy();
    });
  });
});
