'use strict';

const VERSION = '10.12.7BG';
const CACHE_PREFIX = 'nitros-mobile-technician-portal-';
const CACHE_NAME = `${CACHE_PREFIX}${VERSION}`;
const OBSOLETE_CLASSIFIER_CACHE_PREFIXES = [CACHE_PREFIX, 'nitros-image-classifier-', 'nitros-classifier-'];
const APP_SHELL = new URL('./index.html', self.registration.scope).href;

self.addEventListener('install', event => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter(name => name !== CACHE_NAME && OBSOLETE_CLASSIFIER_CACHE_PREFIXES.some(prefix => name.startsWith(prefix))).map(name => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  const isNavigation = request.mode === 'navigate';
  const isAppShellHtml = url.origin === self.location.origin && (url.pathname.endsWith('/') || url.pathname.endsWith('/index.html'));
  if (!isNavigation && !isAppShellHtml) return;

  event.respondWith((async () => {
    try {
      const response = await fetch(request, { cache: 'no-store' });
      if (response.ok) {
        const cache = await caches.open(CACHE_NAME);
        await cache.put(APP_SHELL, response.clone());
      }
      return response;
    } catch (error) {
      const cached = await caches.match(APP_SHELL, { cacheName: CACHE_NAME });
      if (cached) return cached;
      throw error;
    }
  })());
});
