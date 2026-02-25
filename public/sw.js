self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', (event) => {
  let payload = {
    title: 'OpenGram',
    body: 'You have a new notification.',
    data: {
      chatId: '',
      type: 'message',
      url: '/',
    },
  };

  if (event.data) {
    try {
      payload = JSON.parse(event.data.text());
    } catch {
      // Keep fallback payload.
    }
  }

  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      data: payload.data,
      badge: '/web-app-manifest-192x192.png',
      icon: '/web-app-manifest-192x192.png',
      tag: payload.data && payload.data.messageId ? `message:${payload.data.messageId}` : 'opengram',
      renotify: true,
    }),
  );
});

self.addEventListener('pushsubscriptionchange', (event) => {
  event.waitUntil((async () => {
    try {
      const options = event.oldSubscription ? event.oldSubscription.options : {};
      const newSubscription = await self.registration.pushManager.subscribe(options);
      await fetch('/api/v1/push/subscribe', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(newSubscription.toJSON()),
      });
    } catch (err) {
      console.error('[sw] pushsubscriptionchange re-subscribe failed:', err);
    }
  })());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const notificationData = event.notification.data && typeof event.notification.data === 'object'
    ? event.notification.data
    : null;
  const chatId = notificationData && typeof notificationData.chatId === 'string'
    ? notificationData.chatId.trim()
    : '';
  const targetUrl = notificationData && typeof notificationData.url === 'string' && notificationData.url.trim()
    ? notificationData.url
    : (chatId ? `/chats/${encodeURIComponent(chatId)}` : '/');

  event.waitUntil((async () => {
    let resolvedTarget;
    try {
      resolvedTarget = new URL(targetUrl, self.location.origin);
    } catch {
      resolvedTarget = new URL('/', self.location.origin);
    }
    const matchedClients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });

    // First pass: check for exact same page — just focus it
    for (const client of matchedClients) {
      const clientUrl = new URL(client.url);
      const samePage = clientUrl.origin === resolvedTarget.origin
        && clientUrl.pathname === resolvedTarget.pathname
        && clientUrl.search === resolvedTarget.search;

      if (samePage && 'focus' in client) {
        await client.focus();
        return;
      }
    }

    // Second pass: find any same-origin window and navigate it
    let fallbackClient = null;
    for (const client of matchedClients) {
      const clientUrl = new URL(client.url);
      if (clientUrl.origin === resolvedTarget.origin) {
        fallbackClient = client;
        if ('navigate' in client) {
          await client.navigate(resolvedTarget.toString());
          await client.focus();
          return;
        }
      }
    }

    // iOS PWAs may not expose navigate() on existing clients; opening the
    // target URL is the most reliable deep-link path on tap.
    if (self.clients.openWindow) {
      const opened = await self.clients.openWindow(
        resolvedTarget.pathname + resolvedTarget.search + resolvedTarget.hash,
      );
      if (opened) {
        return;
      }
    }

    // Last resort for older browsers: post message to an existing client.
    if (fallbackClient) {
      fallbackClient.postMessage({
        type: 'push:navigate',
        url: resolvedTarget.pathname + resolvedTarget.search,
      });
      await fallbackClient.focus();
    }
  })());
});
