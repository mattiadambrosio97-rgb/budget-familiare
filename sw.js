// Service Worker Budget Familiare.
// - App shell (HTML/JS/CSS): network-first, fallback cache offline.
// - SDK Firebase da gstatic (versionati, immutabili): cache-first, cosi' l'app
//   parte anche offline (prima causa di "pagina bianca" senza rete).
// - Endpoint dati Firebase (database/auth/identitytoolkit): sempre rete diretta,
//   mai in cache (sono dati vivi, non asset).
// Path relativi: l'app vive in sottocartella su GitHub Pages (/budget-familiare/).
const CACHE_NAME = 'budget-v11';
const ASSETS = ['./', './index.html', './app.js', './styles.css', './manifest.json', './icon.svg', './icon-180.png', './icon-192.png', './icon-512.png'];
// SDK Firebase serviti da www.gstatic.com: URL versionati e immutabili.
const FB_SDK = [
  'https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js',
  'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth-compat.js',
  'https://www.gstatic.com/firebasejs/10.12.2/firebase-database-compat.js'
];

self.addEventListener('install', e => {
  // Precarica app shell + SDK Firebase nella cache della nuova versione, poi
  // resta "waiting" finche' la pagina non manda SKIP_WAITING (clic su "Aggiorna").
  // addAll degli asset locali e' obbligatorio (se fallisce, install fallisce);
  // gli SDK si aggiungono best-effort per non bloccare l'install se gstatic e' giu'.
  e.waitUntil(
    caches.open(CACHE_NAME).then(c =>
      c.addAll(ASSETS).then(() => c.addAll(FB_SDK).catch(() => {}))
    )
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// La pagina chiede al SW in waiting di attivarsi subito (clic su "Aggiorna").
self.addEventListener('message', e => {
  if (e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting();
});

// Host di DATI Firebase: mai in cache, sempre rete diretta. Nota: gstatic NON
// e' qui dentro, perche' gli SDK vanno serviti dalla cache quando offline.
function isFirebaseData(host) {
  return host.includes('googleapis.com') ||
         host.includes('firebaseio.com') ||
         host.includes('firebasedatabase.app') ||
         host.includes('firebaseapp.com') ||
         host.includes('identitytoolkit') ||
         host.includes('securetoken');
}

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  if (e.request.method !== 'GET') return;
  if (isFirebaseData(url.hostname)) return; // dati vivi: rete diretta

  // SDK Firebase da gstatic: cache-first (immutabili, versionati). Cosi' l'app
  // si avvia offline. Se non in cache, vai in rete e salva per la prossima volta.
  if (url.hostname.includes('gstatic.com')) {
    e.respondWith(
      caches.match(e.request).then(cached => cached || fetch(e.request).then(resp => {
        if (resp && resp.ok) {
          const clone = resp.clone();
          caches.open(CACHE_NAME).then(c => c.put(e.request, clone)).catch(() => {});
        }
        return resp;
      }).catch(() => cached))
    );
    return;
  }

  // App shell: network-first, aggiorna cache, fallback cache offline.
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
