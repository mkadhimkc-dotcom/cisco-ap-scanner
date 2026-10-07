/* Service worker: precaches the whole app so it opens and scans with no signal (wiring closets).
   Cache-first for same-origin GETs; nothing else is ever fetched. A new version installs in the background
   and waits until the page asks it to take over ("Update ready, reload").
   BUILD is a hash of every precached file (scripts/sw-build.mjs); a test fails if it is stale. */
const VERSION = '2.0.0';
const BUILD = 'c14abe99cd11';
const CACHE = 'label-scanner-' + VERSION + '-' + BUILD;
const PRECACHE = [
  './',
  'index.html',
  'app.js',
  'manifest.webmanifest',
  'src/camera.js',
  'src/classify.js',
  'src/csv.js',
  'src/decoder.js',
  'src/deskew.js',
  'src/device.js',
  'src/image.js',
  'src/live.js',
  'src/regions.js',
  'src/scan.js',
  'src/scanner.js',
  'src/store.js',
  'src/templates.js',
  'src/validate.js',
  'src/worker.js',
  'src/xlsx.js',
  'vendor/zxing-wasm/share.js',
  'vendor/zxing-wasm/reader/index.js',
  'vendor/zxing-wasm/reader/zxing_reader.wasm',
  'fonts/fonts.css',
  'fonts/ibm-plex-mono-latin-400-normal.woff2',
  'fonts/ibm-plex-mono-latin-500-normal.woff2',
  'fonts/ibm-plex-sans-latin-400-normal.woff2',
  'fonts/ibm-plex-sans-latin-500-normal.woff2',
  'fonts/ibm-plex-sans-latin-600-normal.woff2',
  'data/oui-cisco.json',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
  'icons/apple-touch-icon.png',
  'icons/favicon-32.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(PRECACHE.map(p => new Request(p, { cache: 'reload' })))));
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith('label-scanner-') && k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener('message', (e) => {
  if (e.data === 'skipWaiting') self.skipWaiting();
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const hit = await cache.match(req, { ignoreSearch: true }) || (req.mode === 'navigate' ? await cache.match('index.html') : null);
    if (hit) return hit;
    try { return await fetch(req); }
    catch (err) { return req.mode === 'navigate' && (await cache.match('./')) || Response.error(); }
  })());
});
