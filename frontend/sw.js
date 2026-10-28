// Template: vite.config.js fills in the precache list and version at build time.
const CACHE_PREFIX = 'ernaehrungstagebuch-';
const CACHE_NAME = `${CACHE_PREFIX}__CACHE_VERSION__`;
const PRECACHE_URLS = self.__PRECACHE_MANIFEST;
const HOME_CHECK_PARAM = '__home_check';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS))
  );
});

// No automatic skipWaiting: an open page keeps its consistent old version (index.html + assets).
// main.jsx activates a waiting version when the app is started.
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  if (request.method !== 'GET' || url.origin !== self.location.origin) {
    return;
  }

  if (url.pathname.startsWith('/api/') || url.searchParams.has(HOME_CHECK_PARAM)) {
    return;
  }

  // App shell is served from the precache; a new deployment arrives as a new service worker version.
  if (request.mode === 'navigate') {
    event.respondWith(
      caches.open(CACHE_NAME)
        .then((cache) => cache.match('/index.html'))
        .then((cachedResponse) => cachedResponse || fetch(request))
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse;
      }

      return fetch(request).then((networkResponse) => {
        // Never cache an HTML fallback page under the URL of a script, stylesheet or image
        const contentType = networkResponse.headers.get('Content-Type') || '';
        if (networkResponse.ok && !contentType.includes('text/html')) {
          const responseClone = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, responseClone));
        }
        return networkResponse;
      });
    })
  );
});
