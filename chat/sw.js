/* ==========================================================================
   G4F Chat service worker
   Minimal precache of the app shell + runtime caching for static assets.
   Scope is limited to /chat/ because the worker lives in this directory.
   ========================================================================== */

const VERSION = 'v1';
const CORE_CACHE = `g4f-chat-core-${VERSION}`;
const STATIC_CACHE = `g4f-chat-static-${VERSION}`;
const OFFLINE_URL = new URL('/chat/', self.location.origin).href;

// Keep this list small. Everything else is cached on first use below.
const PRECACHE = [
  '/chat/',
  '/chat/manifest.webmanifest',
  '/chat/pwa.js',
  '/dist/css/style.css',
  '/dist/css/chat-modern.css',
  '/dist/js/framework.js',
  '/dist/js/v2.js',
  '/dist/js/providers.js',
  '/dist/img/g4f.svg',
  '/dist/img/g4f-192x192.png',
  '/dist/img/g4f-512x512.png',
  '/dist/img/g4f-maskable-512x512.png'
];

// Static request types worth caching from same-origin and CDNs.
const STATIC_DESTINATIONS = ['style', 'script', 'font', 'image'];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CORE_CACHE);
    // Ignore individual failures so one 404 cannot block the install.
    await Promise.allSettled(
      PRECACHE.map(async (url) => {
        const response = await fetch(new Request(url, { cache: 'reload' }));
        if (response.ok) await cache.put(url, response);
      })
    );
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keep = new Set([CORE_CACHE, STATIC_CACHE]);
    const keys = await caches.keys();
    await Promise.all(
      keys
        .filter((key) => key.startsWith('g4f-chat-') && !keep.has(key))
        .map((key) => caches.delete(key))
    );
    await self.clients.claim();
  })());
});

/**
 * Version query strings (?v=123) bust the HTTP cache but should not create
 * duplicate service-worker cache entries, so drop the query for /dist/ files.
 */
function cacheKey(request) {
  const url = new URL(request.url);
  if (url.origin === self.location.origin && url.pathname.startsWith('/dist/')) {
    url.search = '';
  }
  return url.href;
}

function isCacheableStatic(request) {
  return STATIC_DESTINATIONS.includes(request.destination);
}

async function staleWhileRevalidate(event, request) {
  const cache = await caches.open(STATIC_CACHE);
  const key = cacheKey(request);
  const cached = await cache.match(key);

  const network = fetch(request)
    .then(async (response) => {
      if (response.ok || response.type === 'opaque') {
        await cache.put(key, response.clone());
      }
      return response;
    })
    .catch(() => null);

  if (cached) {
    event.waitUntil(network);
    return cached;
  }

  const response = await network;
  if (response) return response;

  return new Response('', { status: 504, statusText: 'Offline' });
}

async function networkFirstNavigation(request) {
  try {
    const response = await fetch(request);
    const url = new URL(request.url);
    // Only the chat root is used as the offline fallback shell.
    if (response.ok && (url.pathname === '/chat/' || url.pathname === '/chat/index.html')) {
      const cache = await caches.open(CORE_CACHE);
      await cache.put(OFFLINE_URL, response.clone());
    }
    return response;
  } catch {
    const cache = await caches.open(CORE_CACHE);
    const cached = await cache.match(OFFLINE_URL);
    if (cached) return cached;
    return new Response(
      '<!doctype html><meta charset="utf-8"><title>Offline</title>' +
        '<body style="font:16px system-ui;padding:2rem">You are offline and this page is not cached yet.</body>',
      { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
    );
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event;

  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;
  if (request.headers.has('range')) return;

  // Never intercept API traffic.
  if (
    url.origin === self.location.origin &&
    (url.pathname.startsWith('/api/') || url.pathname.startsWith('/v1/'))
  ) {
    return;
  }

  // App shell: network first so new builds show up, cached copy when offline.
  if (request.mode === 'navigate') {
    if (url.origin !== self.location.origin || !url.pathname.startsWith('/chat/')) return;
    event.respondWith(networkFirstNavigation(request));
    return;
  }

  if (isCacheableStatic(request)) {
    event.respondWith(staleWhileRevalidate(event, request));
  }
});
