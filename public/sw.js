// Offline shell: static files are cached, API calls always go to the network.
const CACHE = 'gf-v3';
const SHELL = ['/', '/styles.css', '/core.js', '/app.js', '/rider', '/rider.js', '/products/cow-milk-1l.svg'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL).catch(() => {}))); self.skipWaiting(); });
self.addEventListener('activate', e => e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener('fetch', e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.pathname.startsWith('/api/')) return;
  if (url.origin !== location.origin) {
    // third-party product photos: cache-first so they load fast and survive weak networks
    if (/images\.unsplash\.com/.test(url.host)) e.respondWith(caches.match(req).then(h => h || fetch(req).then(r => { const c = r.clone(); caches.open(CACHE).then(x => x.put(req, c)); return r; }).catch(() => new Response('', { status: 504 }))));
    return;
  }
  e.respondWith(fetch(req).then(r => { if (r.ok) { const c = r.clone(); caches.open(CACHE).then(x => x.put(req, c)); } return r; }).catch(() => caches.match(req).then(h => h || caches.match('/'))));
});
