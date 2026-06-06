// Service Worker: network-first per i file dell'app, fallback cache se offline.
// Path relativi per funzionare sia su root che su sotto-cartelle (GitHub Pages).
const CACHE_NAME = 'budget-v7';
const ASSETS = ['./', './index.html', './app.js', './styles.css', './manifest.json', './icon.svg'];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(c => c.addAll(ASSETS)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // Bypass Firebase / Google APIs: sempre rete diretta
  if (
    url.hostname.includes('googleapis.com') ||
    url.hostname.includes('firebaseio.com') ||
    url.hostname.includes('firebasedatabase.app') ||
    url.hostname.includes('firebaseapp.com') ||
    url.hostname.includes('gstatic.com')
  ) return;

  if (e.request.method !== 'GET') return;

  // Network-first: prova rete, aggiorna cache, fallback cache offline
  e.respondWith(
    fetch(e.request)
      .then(response => {
        if (response && response.ok && response.type === 'basic') {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(c => c.put(e.request, clone)).catch(() => {});
        }
        return response;
      })
      .catch(() => caches.match(e.request).then(r => r || caches.match('./index.html')))
  );
});
