/* service-worker.js — v7.0.2 (для обновлённого приложения)
   Поддерживает:
   - OFFLINE режим (SET_OFFLINE_MODE / REQUEST_OFFLINE_STATE)
   - Предзагрузку списка файлов (CACHE_FILES) в офлайн‑кэш
   - Очистку офлайн‑кэша (CLEAR_CACHE)
   - Range‑запросы для аудио из кэша
   - network-first для HTML и *.json (albums.json, config.json альбомов)
   - cache-first для остального (изображения, mp3, и т.д.)
*/

const VERSION = '7.0.2';
const STATIC_CACHE = `vr-static-v${VERSION}`;
const OFFLINE_CACHE = 'album-offline-v1';

// Что кладём в статический кэш при установке SW
const STATIC_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './albums.json',
  './img/logo.png',
  './img/star.png',
  './img/star2.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png'
];

// Флаги состояния
let offlineMode = false;

// Установка SW
self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(STATIC_CACHE);
    try {
      await cache.addAll(STATIC_ASSETS);
    } catch (e) {
      // На всякий — продолжаем, даже если не всё закешировалось
    }
    self.skipWaiting();
  })());
});

// Активация SW: чистим старые кэши
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys
        .filter(k => k !== STATIC_CACHE && k !== OFFLINE_CACHE)
        .map(k => caches.delete(k))
    );
    await self.clients.claim();
    // Сообщим клиентам, что кэш обновлён
    try {
      const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      clients.forEach(c => c.postMessage({ type: 'CACHE_UPDATED', version: VERSION }));
    } catch (e) {}
  })());
});

// Основная логика fetch
self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  const accept = req.headers.get('accept') || '';

  // Обработка Range‑запросов (обычно для аудио/mp3)
  if (req.headers.get('range')) {
    event.respondWith(handleRangeRequest(req));
    return;
  }

  // Навигация / HTML → network-first
  if (req.mode === 'navigate' || accept.includes('text/html')) {
    event.respondWith(networkFirst(req));
    return;
  }

  // albums.json и любые config.json (альбомов) → network-first
  if (url.pathname.endsWith('/albums.json') || url.pathname.endsWith('/config.json')) {
    event.respondWith(networkFirst(req));
    return;
  }

  // Прочее → cache-first
  event.respondWith(cacheFirstWithBackfill(req));
});

// Стратегии
async function networkFirst(request) {
  try {
    const net = await fetch(request);
    if (net && net.ok) {
      // Обновим статический кэш для этих ресурсов
      const cache = await caches.open(STATIC_CACHE);
      cache.put(request, net.clone());
    }
    return net;
  } catch (e) {
    const cached = await caches.match(request);
    if (cached) return cached;
    return new Response('Offline', { status: 503, statusText: 'Service Unavailable' });
  }
}

async function cacheFirstWithBackfill(request) {
  // Сначала пробуем из любого кэша
  const cached = await caches.match(request);
  if (cached) return cached;

  // Если OFFLINE режим — сразу 503
  if (offlineMode) {
    return new Response('Offline - resource not cached', { status: 503, statusText: 'Service Unavailable' });
  }

  // Иначе тянем из сети и докладываем в кэш
  try {
    const net = await fetch(request);
    if (net && net.ok) {
      // В какой кэш класть? Для стабильности — в STATIC_CACHE (runtime)
      const cache = await caches.open(STATIC_CACHE);
      cache.put(request, net.clone());
    }
    return net;
  } catch (e) {
    return new Response('Network error', { status: 503, statusText: 'Service Unavailable' });
  }
}

// Range‑ответ для аудио из кэша/сети
async function handleRangeRequest(request) {
  try {
    // Сначала ищем в OFFLINE_CACHE, затем в STATIC_CACHE
    const url = request.url;
    const off = await caches.open(OFFLINE_CACHE);
    let cached = await off.match(url);
    if (!cached) {
      const stat = await caches.open(STATIC_CACHE);
      cached = await stat.match(url);
    }

    // Если нет в кэше:
    if (!cached) {
      if (offlineMode) {
        return new Response('Offline - audio not cached', { status: 503, statusText: 'Service Unavailable' });
      }
      // В онлайне просто проксируем запрос в сеть (браузер сам обработает Range)
      return fetch(request);
    }

    // Есть в кэше полный файл — режем по Range
    const rangeHeader = request.headers.get('range');
    if (!rangeHeader) return cached;

    const fullBlob = await cached.blob();
    const fullSize = fullBlob.size;

    const m = rangeHeader.match(/bytes=(\d+)-(\d*)/);
    if (!m) return cached;

    const start = parseInt(m[1], 10);
    const end = m[2] ? parseInt(m[2], 10) : fullSize - 1;

    if (isNaN(start) || start < 0 || start >= fullSize || end >= fullSize) {
      return new Response('Range Not Satisfiable', {
        status: 416,
        headers: { 'Content-Range': `bytes */${fullSize}` }
      });
    }

    const chunk = fullBlob.slice(start, end + 1);
    return new Response(chunk, {
      status: 206,
      statusText: 'Partial Content',
      headers: {
        'Content-Range': `bytes ${start}-${end}/${fullSize}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': String(end - start + 1),
        'Content-Type': cached.headers.get('Content-Type') || 'audio/mpeg'
      }
    });
  } catch (e) {
    // На ошибке — отдаём сеть (если можно)
    try { return await fetch(request); } catch { return new Response('Network error', { status: 503 }); }
  }
}

// Сообщения от клиента
self.addEventListener('message', async (event) => {
  const msg = event.data || {};
  const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  const replyAll = (data) => clients.forEach(c => c.postMessage(data));

  switch (msg.type) {
    case 'SET_OFFLINE_MODE':
      offlineMode = !!msg.value;
      replyAll({ type: 'OFFLINE_STATE', value: offlineMode });
      break;

    case 'REQUEST_OFFLINE_STATE':
      event.source && event.source.postMessage({ type: 'OFFLINE_STATE', value: offlineMode });
      break;

    case 'CACHE_FILES':
      // msg.files: список URL (абсолютные/относительные)
      await cacheFilesForOffline(Array.isArray(msg.files) ? msg.files : []);
      if (typeof msg.offlineMode === 'boolean') {
        offlineMode = msg.offlineMode;
        replyAll({ type: 'OFFLINE_STATE', value: offlineMode });
      }
      break;

    case 'CLEAR_CACHE':
      await clearOfflineCache();
      offlineMode = !!msg.offlineMode;
      replyAll({ type: 'OFFLINE_STATE', value: offlineMode });
      break;
  }
});

// Кладём список файлов в OFFLINE_CACHE
async function cacheFilesForOffline(files) {
  if (!files.length) return;
  const cache = await caches.open(OFFLINE_CACHE);
  for (const url of files) {
    try {
      // Не перекашируем, если уже лежит
      const exists = await cache.match(url);
      if (exists) continue;

      // Тянем из сети (HEAD здесь не используем — сразу GET для реального оффлайна)
      const resp = await fetch(url, { credentials: 'omit' });
      if (resp && resp.ok) {
        await cache.put(url, resp.clone());
      }
    } catch (e) {
      // Пропускаем неудачные URL
    }
  }
}

// Чистим OFFLINE_CACHE
async function clearOfflineCache() {
  try {
    await caches.delete(OFFLINE_CACHE);
  } catch (e) {
    // ignore
  }
}

console.log('[SW] Service Worker v' + VERSION + ' ready');
