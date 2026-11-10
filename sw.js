// cache minima: l'app si apre anche senza rete (i dati restano in locale e si sincronizzano dopo)
const C = 'dispensa-v1.2';
const SHELL = ['./', 'index.html', 'manifest.webmanifest', 'icon-192.png',
  'https://unpkg.com/html5-qrcode@2.3.8/html5-qrcode.min.js'];
self.addEventListener('install', e => { e.waitUntil(caches.open(C).then(c => c.addAll(SHELL)).catch(()=>{})); self.skipWaiting(); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== C).map(k => caches.delete(k))))); self.clients.claim(); });
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.hostname.includes('script.google') || u.hostname.includes('openfoodfacts')) return;
  // network-first: prendi sempre l'ultima versione, cache solo come riserva offline
  e.respondWith(fetch(e.request).then(r => { const cp = r.clone(); caches.open(C).then(c => c.put(e.request, cp)); return r; })
    .catch(() => caches.match(e.request)));
});
