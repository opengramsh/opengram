
import { useEffect } from 'react';
import { useNavigate } from 'react-router';

import {
  clearActiveChatHintForSw,
  enablePushNotifications,
  fetchPushConfig,
  getPushPermissionState,
  registerPushServiceWorker,
} from '@/src/lib/push-client';
import { setBrowserNotificationsEnabled } from '@/src/lib/notification-preferences';

const PROMPT_STORAGE_KEY = 'opengram.push.prompted.v1';

export function PushBootstrap() {
  const navigate = useNavigate();

  useEffect(() => {
    const handler = (event: MessageEvent) => {
      if (event.data?.type !== 'push:navigate') {
        return;
      }

      const rawUrl = typeof event.data.url === 'string' ? event.data.url.trim() : '';
      const chatId = typeof event.data.chatId === 'string' ? event.data.chatId.trim() : '';
      const target = rawUrl || (chatId ? `/chats/${encodeURIComponent(chatId)}` : '');

      if (target.startsWith('/')) {
        navigate(target);
      }
    };
    navigator.serviceWorker?.addEventListener('message', handler);
    return () => navigator.serviceWorker?.removeEventListener('message', handler);
  }, [navigate]);

  // Handle macOS native notification clicks — Swift dispatches this custom
  // event via evaluateJavaScript when the user clicks a notification banner.
  useEffect(() => {
    const handler = (event: Event) => {
      const chatId = (event as CustomEvent).detail?.chatId;
      if (typeof chatId === 'string' && chatId) {
        navigate(`/chats/${encodeURIComponent(chatId)}`);
      }
    };
    window.addEventListener('opengram:navigate', handler);
    return () => window.removeEventListener('opengram:navigate', handler);
  }, [navigate]);

  useEffect(() => {
    let cancelled = false;

    async function setupPush() {
      try {
        // macOS native app handles notifications via its own JS bridge —
        // skip web push to avoid duplicate notifications.
        if ((window as { __OPENGRAM_MACOS__?: unknown }).__OPENGRAM_MACOS__) {
          return;
        }

        const config = await fetchPushConfig();
        if (!config.enabled || !config.vapidPublicKey) {
          return;
        }

        await registerPushServiceWorker();
        await clearActiveChatHintForSw();

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
