/* ═══════════════════════════════════════════════════════════
   SmartBusAI — Service Worker
   Cache strategy: Cache-First for static, Network-First for API
   Version: 1.0.0
═══════════════════════════════════════════════════════════ */
'use strict';

const CACHE_NAME    = 'smartbusai-v2';
const API_CACHE     = 'smartbusai-api-v2';
const OFFLINE_PAGE  = '/pages/passenger/index.html';

/* Static assets to pre-cache on install */
const STATIC_ASSETS = [
  '/',
  '/pages/passenger/index.html',
  '/pages/passenger/profile.html',
  '/pages/passenger/booking.html',
  '/pages/auth/login.html',
  '/pages/auth/register.html',
  '/js/api.js',
  '/manifest.json',
  '/icons/icon.svg',
];

/* ── Install: pre-cache static assets ── */
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(STATIC_ASSETS.map(url => {
        return new Request(url, { cache: 'reload' });
      })).catch(() => {}))
      .then(() => self.skipWaiting())
  );
});

/* ── Activate: clean old caches ── */
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(k => k !== CACHE_NAME && k !== API_CACHE)
          .map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

/* ── Fetch strategy ── */
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET and cross-origin
  if (request.method !== 'GET') return;
  if (url.origin !== location.origin) return;

  // API: Network-first, fallback to cache
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(networkFirstAPI(request));
    return;
  }

  // Socket.io polling — never intercept
  if (url.pathname.startsWith('/socket.io/')) return;

  // HTML pages: Network-first (luôn lấy bản mới nhất)
  if (request.mode === 'navigate' || url.pathname.endsWith('.html')) {
    event.respondWith(networkFirstHTML(request));
    return;
  }

  // Static assets (JS, CSS, images): Cache-first
  event.respondWith(cacheFirstStatic(request));
});

/* HTML luôn lấy từ network, fallback cache nếu offline */
async function networkFirstHTML(request) {
  try {
    const networkResp = await fetch(request.clone());
    if (networkResp.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, networkResp.clone());
    }
    return networkResp;
  } catch {
    const cached = await caches.match(request);
    if (cached) return cached;
    return new Response('Offline', { status: 503 });
  }
}

async function networkFirstAPI(request) {
  try {
    const networkResp = await fetch(request.clone());
    if (networkResp.ok) {
      const cache = await caches.open(API_CACHE);
      cache.put(request, networkResp.clone());
    }
    return networkResp;
  } catch {
    const cached = await caches.match(request);
    if (cached) return cached;
    return new Response(JSON.stringify({ error: 'Offline', cached: false }),
      { status: 503, headers: { 'Content-Type': 'application/json' } });
  }
}

async function cacheFirstStatic(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  try {
    const networkResp = await fetch(request.clone());
    if (networkResp.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, networkResp.clone());
    }
    return networkResp;
  } catch {
    // Return offline page for navigation requests
    if (request.mode === 'navigate') {
      const offlinePage = await caches.match(OFFLINE_PAGE);
      if (offlinePage) return offlinePage;
    }
    return new Response('Offline', { status: 503 });
  }
}

/* ── Push notifications ── */
self.addEventListener('push', event => {
  if (!event.data) return;
  let data = {};
  try { data = event.data.json(); } catch { data.body = event.data.text(); }

  event.waitUntil(
    self.registration.showNotification(data.title || 'SmartBusAI', {
      body:    data.body || 'Bạn có thông báo mới',
      icon:    '/icons/icon.svg',
      badge:   '/icons/icon.svg',
      tag:     data.tag || 'smartbusai-notif',
      data:    { url: data.url || '/' },
      actions: [
        { action: 'open',    title: 'Xem ngay' },
        { action: 'dismiss', title: 'Bỏ qua'  }
      ],
      vibrate: [200, 100, 200]
    })
  );
});

/* ── Notification click ── */
self.addEventListener('notificationclick', event => {
  event.notification.close();
  if (event.action === 'dismiss') return;
  const url = event.notification.data?.url || '/';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then(clientList => {
        for (const client of clientList) {
          if (client.url.includes(url) && 'focus' in client) return client.focus();
        }
        return clients.openWindow(url);
      })
  );
});

/* ── Background sync (retry failed bookings) ── */
self.addEventListener('sync', event => {
  if (event.tag === 'sync-bookings') {
    event.waitUntil(syncPendingBookings());
  }
});

async function syncPendingBookings() {
  // Placeholder for background sync logic
  console.log('[SW] Background sync: sync-bookings');
}
