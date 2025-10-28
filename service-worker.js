// service-worker.js - core offline for main app
const VERSION = '7.0.0';
const CACHE_NAME = `app-static-v${VERSION}`;
const OFFLINE_CACHE = 'album-offline-v1';

const STATIC_CACHE_URLS = [
  './',
  './index.html',
  './albums.json',
  './manifest.json',
  './img/logo.png',
  './img/star.png',
  './img/star2.png'
];

let offlineMode = false;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(c => c.addAll(STATIC_CACHE_URLS)).then(()=> self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(names => Promise.all(
      names.map(n => (n!==CACHE_NAME && n!==OFFLINE_CACHE) ? caches.delete(n) : Promise.resolve())
    )).then(()=> self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  const accept = req.headers.get('accept') || '';

  // Range-запросы для аудио
  if (req.headers.get('range')) {
    event.respondWith(handleRangeRequest(req));
    return;
  }

  // HTML и config — network-first
  if (req.mode === 'navigate' || accept.includes('text/html') || url.pathname.endsWith('/config.json') || url.pathname.endsWith('albums.json')) {
    event.respondWith(networkFirst(req));
    return;
  }

  // Остальное — cache-first
  event.respondWith(
    caches.match(req).then(cached => {
      if (cached) return cached;
      if (offlineMode) return new Response('Offline - resource not cached', { status: 503, statusText: 'Service Unavailable' });

      return fetch(req).then(resp => {
        if (!resp || !resp.ok) return resp;
        const copy = resp.clone();
        const isStatic = /\.(?:png|jpg|jpeg|gif|webp|svg|mp3|json|css|js)$/i.test(url.pathname);
        caches.open(OFFLINE_CACHE).then(c => isStatic && c.put(req, copy));
        return resp;
      }).catch(()=> new Response('Network error', { status: 503, statusText: 'Service Unavailable' }));
    })
  );
});

async function networkFirst(req) {
  try {
    const net = await fetch(req);
    if (net && net.ok) {
      const copy = net.clone();
      caches.open(CACHE_NAME).then(c => c.put(req, copy));
    }
    return net;
  } catch {
    const cached = await caches.match(req);
    return cached || new Response('Offline', { status: 503, statusText: 'Service Unavailable' });
  }
}

async function handleRangeRequest(request) {
  try {
    const cache = await caches.open(offlineMode ? OFFLINE_CACHE : CACHE_NAME);
    const cached = await cache.match(request, { ignoreVary: true });
    if (!cached) {
      if (offlineMode) return new Response('Offline - audio not cached', { status: 503, statusText: 'Service Unavailable' });
      return fetch(request);
    }
    const range = request.headers.get('range');
    const full = await cached.blob();
    const size = full.size;
    const m = /bytes=(\d+)-(\d*)/.exec(range);
    if (!m) return cached;
    const start = parseInt(m[1], 10);
    const end = m[2] ? parseInt(m[2], 10) : size - 1;
    if (start >= size || end >= size) {
      return new Response('Range Not Satisfiable', { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
    }
    const chunk = full.slice(start, end + 1);
    return new Response(chunk, {
      status: 206,
      headers: {
        'Content-Range': `bytes ${start}-${end}/${size}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': (end - start + 1),
        'Content-Type': cached.headers.get('Content-Type') || 'audio/mpeg'
      }
    });
  } catch {
    return fetch(request);
  }
}

self.addEventListener('message', (event) => {
  const msg = event.data || {};
  switch (msg.type) {
    case 'SET_OFFLINE_MODE':
      offlineMode = !!msg.value;
      break;
    case 'CACHE_FILES':
      cacheFiles(msg.files, msg.offlineMode);
      break;
    case 'CLEAR_CACHE':
      clearOfflineCache(); offlineMode = false;
      break;
    case 'REQUEST_OFFLINE_STATE':
      event.source.postMessage({ type:'OFFLINE_STATE', value: offlineMode });
      break;
  }
});

async function cacheFiles(files, setAsOffline) {
  try {
    const c = await caches.open(OFFLINE_CACHE);
    await Promise.all(files.map(async f => {
      const req = new Request(f, { mode: 'no-cors' });
      const exists = await c.match(req);
      if (!exists) {
        try {
          const resp = await fetch(req);
          if (resp && (resp.ok || resp.type==='opaque')) await c.put(req, resp);
        } catch {}
      }
    }));
    if (setAsOffline) offlineMode = true;
  } catch {}
}
async function clearOfflineCache(){ try { await caches.delete(OFFLINE_CACHE); } catch {} }

console.log('[SW] v'+VERSION+' ready');

