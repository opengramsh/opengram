import { apiFetch } from '@/src/lib/api-fetch';

export type PushConfigResponse = {
  enabled: boolean;
  vapidPublicKey: string;
};

export type PushPermissionState = NotificationPermission | 'unsupported';

export function isPushSupported() {
  return (
    typeof window !== 'undefined'
    && 'serviceWorker' in navigator
    && 'PushManager' in window
    && 'Notification' in window
  );
}

function urlBase64ToUint8Array(base64String: string) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = `${base64String}${padding}`.replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);

  for (let index = 0; index < rawData.length; index += 1) {
    outputArray[index] = rawData.charCodeAt(index);
  }

  return outputArray;
}

export function getPushPermissionState(): PushPermissionState {
  if (!isPushSupported()) {
    return 'unsupported';
  }

  return Notification.permission;
}

export async function fetchPushConfig(): Promise<PushConfigResponse> {
  const response = await apiFetch('/api/v1/config', { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(`Failed to load config (${response.status}).`);
  }

  const parsed = (await response.json()) as {
    push?: {
      enabled?: boolean;
      vapidPublicKey?: string;
    };
  };

  return {
    enabled: Boolean(parsed.push?.enabled),
    vapidPublicKey: parsed.push?.vapidPublicKey ?? '',
  };
}

export async function registerPushServiceWorker() {
  if (!isPushSupported()) {
    return null;
  }

  return navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' });
}

export async function getCurrentPushSubscription() {
  const registration = await registerPushServiceWorker();
  if (!registration) {
    return null;
  }

  return registration.pushManager.getSubscription();
}

async function sendSubscriptionToServer(subscription: PushSubscription) {
  const response = await apiFetch('/api/v1/push/subscribe', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(subscription.toJSON()),
  });

  if (!response.ok) {
    throw new Error(`Push subscribe failed (${response.status}).`);
  }
}

export async function enablePushNotifications(vapidPublicKey: string) {
  if (!isPushSupported()) {
    throw new Error('Push notifications are not supported by this browser.');
  }

  if (!vapidPublicKey) {
    throw new Error('Push VAPID public key is not configured.');
  }

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    throw new Error('Notification permission was not granted.');
  }

  const registration = await registerPushServiceWorker();
  if (!registration) {
    throw new Error('Service Worker registration failed.');
  }

  const existing = await registration.pushManager.getSubscription();
  const subscription = existing ?? await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
  });

  await sendSubscriptionToServer(subscription);
  return subscription;
}

export async function disablePushNotifications() {
  if (!isPushSupported()) {
    return false;
  }

  const registration = await registerPushServiceWorker();
  if (!registration) {
    return false;
  }

  const subscription = await registration.pushManager.getSubscription();
  if (!subscription) {
    return false;
  }

  await apiFetch('/api/v1/push/subscribe', {
    method: 'DELETE',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ endpoint: subscription.endpoint }),
  });

  return subscription.unsubscribe();
}

export async function sendPushTestNotification() {
  const response = await apiFetch('/api/v1/push/test', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      title: 'OpenGram',
      body: 'Push test notification from Settings',
      chatId: 'settings',
      url: '/settings',
    }),
  });

  if (!response.ok) {
    throw new Error(`Push test failed (${response.status}).`);
  }
}
