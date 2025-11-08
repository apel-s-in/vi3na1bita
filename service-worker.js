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
const MEDIA_CACHE = 'media'; // постоянное имя для сохранения кэша между версиями
const OFFLINE_CACHE = `offline-${SW_VERSION}`;
const META_CACHE = `meta-${SW_VERSION}`;
// Конфиг по умолчанию (переопределяется через CONFIG_UPDATE из custom.json)
const DEFAULT_SW_CONFIG = {
  mediaMaxCacheMB: 150,
  nonRangeMaxStoreMB: 25,
  nonRangeMaxStoreMBSlow: 10,
  allowUnknownSize: false,
  revalidateDays: 7 // через столько дней делать HEAD‑перевалидацию
};

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
    await Promise.all(keys.map(async (k) => {
      // Сохраняем постоянный MEDIA_CACHE и любые старые media-* (мягкая миграция),
      // остальное — по белому списку.
      if (
        k === CORE_CACHE || k === RUNTIME_CACHE || k === MEDIA_CACHE ||
        k === OFFLINE_CACHE || k === META_CACHE || k.startsWith('media-')
      ) return;
      await caches.delete(k);
    }));
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
  const clients = await self.clients.matchAll({ includeUncontrolled: true, type: 'window' }).catch(() => []);
  const isBackground = request.headers.get('purpose') === 'prefetch' ||
                       (request.referrer && request.referrer.includes('background')) ||
                       clients.length === 0;

  // Пробуем любой кэш (вкл. старые media-*)
  let res = await caches.match(url);
  if (res && (res.status === 206 || res.type === 'opaque')) {
    res = null; // нужен только 200-full
  }

  if (!res) {
    try {
      const timeout = isBackground ? 30000 : 10000;
      const controller = new AbortController();
      const id = setTimeout(() => controller.abort(), timeout);
      const net = await fetch(request, { signal: controller.signal, keepalive: true });
      clearTimeout(id);
      // 206 не кэшируем, 200 можно положить (через non-Range путь)
      return net;
    } catch {
      return new Response('', { status: 404 });
    }
  }

  // Есть полный буфер — собираем 206 Partial Content
  await touchMediaItem(url).catch(()=>{});
  const buf = await res.arrayBuffer();
  const total = buf.byteLength;
  const range = parseRangeHeader(rangeHeader, total);
  if (!range) {
    return new Response('', { status: 416, headers: { 'Content-Range': `bytes */${total}` } });
  }
  const { start, end } = range;
  const chunk = buf.slice(start, end + 1);
  const contentType = res.headers.get('content-type') || 'audio/mpeg';

  const headers = new Headers();
  headers.set('Content-Type', contentType);
  headers.set('Content-Length', String(chunk.byteLength));
  headers.set('Accept-Ranges', 'bytes');
  headers.set('Content-Range', `bytes ${start}-${end}/${total}`);
  headers.set('Cache-Control', 'public, max-age=31536000');
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

  // Аудио: stale-while-revalidate (кэшируем ТОЛЬКО 200 full по лимитам; LRU; редкая HEAD‑ревалидация)
  if (isAudioRequest(request)) {
    event.respondWith((async () => {
      const url = request.url;
      // Любой кэш (учтём возможные старые media-*)
      const cached = await caches.match(url);

      if (!request.headers.has('range')) {
        // Фоновая ревалидация (HEAD) для кэшированного
        if (cached) { maybeHeadRevalidate(url).catch(()=>{}); }
        // Параллельно — попытка перевалидировать через GET и положить в persistent media
        (async () => {
          try {
            const netRes = await fetch(request, { keepalive: true });
            if (netRes && netRes.ok && netRes.status === 200 && await shouldCacheNonRangeAudio(netRes)) {
              const cache = await caches.open(MEDIA_CACHE);
              await cache.put(url, netRes.clone());
              const size = bytesFromHeader(netRes) || 0;
              await upsertMediaItem(url, {
                size,
                etag: netRes.headers.get('etag'),
                lastModified: netRes.headers.get('last-modified')
              });
            }
          } catch {}
        })();
      }

      // Отдаём кэш, если есть
      if (cached) {
        touchMediaItem(url).catch(()=>{});
        return cached;
      }

      // Иначе — сеть
      try {
        const netRes = await fetch(request);
        // Положим только 200 full по лимитам
        if (!request.headers.has('range') && netRes && netRes.ok && netRes.status === 200 && await shouldCacheNonRangeAudio(netRes)) {
          const cache = await caches.open(MEDIA_CACHE);
          await cache.put(url, netRes.clone());
          const size = bytesFromHeader(netRes) || 0;
          await upsertMediaItem(url, {
            size,
            etag: netRes.headers.get('etag'),
            lastModified: netRes.headers.get('last-modified')
          });
        }
        return netRes;
      } catch {
        return new Response('', { status: 404 });
      }
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

// Храним «последний запрошенный офлайн-список» для Background Sync
async function writeLastRequestedOffline(list) {
  const cache = await caches.open(META_CACHE);
  const key = new Request('meta:last-requested-offline');
  await cache.put(key, new Response(JSON.stringify(Array.from(new Set(list))), {
    headers: { 'content-type': 'application/json' }
  }));
}
async function readLastRequestedOffline() {
  const cache = await caches.open(META_CACHE);
  const key = new Request('meta:last-requested-offline');
  const res = await cache.match(key);
  if (!res) return [];
  try { const j = await res.json(); return Array.isArray(j) ? j : []; } catch { return []; }
}
// ----- SW-config (из custom.json через CONFIG_UPDATE) -----
async function writeSwConfig(cfg) {
  const cache = await caches.open(META_CACHE);
  await cache.put(new Request('meta:sw-config'), new Response(JSON.stringify(cfg || {}), {
    headers: { 'content-type': 'application/json' }
  }));
}
async function readSwConfig() {
  try {
    const cache = await caches.open(META_CACHE);
    const res = await cache.match('meta:sw-config');
    if (!res) return { ...DEFAULT_SW_CONFIG };
    const j = await res.json().catch(()=>null);
    const base = { ...DEFAULT_SW_CONFIG };
    if (j && j.sw && typeof j.sw === 'object') {
      const sw = j.sw;
      base.mediaMaxCacheMB = Number.isFinite(sw.mediaMaxCacheMB) ? sw.mediaMaxCacheMB : base.mediaMaxCacheMB;
      base.nonRangeMaxStoreMB = Number.isFinite(sw.nonRangeMaxStoreMB) ? sw.nonRangeMaxStoreMB : base.nonRangeMaxStoreMB;
      base.nonRangeMaxStoreMBSlow = Number.isFinite(sw.nonRangeMaxStoreMBSlow) ? sw.nonRangeMaxStoreMBSlow : base.nonRangeMaxStoreMBSlow;
      base.allowUnknownSize = typeof sw.allowUnknownSize === 'boolean' ? sw.allowUnknownSize : base.allowUnknownSize;
      base.revalidateDays = Number.isFinite(sw.revalidateDays) ? sw.revalidateDays : base.revalidateDays;
    }
    return base;
  } catch {
    return { ...DEFAULT_SW_CONFIG };
  }
}
// --- NET_STATE + лимиты для non-Range аудио ---
async function writeNetState(state) {
  try {
    const cache = await caches.open(META_CACHE);
    await cache.put(new Request('meta:net-state'), new Response(JSON.stringify(state || {}), {
      headers: { 'content-type': 'application/json' }
    }));
  } catch {}
}
// --- NET_STATE + лимиты для non-Range аудио ---
async function writeNetState(state) {
  try {
    const cache = await caches.open(META_CACHE);
    await cache.put(new Request('meta:net-state'), new Response(JSON.stringify(state || {}), {
      headers: { 'content-type': 'application/json' }
    }));
  } catch {}
}
async function readNetState() {
  try {
    const cache = await caches.open(META_CACHE);
    const res = await cache.match('meta:net-state');
    if (!res) return { saveData: false, downlink: null, effectiveType: null };
    const j = await res.json().catch(()=>null);
    return j && typeof j === 'object' ? j : { saveData: false, downlink: null, effectiveType: null };
  } catch {
    return { saveData: false, downlink: null, effectiveType: null };
  }
}
function bytesFromHeader(res) {
  const h = res && res.headers ? res.headers.get('content-length') : null;
  if (!h) return null;
  const n = parseInt(h, 10);
  return Number.isFinite(n) && n >= 0 ? n : null;
}
async function shouldCacheNonRangeAudio(response) {
  if (!response || !response.ok || response.status !== 200 || response.type === 'opaque') return false;
  const ns = await readNetState();
  const cfg = await readSwConfig();
  const slow = !!ns.saveData || (typeof ns.downlink === 'number' && ns.downlink > 0 && ns.downlink <= 1.3) || (ns.effectiveType && /(^|-)2g$/.test(ns.effectiveType));
  const limitMB = slow ? cfg.nonRangeMaxStoreMBSlow : cfg.nonRangeMaxStoreMB;
  const limitB = limitMB * 1024 * 1024;
  const size = bytesFromHeader(response);
  if (size == null) return !!cfg.allowUnknownSize;
  return size <= limitB;
}

// ----- media-map (LRU) -----
async function readMediaMap() {
  const cache = await caches.open(META_CACHE);
  const res = await cache.match('meta:media-map');
  if (!res) return { totalSize: 0, items: {} };
  try { const j = await res.json(); return (j && typeof j === 'object') ? j : { totalSize: 0, items: {} }; }
  catch { return { totalSize: 0, items: {} }; }
}
async function writeMediaMap(map) {
  const cache = await caches.open(META_CACHE);
  await cache.put('meta:media-map', new Response(JSON.stringify(map), { headers: { 'content-type': 'application/json' } }));
}
async function touchMediaItem(url) {
  try {
    const map = await readMediaMap();
    if (map.items[url]) {
      map.items[url].lastAccess = Date.now();
      await writeMediaMap(map);
    }
  } catch {}
}
async function upsertMediaItem(url, meta) {
  const map = await readMediaMap();
  const prev = map.items[url];
  const size = Number.isFinite(meta.size) ? meta.size : 0;
  if (!prev) {
    map.items[url] = {
      size,
      etag: meta.etag || null,
      lastModified: meta.lastModified || null,
      lastAccess: Date.now(),
      revalidatedAt: meta.revalidatedAt || 0
    };
    map.totalSize += size;
  } else {
    const delta = size - (prev.size || 0);
    map.totalSize += delta;
    prev.size = size;
    prev.etag = meta.etag || prev.etag || null;
    prev.lastModified = meta.lastModified || prev.lastModified || null;
    prev.lastAccess = Date.now();
    if (meta.revalidatedAt) prev.revalidatedAt = meta.revalidatedAt;
  }
  await writeMediaMap(map);
  await ensureMediaBudget(map);
}
async function ensureMediaBudget(mapMaybe) {
  const map = mapMaybe || await readMediaMap();
  const cfg = await readSwConfig();
  const maxBytes = (cfg.mediaMaxCacheMB || 150) * 1024 * 1024;
  if (map.totalSize <= maxBytes) return;
  const mediaCache = await caches.open(MEDIA_CACHE);
  const items = Object.entries(map.items);
  // Сортируем по lastAccess (старые — первыми)
  items.sort((a, b) => (a[1].lastAccess || 0) - (b[1].lastAccess || 0));
  for (const [url, meta] of items) {
    try { await mediaCache.delete(url); } catch {}
    map.totalSize -= meta.size || 0;
    delete map.items[url];
    if (map.totalSize <= maxBytes) break;
  }
  await writeMediaMap(map);
}
async function maybeHeadRevalidate(url) {
  try {
    const cfg = await readSwConfig();
    const map = await readMediaMap();
    const meta = map.items[url];
    if (!meta) return;
    const days = Math.max(1, cfg.revalidateDays || 7);
    const now = Date.now();
    const due = !meta.revalidatedAt || (now - meta.revalidatedAt) > days * 24 * 60 * 60 * 1000;
    if (!due) return;

    const headReq = new Request(url, { method: 'HEAD', cache: 'no-cache' });
    const head = await fetch(headReq).catch(()=>null);
    if (!head || !(head.ok || head.status === 304)) {
      // отметим попытку, чтобы не ддосить
      meta.revalidatedAt = now;
      await writeMediaMap(map);
      return;
    }
    const etag = head.headers.get('etag');
    const lm = head.headers.get('last-modified');
    const changed = (etag && etag !== meta.etag) || (lm && lm !== meta.lastModified);
    // Обновим отметку regardless
    meta.revalidatedAt = now;
    await writeMediaMap(map);

    if (!changed) return;

    // Забираем новый full‑200 и кладём (с лимитами)
    const getRes = await fetch(new Request(url, { cache: 'reload' })).catch(()=>null);
    if (getRes && getRes.ok && getRes.status === 200 && await shouldCacheNonRangeAudio(getRes)) {
      const cache = await caches.open(MEDIA_CACHE);
      await cache.put(url, getRes.clone());
      const size = bytesFromHeader(getRes) || 0;
      await upsertMediaItem(url, {
        size,
        etag: getRes.headers.get('etag'),
        lastModified: getRes.headers.get('last-modified'),
        revalidatedAt: now
      });
    }
  } catch {}
}

self.addEventListener('message', (event) => {
  const data = event.data || {};
  if (data.type === 'OFFLINE_CACHE_ADD') {
    const resources = Array.isArray(data.resources) ? data.resources : [];
    event.waitUntil((async () => {
      await writeLastRequestedOffline(resources);
      await offlineAddResources(resources);
    })());
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
  if (data.type === 'NET_STATE' && data.state) {
    event.waitUntil(writeNetState(data.state));
  }
  if (data.type === 'CONFIG_UPDATE' && data.config) {
    event.waitUntil(writeSwConfig(data.config));
  }
  if (data.type === 'SKIP_WAITING') {
    event.waitUntil(self.skipWaiting());
  }
  if (data.type === 'GET_SW_VERSION') {
    event.waitUntil(postToAllClients({ type: 'SW_VERSION', version: SW_VERSION }));
  }
});

// One-off Background Sync: докачка офлайн-списка при появлении сети
self.addEventListener('sync', (event) => {
  if (event.tag === 'offline-favorites-cache') {
    event.waitUntil((async () => {
      try {
        const pending = await readLastRequestedOffline();
        if (pending && pending.length) {
          await offlineAddResources(pending);
        }
      } catch (e) {
        // пропускаем — sync повторится позже
      }
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
      const isAudio = /\.(mp3|m4a|aac|flac|ogg|wav)(\?|#|$)/i.test(url);

      let res = await fetch(url, { cache: 'no-cache', keepalive: true }).catch(() => null);

      if (isAudio) {
        // Для аудио: кэшируем только CORS 200 (не opaque), чтобы потом собирать 206 из полного буфера
        if (res && res.ok && res.type !== 'opaque') {
          await cache.put(url, res.clone());
        }
      } else {
        // Для не-аудио: допускаем opaque как fallback (изображения, html, json и пр.)
        if (!res || !(res.ok || res.type === 'opaque')) {
          res = await fetch(url, { mode: 'no-cors' }).catch(() => null);
        }
        if (res) {
          await cache.put(url, res.clone());
        }
      }

      done++;
      await postToAllClients({ type: 'OFFLINE_PROGRESS', percent: Math.round(done / total * 100) });
    } catch {
      done++;
      await postToAllClients({ type: 'OFFLINE_PROGRESS', percent: Math.round(done / total * 100) });
    }
  }
  await writeOfflineList([...prev, ...toCache]);
  await writeLastRequestedOffline([]); // очистим «последний запрос» — успешно собрали
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
