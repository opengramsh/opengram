
import { useEffect } from 'react';

import { enablePushNotifications, fetchPushConfig, getPushPermissionState, registerPushServiceWorker } from '@/src/lib/push-client';
import { setBrowserNotificationsEnabled } from '@/src/lib/notification-preferences';

const PROMPT_STORAGE_KEY = 'opengram.push.prompted.v1';

export function PushBootstrap() {
  useEffect(() => {
    let cancelled = false;

    async function setupPush() {
      try {
        const config = await fetchPushConfig();
        if (!config.enabled || !config.vapidPublicKey) {
          return;
        }

        await registerPushServiceWorker();

        if (cancelled) {
          return;
        }

        const permission = getPushPermissionState();

        // Permission already granted — always re-sync subscription to server
        // (handles iOS silently dropping subscriptions, reinstalls, failed
        // initial POSTs, etc.)
        if (permission === 'granted') {
          await enablePushNotifications(config.vapidPublicKey);
          return;
        }

        // First-visit prompt flow: only trigger once per device
        if (permission !== 'default') {
          return;
        }

        if (window.localStorage.getItem(PROMPT_STORAGE_KEY) === '1') {
          return;
        }

        await enablePushNotifications(config.vapidPublicKey);
        // Only mark as prompted after successful subscription
        window.localStorage.setItem(PROMPT_STORAGE_KEY, '1');
        setBrowserNotificationsEnabled(true);
      } catch (err) {
        // Notification setup is optional and should never block app startup.
        console.error('[push-bootstrap] setup failed:', err);
      }
    }

    setupPush().catch((err) => console.error('[push-bootstrap] unexpected error:', err));

    return () => {
      cancelled = true;
    };
  }, []);

  return null;
}
