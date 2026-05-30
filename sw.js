/**
 * pwa-weather-lens — Service Worker
 *
 * Caching strategies used:
 *  - Static assets (HTML, CSS, JS, icons) → Cache First
 *  - Weather API calls                    → Network First with offline fallback
 *  - Google Fonts                         → Stale While Revalidate
 *
 * Cache versioning: bump CACHE_VERSION on every deploy
 * so stale assets are cleaned up automatically.
 */

const CACHE_VERSION = 'v1';
const STATIC_CACHE  = `weather-lens-static-${CACHE_VERSION}`;
const API_CACHE     = `weather-lens-api-${CACHE_VERSION}`;
const FONT_CACHE    = `weather-lens-fonts-${CACHE_VERSION}`;

/** Files to pre-cache during the install phase (app shell) */
const APP_SHELL = [
  '/index.html',
  '/css/style.css',
  '/js/app.js',
  '/js/db.js',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/offline.html'
];

const WEATHER_API_ORIGIN = 'https://api.open-meteo.com';
const GEO_API_ORIGIN     = 'https://geocoding-api.open-meteo.com';
const FONT_ORIGIN        = 'https://fonts.googleapis.com';
const FONT_FILES_ORIGIN  = 'https://fonts.gstatic.com';

// ─── INSTALL ────────────────────────────────────────────────────────────────
// Pre-cache the entire app shell so the app loads instantly on repeat visits
// and works fully offline from the first use.
self.addEventListener('install', event => {
  console.log('[SW] Installing — caching app shell');

  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then(cache => cache.addAll(APP_SHELL))
      .then(() => {
        console.log('[SW] App shell cached');
        // Skip waiting forces this SW to become active immediately
        // instead of waiting for old tabs to close.
        return self.skipWaiting();
      })
      .catch(err => console.warn('[SW] Pre-cache failed (some files may not exist yet):', err))
  );
});

// ─── ACTIVATE ────────────────────────────────────────────────────────────────
// Clean up old caches from previous versions so users don't accumulate
// stale assets on their device.
self.addEventListener('activate', event => {
  console.log('[SW] Activating — cleaning old caches');

  const currentCaches = [STATIC_CACHE, API_CACHE, FONT_CACHE];

  event.waitUntil(
    caches.keys()
      .then(cacheNames =>
        Promise.all(
          cacheNames
            .filter(name => !currentCaches.includes(name))
            .map(name => {
              console.log('[SW] Deleting old cache:', name);
              return caches.delete(name);
            })
        )
      )
      .then(() => {
        console.log('[SW] Now controlling all clients');
        // Claim clients so the new SW takes effect without a page reload.
        return self.clients.claim();
      })
  );
});

// ─── FETCH ───────────────────────────────────────────────────────────────────
// Route every network request through the appropriate caching strategy.
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET requests (POST, PUT, DELETE, etc.)
  if (request.method !== 'GET') return;

  // Skip chrome-extension and other non-http(s) requests
  if (!url.protocol.startsWith('http')) return;

  // ── Google Fonts → Stale While Revalidate ──────────────────────────────
  // Fonts rarely change. Serve from cache immediately, update in background.
  if (url.origin === FONT_ORIGIN || url.origin === FONT_FILES_ORIGIN) {
    event.respondWith(staleWhileRevalidate(request, FONT_CACHE));
    return;
  }

  // ── Weather / Geo API → Network First ──────────────────────────────────
  // Weather data must be fresh. Try network first, fall back to last cached
  // response if offline. Cache responses for 10 minutes.
  if (url.origin === WEATHER_API_ORIGIN || url.origin === GEO_API_ORIGIN) {
    event.respondWith(networkFirst(request, API_CACHE, 10 * 60 * 1000));
    return;
  }

  // ── Static assets → Cache First ────────────────────────────────────────
  // HTML, CSS, JS, icons served from cache. Network used only if not cached.
  event.respondWith(cacheFirst(request, STATIC_CACHE));
});

// ─── CACHING STRATEGIES ──────────────────────────────────────────────────────

/**
 * Cache First — best for static assets that rarely change.
 * 1. Check cache → if hit, return cached response.
 * 2. If miss → fetch from network, store in cache, return response.
 * 3. If both fail → return offline page.
 */
async function cacheFirst(request, cacheName) {
  const cached = await caches.match(request);
  if (cached) return cached;

  try {
    const networkResponse = await fetch(request);
    if (networkResponse.ok) {
      const cache = await caches.open(cacheName);
      cache.put(request, networkResponse.clone());
    }
    return networkResponse;
  } catch {
    // For navigation requests, show the offline page
    if (request.mode === 'navigate') {
      return caches.match('/offline.html');
    }
    return new Response('Offline', { status: 503, statusText: 'Service Unavailable' });
  }
}

/**
 * Network First — best for API data that should be fresh.
 * 1. Fetch from network first.
 * 2. Cache the response (with timestamp).
 * 3. On network failure → return cached response if within maxAge.
 * 4. If cache also expired or missing → return offline JSON.
 *
 * @param {Request} request
 * @param {string}  cacheName
 * @param {number}  maxAge     Max cache age in milliseconds
 */
async function networkFirst(request, cacheName, maxAge = 600000) {
  try {
    const networkResponse = await fetch(request);
    if (networkResponse.ok) {
      const cache = await caches.open(cacheName);
      // Store response alongside a timestamp header for expiry checks
      const responseToCache = new Response(await networkResponse.clone().text(), {
        status: networkResponse.status,
        statusText: networkResponse.statusText,
        headers: {
          ...Object.fromEntries(networkResponse.headers.entries()),
          'sw-cached-at': Date.now().toString()
        }
      });
      cache.put(request, responseToCache);
    }
    return networkResponse;
  } catch {
    // Network failed — try the cache
    const cached = await caches.match(request);
    if (cached) {
      const cachedAt = parseInt(cached.headers.get('sw-cached-at') || '0');
      const age = Date.now() - cachedAt;
      if (age < maxAge) {
        console.log('[SW] Serving stale API cache (age:', Math.round(age / 1000), 's)');
        return cached;
      }
    }
    // Nothing usable — return structured offline JSON
    return new Response(
      JSON.stringify({ offline: true, message: 'No network and no valid cache available.' }),
      { status: 503, headers: { 'Content-Type': 'application/json' } }
    );
  }
}

/**
 * Stale While Revalidate — best for fonts and low-priority assets.
 * 1. Return cached version immediately (fast).
 * 2. Simultaneously fetch from network and update cache for next time.
 */
async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);

  // Kick off network fetch regardless (to keep cache fresh)
  const fetchPromise = fetch(request).then(networkResponse => {
    if (networkResponse.ok) cache.put(request, networkResponse.clone());
    return networkResponse;
  });

  return cached || fetchPromise;
}

// ─── BACKGROUND SYNC ─────────────────────────────────────────────────────────
// When offline actions (e.g. saving a favourite city) are queued,
// this fires when connectivity is restored.
self.addEventListener('sync', event => {
  console.log('[SW] Background sync:', event.tag);
  if (event.tag === 'sync-favourites') {
    event.waitUntil(syncFavourites());
  }
});

async function syncFavourites() {
  // In a real app: read queued items from IndexedDB, POST to server
  console.log('[SW] Syncing favourites from offline queue');
}

// ─── PUSH NOTIFICATIONS ──────────────────────────────────────────────────────
self.addEventListener('push', event => {
  const data = event.data?.json() ?? { title: 'Weather Alert', body: 'Check the latest forecast.' };

  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      tag: 'weather-alert',
      renotify: true,
      data: { url: data.url || '/index.html' }
    })
  );
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window' }).then(clientList => {
      const targetUrl = event.notification.data?.url || '/index.html';
      for (const client of clientList) {
        if (client.url === targetUrl && 'focus' in client) return client.focus();
      }
      if (clients.openWindow) return clients.openWindow(targetUrl);
    })
  );
});
