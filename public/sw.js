self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

function getActiveChatId() {
  return new Promise(function (resolve) {
    try {
      var request = self.indexedDB.open('opengram-state', 1);
      request.onupgradeneeded = function () {
        var db = request.result;
        if (!db.objectStoreNames.contains('ui-state')) {
          db.createObjectStore('ui-state');
        }
      };
      request.onsuccess = function () {
        try {
          var db = request.result;
          var tx = db.transaction('ui-state', 'readonly');
          var store = tx.objectStore('ui-state');
          var getReq = store.get('activeChatId');
          getReq.onsuccess = function () {
            db.close();
            resolve(typeof getReq.result === 'string' ? getReq.result : null);
          };
          getReq.onerror = function () {
            db.close();
            resolve(null);
          };
        } catch (e) {
          resolve(null);
        }
      };
      request.onerror = function () {
        resolve(null);
      };
    } catch (e) {
      resolve(null);
    }
  });
}

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

  event.waitUntil((async () => {
    const chatId = payload.data && payload.data.chatId;
    if (chatId) {
      const activeChatId = await getActiveChatId();
      if (activeChatId === chatId) {
        return;
      }
    }

    await self.registration.showNotification(payload.title, {
      body: payload.body,
      data: payload.data,
      badge: '/web-app-manifest-192x192.png',
      icon: '/web-app-manifest-192x192.png',
      tag: payload.data && payload.data.messageId ? `message:${payload.data.messageId}` : 'opengram',
      renotify: true,
    });
  })());
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
  const encodedChatPath = chatId ? `/chats/${encodeURIComponent(chatId)}` : '';
  const dataUrl = notificationData && typeof notificationData.url === 'string'
    ? notificationData.url.trim()
    : '';
  const fallbackPath = encodedChatPath || '/';
  let resolvedTarget;

  if (dataUrl) {
    try {
      const parsed = new URL(dataUrl, self.location.origin);
      resolvedTarget = parsed.origin === self.location.origin ? parsed : new URL(fallbackPath, self.location.origin);
    } catch {
      resolvedTarget = new URL(fallbackPath, self.location.origin);
    }
  } else {
    resolvedTarget = new URL(fallbackPath, self.location.origin);
  }

  const targetPath = resolvedTarget.pathname + resolvedTarget.search + resolvedTarget.hash;
  const navigateMessage = {
    type: 'push:navigate',
    url: targetPath,
    chatId,
  };

  event.waitUntil((async () => {
    const matchedClients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });

    // First pass: check for exact same page — just focus it
    for (const client of matchedClients) {
      let clientUrl;
      try {
        clientUrl = new URL(client.url);
      } catch {
        continue;
      }
      const samePage = clientUrl.origin === resolvedTarget.origin
        && clientUrl.pathname === resolvedTarget.pathname
        && clientUrl.search === resolvedTarget.search;

      if (samePage && 'focus' in client) {
        client.postMessage(navigateMessage);
        await client.focus();
        return;
      }
    }

    // Second pass: find any same-origin window and navigate it
    let fallbackClient = null;
    for (const client of matchedClients) {
      let clientUrl;
      try {
        clientUrl = new URL(client.url);
      } catch {
        continue;
      }
      if (clientUrl.origin === resolvedTarget.origin) {
        fallbackClient = client;
        if ('navigate' in client) {
          try {
            await client.navigate(resolvedTarget.toString());
            client.postMessage(navigateMessage);
            await client.focus();
            return;
          } catch {
            // Fall through to openWindow/postMessage fallback.
          }
        }
      }
    }

    // iOS PWAs may not expose navigate() on existing clients; opening the
    // target URL is the most reliable deep-link path on tap.
    if (self.clients.openWindow) {
      try {
        const opened = await self.clients.openWindow(targetPath);
        if (opened) {
          opened.postMessage(navigateMessage);
          await opened.focus();
          return;
        }
      } catch {
        // Continue to last-resort fallback client postMessage.
      }
    }

    // Last resort for older browsers: post message to an existing client.
    if (fallbackClient) {
      fallbackClient.postMessage(navigateMessage);
      await fallbackClient.focus();
    }
  })());
});
