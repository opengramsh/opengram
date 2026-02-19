'use client';

import { useEffect } from 'react';

import { enablePushNotifications, fetchPushConfig, getPushPermissionState, registerPushServiceWorker } from '@/src/lib/push-client';

const PROMPT_STORAGE_KEY = 'opengram.push.prompted.v1';

export function PushBootstrap() {
  useEffect(() => {
    let cancelled = false;

    async function setupPush() {
      try {
        const config = await fetchPushConfig();
        if (!config.enabled) {
          return;
        }

        await registerPushServiceWorker();

        if (cancelled || !config.vapidPublicKey) {
          return;
        }

        if (getPushPermissionState() !== 'default') {
          return;
        }

        if (window.localStorage.getItem(PROMPT_STORAGE_KEY) === '1') {
          return;
        }

        window.localStorage.setItem(PROMPT_STORAGE_KEY, '1');
        await enablePushNotifications(config.vapidPublicKey);
      } catch {
        // Notification setup is optional and should never block app startup.
      }
    }

    setupPush().catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, []);

  return null;
}
