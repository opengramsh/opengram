'use client';

import { useCallback, useEffect, useState } from 'react';

import { HamburgerMenu } from '@/src/components/navigation/hamburger-menu';
import {
  disablePushNotifications,
  enablePushNotifications,
  fetchPushConfig,
  getCurrentPushSubscription,
  getPushPermissionState,
  isPushSupported,
  sendPushTestNotification,
  type PushPermissionState,
} from '@/src/lib/push-client';

type SettingsResponse = {
  appName: string;
  push?: {
    enabled?: boolean;
    subject?: string;
    vapidPublicKey?: string;
  };
  security?: {
    instanceSecretEnabled?: boolean;
    readEndpointsRequireInstanceSecret?: boolean;
  };
};

function permissionLabel(permission: PushPermissionState) {
  if (permission === 'unsupported') {
    return 'Not supported in this browser';
  }
  if (permission === 'granted') {
    return 'Granted';
  }
  if (permission === 'denied') {
    return 'Denied';
  }

  return 'Not requested';
}

export default function SettingsPage() {
  const [config, setConfig] = useState<SettingsResponse | null>(null);
  const [permission, setPermission] = useState<PushPermissionState>('unsupported');
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<'enable' | 'disable' | 'test' | null>(null);

  const refreshPushState = useCallback(async () => {
    const currentPermission = getPushPermissionState();
    setPermission(currentPermission);

    if (!isPushSupported()) {
      setIsSubscribed(false);
      return;
    }

    const subscription = await getCurrentPushSubscription();
    setIsSubscribed(Boolean(subscription));
  }, []);

  useEffect(() => {
    async function loadConfig() {
      const response = await fetch('/api/v1/config', { cache: 'no-store' });
      if (!response.ok) {
        return;
      }
      setConfig((await response.json()) as SettingsResponse);
    }

    loadConfig().catch(() => undefined);
    refreshPushState().catch(() => undefined);
  }, [refreshPushState]);

  const handleEnable = useCallback(async () => {
    if (!config?.push?.enabled) {
      setStatusMessage('Push is disabled in server config.');
      return;
    }

    try {
      setBusyAction('enable');
      setStatusMessage(null);
      const pushConfig = await fetchPushConfig();
      await enablePushNotifications(pushConfig.vapidPublicKey);
      setStatusMessage('Notifications enabled.');
      await refreshPushState();
    } catch {
      setStatusMessage('Unable to enable notifications. Check browser permission settings.');
      await refreshPushState();
    } finally {
      setBusyAction(null);
    }
  }, [config?.push?.enabled, refreshPushState]);

  const handleDisable = useCallback(async () => {
    try {
      setBusyAction('disable');
      setStatusMessage(null);
      await disablePushNotifications();
      setStatusMessage('Notifications disabled.');
      await refreshPushState();
    } catch {
      setStatusMessage('Unable to disable notifications.');
    } finally {
      setBusyAction(null);
    }
  }, [refreshPushState]);

  const handleSendTest = useCallback(async () => {
    try {
      setBusyAction('test');
      setStatusMessage(null);
      await sendPushTestNotification();
      setStatusMessage('Test notification sent.');
    } catch {
      setStatusMessage('Unable to send test notification.');
    } finally {
      setBusyAction(null);
    }
  }, []);

  return (
    <div className="mx-auto min-h-screen w-full max-w-3xl bg-background pb-10">
      <header className="sticky top-0 z-20 border-b border-border/70 bg-background/95 px-4 py-3 backdrop-blur-md">
        <div className="grid grid-cols-[36px_1fr_36px] items-center">
          <HamburgerMenu />
          <div className="text-center">
            <h1 className="text-sm font-semibold tracking-wide text-foreground">Settings</h1>
            <p className="text-xs text-muted-foreground">Instance and app controls</p>
          </div>
          <div />
        </div>
      </header>

      <main className="space-y-4 px-4 py-4">
        <section className="rounded-2xl border border-border bg-card p-4">
          <h2 className="text-sm font-semibold text-foreground">Push notifications</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            {config?.push?.enabled ? 'Enabled in config.' : 'Disabled in config.'}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">Permission: {permissionLabel(permission)}</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Subscription: {isSubscribed ? 'Active' : 'Not active'}
          </p>
          {config?.push?.subject && <p className="mt-1 text-xs text-muted-foreground">Subject: {config.push.subject}</p>}

          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground disabled:opacity-60"
              onClick={() => {
                handleEnable().catch(() => undefined);
              }}
              disabled={busyAction !== null || !config?.push?.enabled}
            >
              {busyAction === 'enable' ? 'Enabling…' : 'Enable notifications'}
            </button>
            <button
              type="button"
              className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground disabled:opacity-60"
              onClick={() => {
                handleDisable().catch(() => undefined);
              }}
              disabled={busyAction !== null || !isSubscribed}
            >
              {busyAction === 'disable' ? 'Disabling…' : 'Disable notifications'}
            </button>
            <button
              type="button"
              className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground disabled:opacity-60"
              onClick={() => {
                handleSendTest().catch(() => undefined);
              }}
              disabled={busyAction !== null || !config?.push?.enabled || !isSubscribed}
            >
              {busyAction === 'test' ? 'Sending…' : 'Send test notification'}
            </button>
          </div>

          {statusMessage && <p className="mt-3 text-xs text-muted-foreground">{statusMessage}</p>}

          <p className="mt-3 text-xs text-muted-foreground">
            iOS Safari requires installing OpenGram to Home Screen before push permissions can be granted.
          </p>
        </section>

        <section className="rounded-2xl border border-border bg-card p-4">
          <h2 className="text-sm font-semibold text-foreground">Write security</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            {config?.security?.instanceSecretEnabled
              ? 'Instance secret enforcement is enabled.'
              : 'Instance secret enforcement is disabled.'}
          </p>
          {config?.security?.instanceSecretEnabled && (
            <p className="mt-1 text-sm text-muted-foreground">
              {config.security.readEndpointsRequireInstanceSecret
                ? 'Read endpoints also require the instance secret.'
                : 'Read endpoints do not require the instance secret.'}
            </p>
          )}
        </section>

        <section className="rounded-2xl border border-border bg-card p-4">
          <h2 className="text-sm font-semibold text-foreground">App info</h2>
          <p className="mt-2 text-sm text-muted-foreground">App name: {config?.appName ?? 'OpenGram'}</p>
        </section>
      </main>
    </div>
  );
}
