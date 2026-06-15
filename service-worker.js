const CACHE_NAME = 'casur-maps-pwa-vf-22-3';
const CORE_ASSETS = [
  './',
  './index.html',
  './app.js',
  './styles.css',
  './manifest.json',
  './offline.html',
  './assets/logo_casur.png',
  './data/metadata.json',
  './data/metricas_lote.json',
  './icons/icon-180.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/maskable-icon-512.png',
  './icons/favicon-32.png'
];
const LARGE_ASSETS = ['./data/poligonos_casur.geojson','./historico.html'];

self.addEventListener('install', event => {
  event.waitUntil((async()=>{
    const cache = await caches.open(CACHE_NAME);
    await Promise.allSettled(CORE_ASSETS.map(a => cache.add(a)));
    // Archivos grandes: cachear sin bloquear instalación de la PWA.
    Promise.allSettled(LARGE_ASSETS.map(a => cache.add(a))).catch(()=>{});
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async()=>{
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

function isShellRequest(url){
  return url.origin === self.location.origin && (
    url.pathname.endsWith('/') ||
    url.pathname.endsWith('/index.html') ||
    url.pathname.endsWith('/app.js') ||
    url.pathname.endsWith('/styles.css') ||
    url.pathname.endsWith('/manifest.json') ||
    url.pathname.endsWith('/service-worker.js')
  );
}

self.addEventListener('fetch', event => {
  const req = event.request;
  if(req.method !== 'GET') return;
  const url = new URL(req.url);
  if(isShellRequest(url)){
    event.respondWith(fetch(req).then(resp=>{
      const copy = resp.clone();
      caches.open(CACHE_NAME).then(cache=>cache.put(req, copy)).catch(()=>{});
      return resp;
    }).catch(()=>caches.match(req).then(cached=>cached || caches.match('./offline.html'))));
    return;
  }
  event.respondWith(caches.match(req).then(cached => cached || fetch(req).then(resp => {
    const copy = resp.clone();
    caches.open(CACHE_NAME).then(cache => cache.put(req, copy)).catch(()=>{});
    return resp;
  }).catch(() => {
    if(req.mode === 'navigate') return caches.match('./offline.html');
    return cached;
  })));
});
