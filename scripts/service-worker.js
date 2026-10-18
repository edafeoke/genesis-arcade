/* Generated at build time. Downloads only same-origin app/runtime resources. */
const VERSION = '__OFFLINE_VERSION__';
const CACHE = 'genesis-offline-' + VERSION;
const ASSETS = __OFFLINE_ASSETS__;

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    try {
      // Cache a full HTML document, never an App Router RSC response.
      const shell = await fetch('/', { cache: 'reload', headers: { Accept: 'text/html' } });
      if (!shell.ok || !shell.headers.get('content-type')?.includes('text/html')) throw new Error('App shell unavailable');
      await cache.addAll(ASSETS.map(url => new Request(url, { cache: 'reload' })));
      await cache.put('/', shell);
      await self.skipWaiting();
    } catch (error) {
      await caches.delete(CACHE);
      throw error;
    }
  })());
});
self.addEventListener('activate', event => {
  // Preserve previous packages so tabs running an older build keep their assets.
  event.waitUntil(self.clients.claim());
});
self.addEventListener('message', event => {
  if (event.data?.type !== 'STATUS') return;
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    const complete = (await Promise.all(['/', ...ASSETS].map(url => cache.match(url)))).every(Boolean);
    event.ports[0]?.postMessage({ version: VERSION, ready: complete });
  })());
});
self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;
  if (request.mode === 'navigate' && (url.pathname === '/' || url.pathname === '/player/index.html')) {
    event.respondWith((async () => {
      try { return await fetch(request); }
      catch {
        return (await (await caches.open(CACHE)).match(url.pathname)) || Response.error();
      }
    })());
    return;
  }
  // Never cache API calls, ROM blobs, RSC payloads or arbitrary navigation.
  if (!ASSETS.includes(url.pathname)) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    return (await cache.match(url.pathname)) || fetch(request);
  })());
});
