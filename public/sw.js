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
      badge: '/icons/icon-192.png',
      icon: '/icons/icon-192.png',
      tag: payload.data && payload.data.messageId ? `message:${payload.data.messageId}` : 'opengram',
      renotify: true,
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const targetUrl = event.notification.data && event.notification.data.url
    ? event.notification.data.url
    : '/';

  event.waitUntil((async () => {
    let resolvedTarget;
    try {
      resolvedTarget = new URL(targetUrl, self.location.origin);
    } catch {
      resolvedTarget = new URL('/', self.location.origin);
    }
    const matchedClients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });

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

    if (self.clients.openWindow) {
      await self.clients.openWindow(resolvedTarget.toString());
    }
  })());
});
