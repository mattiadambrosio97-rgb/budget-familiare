const CACHE_NAME = 'budget-v1';
const ASSETS = ['/', '/index.html', '/app.js', '/styles.css', '/manifest.json', '/icon.svg'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE_NAME).then(c => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  // Bypass Firebase / Google APIs - sempre rete diretta
  if (
    url.hostname.includes('googleapis.com') ||
    url.hostname.includes('firebaseio.com') ||
    url.hostname.includes('firebaseapp.com') ||
    url.hostname.includes('gstatic.com')
  ) return;

  if (e.request.method !== 'GET') return;

  e.respondWith(
    caches.match(e.request).then(cached =>
      cached || fetch(e.request).catch(() => caches.match('/index.html'))
    )
  );
});
