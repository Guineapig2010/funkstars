// FUNKSTARS service worker: offline app shell + cache-on-play for songs.
const VERSION = 'funkstars-v1';
const SHELL = ['./', './index.html', './manifest.webmanifest', './songs/manifest.json'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  // range requests (media seeking) go straight to the network
  if (req.headers.has('range')) return;
  const isNav = req.mode === 'navigate';
  const isManifest = url.pathname.endsWith('/songs/manifest.json') || url.pathname.endsWith('/sw.js');
  if (isNav || isManifest) {
    // network first, fall back to cache
    e.respondWith(fetch(req).then((res) => { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(isNav ? './index.html' : req, copy)); return res; })
      .catch(() => caches.match(isNav ? './index.html' : req)));
    return;
  }
  // cache first for hashed assets, songs, charts, fonts, icons
  e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((res) => {
    if (res.ok && res.type === 'basic') { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(req, copy)); }
    return res;
  })));
});
