/* service-worker.js — Витрина Разбита
   Стратегии:
   - Навигация (HTML): network-first с таймаутом и fallback из кэша
   - JSON (config/index/news): network-first с fallback
   - Изображения: cache-first
   - Аудио: stale-while-revalidate (без кеша для Range-запросов)
   - Скрипты/стили/шрифты: cache-first
   Офлайн-пакеты: через сообщения OFFLINE_CACHE_ADD / OFFLINE_CACHE_CLEAR_CURRENT с прогрессом.
*/

const SW_VERSION = '8.0.1';
const CORE_CACHE = `core-${SW_VERSION}`;
const RUNTIME_CACHE = `runtime-${SW_VERSION}`;
const MEDIA_CACHE = `media-${SW_VERSION}`;
const OFFLINE_CACHE = `offline-${SW_VERSION}`;
const META_CACHE = `meta-${SW_VERSION}`;

const CORE_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './img/logo.png',
  './img/star.png',
  './img/star2.png',
  './icons/favicon-16.png',
  './icons/favicon-32.png',
  './icons/apple-touch-icon.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CORE_CACHE);
    try {
      await cache.addAll(CORE_ASSETS.map(url => new Request(url, { cache: 'reload' })));
    } catch (e) {
      console.warn('SW install: some core assets failed to cache', e);
    }
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    const allow = new Set([CORE_CACHE, RUNTIME_CACHE, MEDIA_CACHE, OFFLINE_CACHE, META_CACHE]);
    await Promise.all(keys.map(k => allow.has(k) ? Promise.resolve() : caches.delete(k)));
    await self.clients.claim();
  })());
});

// Утилита: запрос с таймаутом
async function fetchWithTimeout(req, { timeout = 5000 } = {}) {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(req, { signal: ctrl.signal });
    return res;
  } finally {
    clearTimeout(id);
  }
}

function isJSONRequest(request) {
  const url = new URL(request.url);
  return url.pathname.endsWith('.json') || request.headers.get('accept')?.includes('application/json');
}
function isNavigationRequest(request) {
  return request.mode === 'navigate' || (request.destination === '' && request.method === 'GET');
}
function isImageRequest(request) {
  return request.destination === 'image';
}
function isAudioRequest(request) {
  return request.destination === 'audio' || request.destination === 'media';
}
function isStaticAsset(request) {
  const d = request.destination;
  return d === 'script' || d === 'style' || d === 'font' || d === 'worker';
}

self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Не вмешиваемся в другие методы кроме GET
  if (request.method !== 'GET') return;

  // Особый случай: Range-запросы для аудио — не кэшируем, напрямую в сеть
  if (isAudioRequest(request) && request.headers.has('range')) {
    event.respondWith(fetch(request));
    return;
  }

  // Навигация: network-first с таймаутом
  if (isNavigationRequest(request)) {
    event.respondWith((async () => {
      const cache = await caches.open(CORE_CACHE);
      try {
        const netRes = await fetchWithTimeout(request, { timeout: 6000 });
        if (netRes && netRes.ok) {
          cache.put(request, netRes.clone()).catch(() => {});
          return netRes;
        }
        const cached = await cache.match(request);
        if (cached) return cached;
        // fallback на index.html
        const index = await cache.match('./index.html');
        if (index) return index;
        return netRes; // как есть (даже если не ok)
      } catch {
        const cached = await cache.match(request) || await cache.match('./index.html');
        if (cached) return cached;
        return new Response('Offline', { status: 503, statusText: 'Offline' });
      }
    })());
    return;
  }

  // JSON: network-first с fallback
  if (isJSONRequest(request)) {
    event.respondWith((async () => {
      const cache = await caches.open(RUNTIME_CACHE);
      try {
        const netRes = await fetchWithTimeout(request, { timeout: 6000 });
        if (netRes && (netRes.ok || netRes.type === 'opaque')) {
          cache.put(request, netRes.clone()).catch(() => {});
          return netRes;
        }
        const cached = await cache.match(request);
        if (cached) return cached;
        return netRes;
      } catch {
        const cached = await cache.match(request);
        if (cached) return cached;
        return new Response('Offline JSON', { status: 503 });
      }
    })());
    return;
  }

  // Изображения: cache-first
  if (isImageRequest(request)) {
    event.respondWith((async () => {
      const cache = await caches.open(MEDIA_CACHE);
      const cached = await cache.match(request);
      if (cached) return cached;
      try {
        const netRes = await fetch(request);
        if (netRes && (netRes.ok || netRes.type === 'opaque')) {
          cache.put(request, netRes.clone()).catch(() => {});
        }
        return netRes;
      } catch {
        return cached || new Response('', { status: 404 });
      }
    })());
    return;
  }

  // Аудио: stale-while-revalidate (без поддержки Range здесь)
  if (isAudioRequest(request)) {
    event.respondWith((async () => {
      const cache = await caches.open(MEDIA_CACHE);
      const cached = await cache.match(request);
      const revalidate = (async () => {
        try {
          const netRes = await fetch(request);
          if (netRes && (netRes.ok || netRes.type === 'opaque')) {
            cache.put(request, netRes.clone()).catch(() => {});
          }
        } catch {}
      })();
      return cached || (await fetch(request).catch(() => new Response('', { status: 404 })));
    })());
    return;
  }

  // Скрипты/стили/шрифты: cache-first
  if (isStaticAsset(request)) {
    event.respondWith((async () => {
      const cache = await caches.open(RUNTIME_CACHE);
      const cached = await cache.match(request);
      if (cached) return cached;
      try {
        const netRes = await fetch(request);
        if (netRes && netRes.ok) {
          cache.put(request, netRes.clone()).catch(() => {});
        }
        return netRes;
      } catch {
        return cached || new Response('', { status: 404 });
      }
    })());
    return;
  }

  // По умолчанию — просто прокси в сеть
  event.respondWith(fetch(request));
});

// ===== Сообщения от клиента (офлайн кэш пакетами и состояние) =====

async function postToAllClients(msg) {
  const clientsList = await self.clients.matchAll({ includeUncontrolled: true, type: 'window' });
  for (const c of clientsList) c.postMessage(msg);
}

async function readOfflineList() {
  const cache = await caches.open(META_CACHE);
  const key = new Request('meta:offline-list');
  const res = await cache.match(key);
  if (!res) return [];
  try {
    const json = await res.json();
    return Array.isArray(json) ? json : [];
  } catch { return []; }
}
async function writeOfflineList(list) {
  const cache = await caches.open(META_CACHE);
  const key = new Request('meta:offline-list');
  await cache.put(key, new Response(JSON.stringify(Array.from(new Set(list))), {
    headers: { 'content-type': 'application/json' }
  }));
}

self.addEventListener('message', (event) => {
  const data = event.data || {};
  if (data.type === 'OFFLINE_CACHE_ADD') {
    event.waitUntil(offlineAddResources(Array.isArray(data.resources) ? data.resources : []));
  }
  if (data.type === 'OFFLINE_CACHE_CLEAR_CURRENT') {
    event.waitUntil(clearCurrentOfflineResources());
  }
  if (data.type === 'REQUEST_OFFLINE_STATE') {
    event.waitUntil((async () => {
      const list = await readOfflineList();
      postToAllClients({ type: 'OFFLINE_STATE', value: list.length > 0 });
    })());
  }
});

async function offlineAddResources(resources) {
  if (!resources || !resources.length) {
    await writeOfflineList([]);
    await postToAllClients({ type: 'OFFLINE_DONE' });
    return;
  }
  const cache = await caches.open(OFFLINE_CACHE);
  const prev = await readOfflineList();
  const toCache = resources.map(u => {
    try { return new URL(u, self.registration.scope).toString(); } catch { return u; }
  });
  let done = 0;
  const total = toCache.length;

  for (const url of toCache) {
    try {
      // Пытаемся с CORS, иначе — no-cors (opaque)
      let res = await fetch(url, { cache: 'no-cache' }).catch(() => null);
      if (!res || !(res.ok || res.type === 'opaque')) {
        res = await fetch(url, { mode: 'no-cors' }).catch(() => null);
      }
      if (res) {
        await cache.put(url, res.clone());
      }
      done++;
      await postToAllClients({ type: 'OFFLINE_PROGRESS', percent: Math.round(done / total * 100) });
    } catch {
      done++;
      await postToAllClients({ type: 'OFFLINE_PROGRESS', percent: Math.round(done / total * 100) });
    }
  }
  await writeOfflineList([...prev, ...toCache]);
  await postToAllClients({ type: 'OFFLINE_DONE' });
}

async function clearCurrentOfflineResources() {
  const cache = await caches.open(OFFLINE_CACHE);
  const list = await readOfflineList();
  if (list.length) {
    await Promise.allSettled(list.map(u => cache.delete(u)));
  }
  await writeOfflineList([]);
  await postToAllClients({ type: 'OFFLINE_DONE' });
}
