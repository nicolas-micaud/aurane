// Service worker source. The Vite plugin in vite.config.ts fills the precache list (hashed assets + shell)
// and the version at build time and writes the result to dist/sw.js.
/* global self, caches, fetch, Response, URL */
const VERSION = '__VERSION__';
const SHELL = `aurane-shell-${VERSION}`;
const RUNTIME = 'aurane-runtime-v1';
// eslint-disable-next-line no-undef
const PRECACHE = __PRECACHE__;

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(PRECACHE)));
  // Do not skipWaiting here: the page decides when to activate a new version (see pwa.ts).
});
self.addEventListener('message', (e) => { if (e.data === 'skip-waiting') self.skipWaiting(); });
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== SHELL && k !== RUNTIME).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

const LIVE = ['/api', '/ws', '/gazette', '/c/', '/healthz'];
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === self.location.origin && LIVE.some((p) => url.pathname.startsWith(p))) return; // always live
  if (req.mode === 'navigate') {
    // Network first, cached shell when offline.
    e.respondWith(fetch(req).catch(() => caches.match('/index.html').then((hit) => hit ?? new Response('Offline', { status: 503 }))));
    return;
  }
  if (url.origin === self.location.origin && url.pathname.startsWith('/assets/')) {
    // Hashed assets never change: cache first.
    e.respondWith(caches.match(req).then((hit) => hit ?? fetch(req).then((res) => { const copy = res.clone(); caches.open(SHELL).then((c) => c.put(req, copy)).catch(() => undefined); return res; })));
    return;
  }
  // Sprites, images, fonts: stale while revalidate.
  e.respondWith(caches.open(RUNTIME).then(async (c) => {
    const hit = await c.match(req);
    const fresh = fetch(req).then((res) => { if (res.ok) c.put(req, res.clone()).catch(() => undefined); return res; }).catch(() => hit);
    return hit ?? fresh;
  }));
});
