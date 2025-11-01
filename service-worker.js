/* service-worker.js — Витрина Разбита PWA
   v7.3.0: добавлен news.html в CORE, мелкие правки устойчивости
*/
const VERSION = '7.3.1';
const CORE_CACHE = `core-v${VERSION}`;
const ALBUM_CACHE = 'album-offline-v1';

/* Базовые оффлайн‑ресурсы приложения (корневые, без альбомов) */
const CORE_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './albums.json',
  './news.html',
  './img/logo.png',
  './img/star.png',
  './img/star2.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-192-maskable.png',
  './icons/icon-512-maskable.png'
];

/* Флаг принудительного cache-first режима (кнопка OFFLINE в UI) */
let offlineMode = false;

/* Утилита: безопасный fetch с таймаутом */
async function safeFetch(request, { timeout = 15000, cachePut = null } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(request, { signal: ctrl.signal });
    if (res && res.ok && cachePut) {
      try {
        const cache = await caches.open(cachePut);
        await cache.put(request, res.clone());
      } catch {}
    }
    return res;
  } finally {
    clearTimeout(timer);
  }
}

/* Широковещательное сообщение всем клиентам */
async function broadcast(msg) {
  try {
    const clients = await self.clients.matchAll({ includeUncontrolled: true, type: 'window' });
    clients.forEach(c => c.postMessage(msg));
  } catch {}
}

/* Установочный этап */
self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CORE_CACHE);
    try {
      await cache.addAll(CORE_ASSETS);
    } catch {
      // Игнорируем частичные ошибки — часть ассетов может отсутствовать в dev
    }
    await self.skipWaiting();
  })());
});

/* Активация: очистка старых кэшей core, сохранение кэша альбомов */
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(
      names
        .filter(n => n.startsWith('core-') && n !== CORE_CACHE)
        .map(n => caches.delete(n))
    );
    await self.clients.claim();
    broadcast({ type: 'OFFLINE_STATE', value: offlineMode });
  })());
});

/* Стратегия ответа на запросы */
self.addEventListener('fetch', (event) => {
  const req = event.request;

  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;

  // Навигационные запросы (страницы)
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const res = await safeFetch(req, { timeout: 8000, cachePut: CORE_CACHE });
        if (res && res.ok) return res;
        throw new Error('network failed');
      } catch {
        const cache = await caches.open(CORE_CACHE);
        const INDEX_URL = new URL('index.html', self.registration.scope).toString();
        const cached = await cache.match(INDEX_URL);
        if (cached) return cached;
        return Response.error();
      }
    })());
    return;
  }

  const isAppAsset = url.origin === self.location.origin;

  if (offlineMode) {
    // cache-first для всего
    event.respondWith((async () => {
      const cacheName = isAppAsset ? CORE_CACHE : ALBUM_CACHE;
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
    if (isAppAsset) {
      // network-first для ассетов приложения
      try {
        const res = await safeFetch(req, { timeout: 8000, cachePut: CORE_CACHE });
        if (res && res.ok) return res;
        throw new Error('net-fail');
      } catch {
        const cached = await caches.match(req, { ignoreSearch: false });
        return cached || Response.error();
      }
    } else {
      // S-W-R для внешних (аудио, лирика, обложки и т.п.)
      const cache = await caches.open(ALBUM_CACHE);
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
  })());
});

/* Команды от страницы */
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
    event.waitUntil(cacheFiles(files));
    return;
  }

  if (type === 'CLEAR_CACHE') {
    event.waitUntil((async () => {
      try {
        await caches.delete(ALBUM_CACHE);
        await caches.open(ALBUM_CACHE); // создать пустой
      } catch {}
      if (typeof data.offlineMode !== 'undefined') {
        offlineMode = !!data.offlineMode;
        broadcast({ type: 'OFFLINE_STATE', value: offlineMode });
      }
    })());
    return;
  }
});

/* Кэширование списка файлов (включая кросс‑доменные mp3/обложки/lyric json/txt) */
async function cacheFiles(urls) {
  const cache = await caches.open(ALBUM_CACHE);
  for (const raw of urls) {
    try {
      const req = new Request(raw, { mode: 'no-cors', credentials: 'omit', redirect: 'follow' });
      const res = await fetch(req);
      if (res && (res.ok || res.type === 'opaque')) {
        try { await cache.put(req, res.clone()); } catch {}
      }
    } catch {
      // пропускаем ошибки для отдельных файлов
    }
  }
}
