'use strict';

const VERSION = '10.13.144';
const CACHE_PREFIX = 'nitros-mobile-technician-portal-';
const CACHE_NAME = `${CACHE_PREFIX}${VERSION}-encrypted-backup`;
const OBSOLETE_CLASSIFIER_CACHE_PREFIXES = [CACHE_PREFIX, 'nitros-image-classifier-', 'nitros-classifier-'];
const APP_SHELL = new URL('./index.html', self.registration.scope).href;
const STATIC_ASSETS = new Set([
  './image-analysis-ad.js','./dtc-knowledge.js','./support-center.html','./support-center.mjs',
  './support-portal.mjs','./support-auth.mjs','./support-offline-queue.mjs'
].map(path=>new URL(path,self.registration.scope).href));

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

self.addEventListener('push',event=>{
  let ticketId='';try{const data=event.data?.json();if(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(data?.ticketId||''))ticketId=data.ticketId}catch{}
  if(!ticketId)return;
  event.waitUntil(self.registration.showNotification('New Nitros support ticket',{
    body:'Open Support Center to review the new ticket.',tag:`nitros-support-${ticketId}`,renotify:false,
    data:{ticketId,url:`${self.registration.scope}support-center.html?ticket=${encodeURIComponent(ticketId)}`}
  }));
});

self.addEventListener('notificationclick',event=>{
  event.notification.close();const ticketId=event.notification.data?.ticketId;
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(ticketId||''))return;
  const target=new URL(`support-center.html?ticket=${encodeURIComponent(ticketId)}`,self.registration.scope).href;
  event.waitUntil(self.clients.matchAll({type:'window',includeUncontrolled:true}).then(async clients=>{
    for(const client of clients){if(new URL(client.url).origin!==self.location.origin)continue;if('navigate'in client)await client.navigate(target);return client.focus()}
    return self.clients.openWindow(target);
  }));
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  const isNavigation = request.mode === 'navigate';
  const isAppShellHtml = url.origin === self.location.origin && (url.pathname.endsWith('/') || url.pathname.endsWith('/index.html'));
  const isBackupAsset = url.origin === self.location.origin && url.pathname.startsWith(new URL('./backup/', self.registration.scope).pathname);
  const isVersionedStaticAsset = STATIC_ASSETS.has(url.href) || isBackupAsset;
  if (!isNavigation && !isAppShellHtml && !isVersionedStaticAsset) return;

  event.respondWith((async () => {
    try {
      const response = await fetch(request, { cache: 'no-store' });
      if (response.ok && (isVersionedStaticAsset || isAppShellHtml)) {
        const cache = await caches.open(CACHE_NAME);
        await cache.put(isVersionedStaticAsset ? request : APP_SHELL, response.clone());
      }
      return response;
    } catch (error) {
      const cached = isVersionedStaticAsset ? await caches.match(request, { cacheName: CACHE_NAME }) : isAppShellHtml ? await caches.match(APP_SHELL, { cacheName: CACHE_NAME }) : null;
      if (cached) return cached;
      throw error;
    }
  })());
});
