/* service-worker.js
   v8.0.1 — оптимальные стратегии, offline toggle, офлайн-загрузка в album-offline-v1,
   JSON (config/index.json) — network-first c быстрым таймаутом, изображения — cache-first,
   аудио — stale-while-revalidate, навигация — fallback на index.html из core.
*/

const SW_VERSION = '8.0.1';

const CORE_CACHE    = `core-v${SW_VERSION}`;
const RUNTIME_CACHE = `runtime-v${SW_VERSION}`;
const IMAGE_CACHE   = `images-v${SW_VERSION}`;
const MEDIA_CACHE   = `media-v${SW_VERSION}`;
const OFFLINE_DL_CACHE = 'album-offline-v1'; // для офлайн-пакета (UI прогресс проверяет именно этот кэш)

let offlineMode = false;

// Базовые оффлайн-ресурсы (минимальный набор)
const CORE_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './albums.json',
  './img/logo.png',
  './img/star.png',
  './img/star2.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-192-maskable.png',
  './icons/icon-512-maskable.png'
];

// Утилита: fetch с таймаутом и опциональной записью в кэш
async function safeFetch(request, { timeout = 15000, cacheName = null, putWhen = (res) => res && res.ok } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(request, { signal: ctrl.signal });
    if (cacheName && putWhen(res)) {
      try {
        const cache = await caches.open(cacheName);
        await cache.put(request, res.clone());
      } catch {}
    }
    return res;
  } finally {
    clearTimeout(timer);
  }
}

// Рассылки в клиенты
async function broadcast(msg) {
  try {
    const clients = await self.clients.matchAll({ includeUncontrolled: true, type: 'window' });
    clients.forEach(c => c.postMessage(msg));
  } catch {}
}

// Типы ресурсов
function isJson(url)    { return /\.json(\?|#|$)/i.test(url.pathname); }
function isImage(url)   { return /\.(?:png|jpg|jpeg|webp|avif|gif|svg)(\?|#|$)/i.test(url.pathname); }
function isFont(url)    { return /\.(?:woff2?|ttf|otf)(\?|#|$)/i.test(url.pathname); }
function isAudio(url)   { return /\.(?:mp3|m4a|aac|ogg|wav|flac)(\?|#|$)/i.test(url.pathname); }
function isHtml(url)    { return /\.html(\?|#|$)/i.test(url.pathname); }

function isGalleryIndexJson(url) {
  // albums/gallery/<id>/index.json
  return /\/albums\/gallery\/[^/]+\/index\.json$/i.test(url.pathname);
}
function isAlbumConfigJson(url) {
  // config.json любых альбомов
  return /\/config\.json$/i.test(url.pathname);
}

// Установка: предкэшируем core
self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CORE_CACHE);
    try {
      await cache.addAll(CORE_ASSETS);
    } catch {
      // В dev/GitHub Pages часть ассетов может отсутствовать — игнорируем
    }
    await self.skipWaiting();
  })());
});

// Активация: чистим старые кэши
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(
      names.map((name) => {
        // удаляем прошлые версии кэшей, оставляем текущие и OFFLINE_DL_CACHE
        if (
          (name.startsWith('core-v')    && name !== CORE_CACHE) ||
          (name.startsWith('runtime-v') && name !== RUNTIME_CACHE) ||
          (name.startsWith('images-v')  && name !== IMAGE_CACHE) ||
          (name.startsWith('media-v')   && name !== MEDIA_CACHE)
        ) {
          return caches.delete(name);
        }
        return Promise.resolve(false);
      })
    );
    await self.clients.claim();
    broadcast({ type: 'OFFLINE_STATE', value: offlineMode });
  })());
});

// Стратегии:
// - NAVIGATE: network-first с fallback на index.html из CORE
// - JSON (config.json и albums/gallery/*/index.json): network-first c таймаутом 4s -> cache
// - Images/Fonts: cache-first (IMAGE_CACHE)
// - Audio: stale-while-revalidate (MEDIA_CACHE)
// - HTML баннеры внутри albums/gallery: cache-first
// - Остальное: network-first с таймаутом 8s -> runtime cache
// - В offlineMode: cache-first для всего
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;

  // Навигация
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const res = await safeFetch(req, { timeout: 8000, cacheName: CORE_CACHE });
        if (res && res.ok) return res;
        throw new Error('nav-net-fail');
      } catch {
        const cache = await caches.open(CORE_CACHE);
        const fallbackUrl = new URL('index.html', self.registration.scope).toString();
        const cached = await cache.match(fallbackUrl);
        return cached || Response.error();
      }
    })());
    return;
  }

  // OFFLINE режим — cache-first для всего
  if (offlineMode) {
    event.respondWith((async () => {
      const cacheName = isImage(url) ? IMAGE_CACHE : isAudio(url) ? MEDIA_CACHE : RUNTIME_CACHE;
      const cache = await caches.open(cacheName);
      const hit = await cache.match(req, { ignoreSearch: false });
      if (hit) return hit;
      try {
        const res = await safeFetch(req);
        if (res && (res.ok || res.type === 'opaque')) {
          try { await cache.put(req, res.clone()); } catch {}
          return res;
        }
      } catch {}
      const any = await caches.match(req, { ignoreSearch: false });
      return any || Response.error();
    })());
    return;
  }

  // Обычный режим
  event.respondWith((async () => {
    // JSON конфиги/индексы галерей — network-first с быстрым таймаутом
    if (isJson(url) && (isGalleryIndexJson(url) || isAlbumConfigJson(url))) {
      try {
        const res = await safeFetch(req, { timeout: 4000, cacheName: RUNTIME_CACHE });
        if (res && res.ok) return res;
        throw new Error('json-net-fail');
      } catch {
        const cached = await caches.match(req, { ignoreSearch: false });
        return cached || Response.error();
      }
    }

    // Картинки/шрифты — cache-first с фоновым обновлением
    if (isImage(url) || isFont(url)) {
      const cache = await caches.open(IMAGE_CACHE);
      const cached = await cache.match(req, { ignoreSearch: false });
      if (cached) {
        event.waitUntil((async () => {
          try {
            const fresh = await safeFetch(req);
            if (fresh && (fresh.ok || fresh.type === 'opaque')) {
              try { await cache.put(req, fresh.clone()); } catch {}
            }
          } catch {}
        })());
        return cached;
      }
      try {
        const res = await safeFetch(req);
        if (res && (res.ok || res.type === 'opaque')) {
          try { await cache.put(req, res.clone()); } catch {}
          return res;
        }
      } catch {}
      return Response.error();
    }

    // Аудио — stale-while-revalidate
    if (isAudio(url)) {
      const cache = await caches.open(MEDIA_CACHE);
      const cached = await cache.match(req, { ignoreSearch: false });
      const netPromise = (async () => {
        try {
          const res = await safeFetch(req);
          if (res && (res.ok || res.type === 'opaque')) {
            try { await cache.put(req, res.clone()); } catch {}
            return res;
          }
        } catch {}
        return null;
      })();
      if (cached) {
        event.waitUntil(netPromise);
        return cached;
      }
      const net = await netPromise;
      return net || Response.error();
    }

    // HTML из альбомных галерей (news баннеры) — cache-first
    if (isHtml(url) && /\/albums\/gallery\//i.test(url.pathname)) {
      const cache = await caches.open(RUNTIME_CACHE);
      const cached = await cache.match(req, { ignoreSearch: false });
      if (cached) return cached;
      try {
        const res = await safeFetch(req);
        if (res && (res.ok || res.type === 'opaque')) {
          try { await cache.put(req, res.clone()); } catch {}
          return res;
        }
      } catch {}
      return Response.error();
    }

    // Остальное — network-first
    try {
      const res = await safeFetch(req, { timeout: 8000, cacheName: RUNTIME_CACHE });
      if (res && (res.ok || res.type === 'opaque')) return res;
      throw new Error('net-fail');
    } catch {
      const cached = await caches.match(req, { ignoreSearch: false });
      return cached || Response.error();
    }
  })());
});

// Сообщения от страницы
self.addEventListener('message', (event) => {
  const data = event.data || {};
  const type = data.type;

  if (type === 'SET_OFFLINE_MODE') {
    offlineMode = !!data.value;
    broadcast({ type: 'OFFLINE_STATE', value: offlineMode });
    return;
  }

  if (type === 'REQUEST_OFFLINE_STATE') {
    broadcast({ type: 'OFFLINE_STATE', value: offlineMode });
    return;
  }

  if (type === 'CACHE_FILES') {
    const files = Array.isArray(data.files) ? data.files : [];
    event.waitUntil(cacheFilesForOffline(files));
    return;
  }

  if (type === 'CLEAR_CACHE') {
    event.waitUntil((async () => {
      try {
        // Полностью чистим динамические кэши
        await caches.delete(RUNTIME_CACHE);
        await caches.delete(IMAGE_CACHE);
        await caches.delete(MEDIA_CACHE);
        await caches.delete(OFFLINE_DL_CACHE);
        // Воссоздадим
        await caches.open(RUNTIME_CACHE);
        await caches.open(IMAGE_CACHE);
        await caches.open(MEDIA_CACHE);
        await caches.open(OFFLINE_DL_CACHE);
      } catch {}
      if (typeof data.offlineMode !== 'undefined') {
        offlineMode = !!data.offlineMode;
        broadcast({ type: 'OFFLINE_STATE', value: offlineMode });
      }
    })());
    return;
  }
});

// Кэширование набора файлов для офлайн-режима (в тот самый album-offline-v1)
async function cacheFilesForOffline(urls) {
  const offlineCache = await caches.open(OFFLINE_DL_CACHE);

  for (const raw of urls) {
    try {
      const req = new Request(raw, { mode: 'no-cors', credentials: 'omit', redirect: 'follow' });
      const res = await fetch(req);
      if (res && (res.ok || res.type === 'opaque')) {
        try {
          await offlineCache.put(req, res.clone());
        } catch {}
      }
    } catch {
      // игнорируем ошибки отдельных файлов
    }
  }
}
