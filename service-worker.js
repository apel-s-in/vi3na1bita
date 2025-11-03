/* service-worker.js
   v8.0.1 — оптимальные стратегии для новой архитектуры.
   - JSON (config/index.json): network-first с быстрым таймаутом (4s).
   - Изображения (включая WebP, thumbnails): cache-first.
   - Аудио: stale-while-revalidate.
   - Навигация (HTML): network-first с fallback на index.html.
   - В offlineMode: cache-first для всех ресурсов.
*/
const SW_VERSION = '8.0.2';
const CORE_CACHE    = `core-v${SW_VERSION}`;
const RUNTIME_CACHE = `runtime-v${SW_VERSION}`;
const IMAGE_CACHE   = `images-v${SW_VERSION}`;
const MEDIA_CACHE   = `media-v${SW_VERSION}`;
const OFFLINE_DL_CACHE = 'album-offline-v1';
let offlineMode = false;

// Основные ресурсы для быстрого старта и офлайн-режима
const CORE_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './albums.json',
  './img/logo.png',
  './img/star.png',
  './img/star2.png',
  // Иконки альбомов для быстрого отображения
  './img/icon_album/icon-album-00.png',
  './img/icon_album/icon-album-01.png',
  './img/icon_album/icon-album-02.png',
  './img/icon_album/icon-album+00.png',
  './img/icon_album/icon-album-news.png'
];

// Утилита для безопасного fetch с таймаутом
async function safeFetch(request, { timeout = 15000, cacheName = null, putWhen = (res) => res && res.ok } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(request, { signal: ctrl.signal });
    if (cacheName && putWhen(res)) {
      try {
        const cache = await caches.open(cacheName);
        await cache.put(request, res.clone());
      } catch (e) { console.warn('SW: Cache put failed', e); }
    }
    return res;
  } finally {
    clearTimeout(timer);
  }
}

// Рассылка сообщений всем открытым вкладкам
async function broadcast(msg) {
  try {
    const clients = await self.clients.matchAll({ includeUncontrolled: true, type: 'window' });
    clients.forEach(c => c.postMessage(msg));
  } catch (e) { console.warn('SW: Broadcast failed', e); }
}

// Определение типа ресурса по URL
function isNavigation(url) { return url.pathname.endsWith('/') || url.pathname.endsWith('.html'); }
function isJson(url)       { return /\.json(\?|#|$)/i.test(url.pathname); }
function isImage(url)      { return /\.(?:png|jpg|jpeg|webp|avif|gif|svg)(\?|#|$)/i.test(url.pathname); }
function isAudio(url)      { return /\.(?:mp3|m4a|aac|ogg|wav|flac)(\?|#|$)/i.test(url.pathname); }

// Установка: предкэшируем основные ресурсы
self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CORE_CACHE);
    try {
      await cache.addAll(CORE_ASSETS);
    } catch (e) {
      console.warn('SW: Core assets pre-cache failed, continuing...', e);
    }
    // Сразу активируем нового SW
    await self.skipWaiting();
  })());
});

// Активация: удаляем старые кэши
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(
      names.map((name) => {
        if (
          (name.startsWith('core-v')    && name !== CORE_CACHE) ||
          (name.startsWith('runtime-v') && name !== RUNTIME_CACHE) ||
          (name.startsWith('images-v')  && name !== IMAGE_CACHE) ||
          (name.startsWith('media-v')   && name !== MEDIA_CACHE)
        ) {
          return caches.delete(name);
        }
        return Promise.resolve();
      })
    );
    // Немедленно начинаем контролировать все вкладки
    await self.clients.claim();
    broadcast({ type: 'OFFLINE_STATE', value: offlineMode });
  })());
});

// Обработка сетевых запросов
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;

  // Стратегия для навигации
  if (isNavigation(url)) {
    event.respondWith((async () => {
      try {
        const res = await safeFetch(req, { timeout: 8000, cacheName: CORE_CACHE });
        if (res && res.ok) return res;
        throw new Error('nav-net-fail');
      } catch (e) {
        const cache = await caches.open(CORE_CACHE);
        const fallbackUrl = new URL('index.html', self.registration.scope).toString();
        const cached = await cache.match(fallbackUrl);
        return cached || new Response('Offline', { status: 503 });
      }
    })());
    return;
  }

  // Если включен офлайн-режим, используем cache-first для всего
  if (offlineMode) {
    event.respondWith((async () => {
      const cacheName = isImage(url) ? IMAGE_CACHE : isAudio(url) ? MEDIA_CACHE : RUNTIME_CACHE;
      const cache = await caches.open(cacheName);
      const hit = await cache.match(req, { ignoreSearch: false });
      if (hit) return hit;
      const any = await caches.match(req, { ignoreSearch: false });
      return any || new Response('Offline', { status: 503 });
    })());
    return;
  }

  // Обычный режим работы
  event.respondWith((async () => {
    // JSON-файлы (альбомы и галереи) - network-first
    if (isJson(url)) {
      try {
        const res = await safeFetch(req, { timeout: 4000, cacheName: RUNTIME_CACHE });
        if (res && res.ok) return res;
        throw new Error('json-net-fail');
      } catch (e) {
        const cached = await caches.match(req, { ignoreSearch: false });
        return cached || new Response('Not found', { status: 404 });
      }
    }

    // Изображения (включая WebP) - cache-first
    if (isImage(url)) {
      const cache = await caches.open(IMAGE_CACHE);
      const cached = await cache.match(req, { ignoreSearch: false });
      if (cached) {
        // Фоновое обновление кэша
        event.waitUntil((async () => {
          try {
            const fresh = await safeFetch(req);
            if (fresh && fresh.ok) {
              await cache.put(req, fresh.clone());
            }
          } catch {}
        })());
        return cached;
      }
      try {
        const res = await safeFetch(req);
        if (res && res.ok) {
          await cache.put(req, res.clone());
          return res;
        }
      } catch {}
      return new Response('Image not found', { status: 404 });
    }

    // Аудио - stale-while-revalidate
    if (isAudio(url)) {
      const cache = await caches.open(MEDIA_CACHE);
      const cached = await cache.match(req, { ignoreSearch: false });
      const networkFetch = (async () => {
        try {
          const res = await safeFetch(req);
          if (res && res.ok) {
            try { await cache.put(req, res.clone()); } catch {}
            return res;
          }
        } catch {}
        return null;
      })();
      if (cached) {
        event.waitUntil(networkFetch);
        return cached;
      }
      const networkResponse = await networkFetch;
      return networkResponse || new Response('Audio not found', { status: 404 });
    }

    // Для остальных ресурсов (JS, CSS и т.д.)
    try {
      const res = await safeFetch(req, { timeout: 8000, cacheName: RUNTIME_CACHE });
      if (res && res.ok) return res;
      throw new Error('net-fail');
    } catch (e) {
      const cached = await caches.match(req, { ignoreSearch: false });
      return cached || new Response('Resource not found', { status: 404 });
    }
  })());
});

// Обработка сообщений от основного приложения
self.addEventListener('message', (event) => {
  const data = event.data || {};
  const type = data.type;
  if (type === 'SET_OFFLINE_MODE') {
    offlineMode = !!data.value;
    broadcast({ type: 'OFFLINE_STATE', value: offlineMode });
  } else if (type === 'REQUEST_OFFLINE_STATE') {
    broadcast({ type: 'OFFLINE_STATE', value: offlineMode });
  } else if (type === 'CACHE_FILES') {
    const files = Array.isArray(data.files) ? data.files : [];
    event.waitUntil(cacheFilesForOffline(files));
  } else if (type === 'CLEAR_CACHE') {
    event.waitUntil((async () => {
      try {
        await caches.delete(RUNTIME_CACHE);
        await caches.delete(IMAGE_CACHE);
        await caches.delete(MEDIA_CACHE);
        await caches.delete(OFFLINE_DL_CACHE);
        // Воссоздаем кэши
        await caches.open(RUNTIME_CACHE);
        await caches.open(IMAGE_CACHE);
        await caches.open(MEDIA_CACHE);
        await caches.open(OFFLINE_DL_CACHE);
      } catch (e) { console.warn('SW: Cache clear failed', e); }
      if (data.offlineMode !== undefined) {
        offlineMode = !!data.offlineMode;
        broadcast({ type: 'OFFLINE_STATE', value: offlineMode });
      }
    })());
  }
});

// Функция для кэширования файлов в офлайн-режиме
async function cacheFilesForOffline(urls) {
  const offlineCache = await caches.open(OFFLINE_DL_CACHE);
  for (const raw of urls) {
    try {
      const req = new Request(raw, { mode: 'no-cors', credentials: 'omit', redirect: 'follow' });
      const res = await fetch(req);
      if (res && (res.ok || res.type === 'opaque')) {
        try {
          await offlineCache.put(req, res.clone());
        } catch (e) { console.warn('SW: Offline cache put failed', e); }
      }
    } catch (e) {
      // Игнорируем ошибки отдельных файлов
      console.warn('SW: Failed to cache for offline', raw, e);
    }
  }
}
