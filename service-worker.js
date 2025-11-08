/* service-worker.js — Витрина Разбита
   Стратегии:
   - Навигация (HTML): network-first с таймаутом и fallback из кэша
   - JSON (config/index/news): network-first с fallback
   - Изображения: cache-first
   - Аудио: stale-while-revalidate (без кеша для Range-запросов)
   - Скрипты/стили/шрифты: cache-first
   Офлайн-пакеты: через сообщения OFFLINE_CACHE_ADD / OFFLINE_CACHE_CLEAR_CURRENT с прогрессом.
*/

const SW_VERSION = '8.0.3';
const CORE_CACHE = `core-${SW_VERSION}`;
const RUNTIME_CACHE = `runtime-${SW_VERSION}`;
const MEDIA_CACHE = `media-${SW_VERSION}`;
const OFFLINE_CACHE = `offline-${SW_VERSION}`;
const META_CACHE = `meta-${SW_VERSION}`;

const CORE_ASSETS = [
  './',
  './index.html',
  './news.html',
  './news/news.json',
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
    try { await postToAllClients({ type: 'SW_VERSION', version: SW_VERSION }); } catch {}
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

/** Разбор заголовка Range: bytes=start-end */
function parseRangeHeader(range, totalLength) {
  const m = /^bytes=(\d*)-(\d*)$/.exec(String(range || ''));
  if (!m) return null;
  let start = m[1] === '' ? 0 : parseInt(m[1], 10);
  let end = m[2] === '' ? (totalLength - 1) : parseInt(m[2], 10);
  if (Number.isNaN(start)) start = 0;
  if (Number.isNaN(end)) end = totalLength - 1;
  start = Math.max(0, start);
  end = Math.min(totalLength - 1, end);
  if (end < start) return null;
  return { start, end };
}

/** 206 Partial Content из кэша (MEDIA/ОFFLINE), либо сетью как fallback */
async function serveRangeFromCacheOrNetwork(request) {
  const url = request.url;
  const rangeHeader = request.headers.get('range');
  
  // Для фоновых запросов увеличиваем таймаут
  const isBackground = request.headers.get('purpose') === 'prefetch' || 
                       request.referrer.includes('background') ||
                       self.clients.matchAll({ includeUncontrolled: true }).then(clients => clients.length === 0);
  
  // Пытаемся найти полный ответ в кэшах
  const mediaCache = await caches.open(MEDIA_CACHE);
  const offlineCache = await caches.open(OFFLINE_CACHE);
  let res = await mediaCache.match(url) || await offlineCache.match(url);
  
  // Если нет в кэше — идём в сеть
  if (!res) {
    try {
      // Увеличиваем таймаут для фоновых запросов
      const timeout = isBackground ? 30000 : 10000;
      const controller = new AbortController();
      const id = setTimeout(() => controller.abort(), timeout);
      
      const net = await fetch(request, { 
        signal: controller.signal,
        keepalive: true // критично для фоновых запросов
      });
      
      clearTimeout(id);
      
      if (net && (net.ok || net.status === 206)) {
        // Кэшируем только в том случае, если запрос успешный
        try { 
          await mediaCache.put(url, net.clone()); 
        } catch (e) {
          console.warn('Failed to cache media', e);
        }
        return net;
      }
      return net;
    } catch (e) {
      console.warn('Network request failed for audio', url, e);
      return new Response('', { status: 404 });
    }
  }
  
  // Если ответ «opaque» (no-cors) — тело недоступно, отдаём как есть
  if (res.type === 'opaque') {
    return res;
  }
  
  // Готовим 206 Partial Content из полного тела
  const buf = await res.arrayBuffer();
  const total = buf.byteLength;
  const range = parseRangeHeader(rangeHeader, total);
  
  if (!range) {
    // Если Range некорректный — отдадим 416
    return new Response('', {
      status: 416,
      headers: {
        'Content-Range': `bytes */${total}`
      }
    });
  }
  
  const { start, end } = range;
  const chunk = buf.slice(start, end + 1);
  const contentType = res.headers.get('content-type') || 'audio/mpeg';
  const headers = new Headers(res.headers);
  
  headers.set('Content-Type', contentType);
  headers.set('Content-Length', String(chunk.byteLength));
  headers.set('Accept-Ranges', 'bytes');
  headers.set('Content-Range', `bytes ${start}-${end}/${total}`);
  // Добавляем заголовки для фоновых запросов
  headers.set('Cache-Control', 'public, max-age=31536000');
  headers.set('Keep-Alive', 'timeout=60, max=100');
  
  return new Response(chunk, { status: 206, headers });
}

self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Не вмешиваемся в другие методы кроме GET
  if (request.method !== 'GET') return;

  // Особый случай: Range-запросы для аудио — пробуем 206 из кэша, иначе сеть
    if (isAudioRequest(request) && request.headers.has('range')) {
      event.respondWith(serveRangeFromCacheOrNetwork(request));
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

  // Страницы/данные «Новости»: cache-first
  if (request.url.endsWith('/news.html') || request.url.includes('/news/news.json')) {
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
  if (data.type === 'SKIP_WAITING') {
    event.waitUntil(self.skipWaiting());
  }
  if (data.type === 'GET_SW_VERSION') {
    event.waitUntil(postToAllClients({ type: 'SW_VERSION', version: SW_VERSION }));
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
