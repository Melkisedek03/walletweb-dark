// Service worker for the Nusacoin web wallet (PWA app shell).
//
// This is a build-time template, not the served file: the Vite plugin in
// vite.config.ts fills in the cache name and the precache list with the
// actual hashed asset list of each build, so the precache always matches
// the build it ships with. No Workbox or other dependency is involved.
// (The placeholder tokens appear only in the two const lines below, so
// the plugin's string replacement can never land in this comment.)
//
// Caching rules, by design:
// - /electrs/* and every non-GET request: never cached, always network.
//   Balance, UTXO, and broadcast data must never be served stale.
// - Navigation requests: network first, falling back to the cached
//   index.html, so the installed app opens while offline.
// - Precache-listed shell assets: cache first (they are content-hashed
//   and immutable), falling back to network.
// - Other same-origin GET requests: cache first, falling back to network.

const CACHE_NAME = '__CACHE_NAME__';
const PRECACHE_URLS = __PRECACHE_URLS__;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Electrs data and all writes: network only, never cached.
  if (request.method !== 'GET' || url.pathname.startsWith('/electrs/')) return;

  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).catch(() => caches.match('/index.html')));
    return;
  }

  if (url.origin !== self.location.origin) return;
  event.respondWith(caches.match(request).then((cached) => cached || fetch(request)));
});
