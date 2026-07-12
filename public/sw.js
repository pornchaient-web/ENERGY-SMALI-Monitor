// Self-destructing service worker to clear all PWA caches globally and force refresh
self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(keys.map((key) => caches.delete(key)));
    })
  );
  self.clients.claim().then(() => {
    return self.clients.matchAll();
  }).then((clients) => {
    clients.forEach((client) => {
      if (client.url) {
        client.navigate(client.url);
      }
    });
  });
});

