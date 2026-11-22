// ============================================================
// Budget Familiare - localStorage + sync Firebase Realtime DB
// (stesso progetto agenda-f3298, nodo /budget separato)
// ============================================================

const STORAGE_PREFIX = 'bf_';
const FB_PATH = '/budget';
const FB_URL = 'https://agenda-f3298-default-rtdb.europe-west1.firebasedatabase.app' + FB_PATH + '.json';
// Scritte dall'app. Le chiavi vecchie (caps, sinking, income, anchor) restano nel database
// ma l'app non le legge piu' e, col push a PATCH, non le tocca.
const SYNC_KEYS = ['movements', 'recurring'];
// Scritte solo da Claude (budget_dati.py): l'app le riceve e non le rimanda mai.
const READONLY_KEYS = ['settings', 'incomeItems', 'installments', 'taxPayments', 'scadenze', 'cassaforte'];
const PUSH_PENDING_KEY = STORAGE_PREFIX + '_pushPending';

// --- Firebase Auth (login una volta per dispositivo, sessione persistente) ---
const FIREBASE_CONFIG = {
  apiKey: 'AIzaSyAY9_Vj4qmoYtH335dKncpMIb9LSJwYMeg',
  authDomain: 'agenda-f3298.firebaseapp.com',
  databaseURL: 'https://agenda-f3298-default-rtdb.europe-west1.firebasedatabase.app',
  projectId: 'agenda-f3298',
  storageBucket: 'agenda-f3298.firebasestorage.app',
  messagingSenderId: '1064348670898',
  appId: '1:1064348670898:web:3c522b8d9db04dd348a2ab'
};
let idToken = null;

// URL con token sempre fresco. Forza refresh se >50min vecchio per evitare scadenza
// mid-flight (i token Firebase durano 60min).
async function authedUrl(forceRefresh) {
  try {
    const u = firebase.auth().currentUser;
    if (u) idToken = await u.getIdToken(!!forceRefresh);
  } catch (e) {}
  return FB_URL + (idToken ? '?auth=' + idToken : '');
}
// Versione sincrona (per flush su unload): usa l'ultimo token in cache.
function authParamSync() { return idToken ? '?auth=' + idToken : ''; }

let syncInProgress = false;
let lastPushTs = 0;        // timestamp dell'ultimo push riuscito (echo suppression)
let isOnline = navigator.onLine !== false;
let realtimeRef = null;    // riferimento Firebase per sync live

// Colori usati sia per i dot/barre sia per i badge a testo bianco: almeno 4.5:1 col bianco.
// group: 'variabile' (portafoglio, con budget), 'fissa' (portafoglio, ricorrenti),
// 'cassaforte' (pagate col portafoglio, rimborsate da Tinaba col bonifico di inizio mese).
// Uguale a CATEGORIE_APP in budget_dati.py: se cambia qui, cambia anche lì.
const CATEGORIES = [
  { id: 'spesa-casa', name: 'Spesa e casa', color: '#7c5a3a', group: 'variabile' },
  { id: 'spese-libere', name: 'Spese libere', color: '#be185d', group: 'variabile' },
  { id: 'benzina', name: 'Benzina', color: '#6d4c8a', group: 'variabile' },
  { id: 'abbonamenti', name: 'Abbonamenti', color: '#155e75', group: 'fissa' },
  { id: 'casa-gas', name: 'Bombola del gas', color: '#57534e', group: 'fissa' },
  { id: 'casa-pulizia', name: 'Signora delle pulizie', color: '#78716c', group: 'fissa' },
  { id: 'cura-personale', name: 'Cura personale', color: '#9d174d', group: 'fissa' },
  { id: 'lavoro', name: 'Lavoro', color: '#5b4a8a', group: 'fissa' },
  { id: 'salute', name: 'Salute', color: '#9f1239', group: 'cassaforte' },
  { id: 'auto', name: 'Auto', color: '#713f12', group: 'cassaforte' },
  { id: 'veterinario', name: 'Veterinario', color: '#6b21a8', group: 'cassaforte' },
  { id: 'regali-anno', name: 'Regali', color: '#a21caf', group: 'cassaforte' },
  { id: 'viaggi', name: 'Viaggi', color: '#0e7490', group: 'cassaforte' },
  { id: 'tasse', name: 'Tasse', color: '#44403c', group: 'cassaforte' },
  { id: 'rate', name: 'Rate', color: '#57534e', group: 'cassaforte' }
];
const GROUP_LABELS = { variabile: 'Portafoglio', fissa: 'Fisse del portafoglio', cassaforte: 'Cassaforte' };

// Id deterministici (r-...): due device che seminano i default non li duplicano al merge.
// Gli id non vanno piu' cambiati. Spese fisse decise con Mattia il 22/11/2026.
const DEFAULT_RECURRING = [
  { id: 'r-apple-icloud-1', name: 'Apple iCloud', amount: 9.99, category: 'abbonamenti', dayOfMonth: 5 },
  { id: 'r-apple-icloud-2', name: 'Apple iCloud (Michelle)', amount: 9.99, category: 'abbonamenti', dayOfMonth: 19 },
  { id: 'r-capcut', name: 'CapCut (tramite Apple)', amount: 11.99, category: 'abbonamenti', dayOfMonth: 20 },
  { id: 'r-apple-199', name: 'Apple 1,99', amount: 1.99, category: 'abbonamenti', dayOfMonth: 27 },
  { id: 'r-chatgpt-michelle', name: 'ChatGPT di Michelle', amount: 22.19, category: 'abbonamenti', dayOfMonth: 24 },
  { id: 'r-telecom', name: 'Telecom', amount: 10.97, category: 'abbonamenti', dayOfMonth: 17 },
  { id: 'r-iliad', name: 'Iliad', amount: 7.99, category: 'abbonamenti', dayOfMonth: 18 },
  { id: 'r-netflix', name: 'Netflix', amount: 6.99, category: 'abbonamenti', dayOfMonth: 25 },
  { id: 'r-disney', name: 'Disney+', amount: 6.99, category: 'abbonamenti', dayOfMonth: 17 },
  { id: 'r-hbo', name: 'HBO Max', amount: 5.99, category: 'abbonamenti', dayOfMonth: 11 },
  { id: 'r-signora', name: 'Signora delle pulizie', amount: 70, category: 'casa-pulizia', dayOfMonth: 1 },
  { id: 'r-bombola', name: 'Bombola del gas', amount: 45, category: 'casa-gas', dayOfMonth: 1 },
  { id: 'r-unghie-michelle', name: 'Unghie di Michelle', amount: 40, category: 'cura-personale', dayOfMonth: 1 },
  { id: 'r-barbiere', name: 'Barbiere', amount: 30, category: 'cura-personale', dayOfMonth: 1 },
  { id: 'r-fiscozen', name: 'Fiscozen', amount: 59.9, category: 'lavoro', dayOfMonth: 14 },
  { id: 'r-cloudflare', name: 'Cloudflare', amount: 4.62, category: 'lavoro', dayOfMonth: 16 },
  { id: 'r-elevenlabs', name: 'ElevenLabs', amount: 5.54, category: 'lavoro', dayOfMonth: 6 }
];

const MIN_MONTH = new Date(2026, 4, 1); // maggio 2026 (mese 4 = maggio, 0-indexed)
const MAX_MONTH_OFFSET = 12;            // navigabile fino a 12 mesi nel futuro

// ============================================================
// STATE
// ============================================================
let currentMonth = startOfMonth(new Date());
let cachedMovements = [];
let cachedRecurring = [];

// ============================================================
// STORAGE (localStorage)
// ============================================================
function lsRead(key, fallback) {
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (e) { return fallback; }
}
function lsWrite(key, value) {
  // Ritorna true se la scrittura va a buon fine, false altrimenti (quota piena, browser strano).
  // Il chiamante puo mostrare un errore all'utente.
  try {
    localStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(value));
    localStorage.setItem(STORAGE_PREFIX + '_ts', String(Date.now()));
    return true;
  } catch (e) {
    console.error('lsWrite fallito per chiave', key, e);
    return false;
  }
}

function loadMovements() { return lsRead('movements', []); }
function saveMovements(arr) {
  const ok = lsWrite('movements', arr);
  if (ok) schedulePush();
  return ok;
}
function loadRecurring() {
  let arr = lsRead('recurring', null);
  if (arr === null) {
    arr = DEFAULT_RECURRING.map(r => ({
      id: r.id,
      name: r.name,
      amount: r.amount,
      category: r.category,
      dayOfMonth: r.dayOfMonth,
      active: true,
      lastGeneratedMonth: null
    }));
    lsWrite('recurring', arr);
  }
  return arr;
}
function saveRecurring(arr) { const ok = lsWrite('recurring', arr); if (ok) schedulePush(); return ok; }

// ============================================================
// FIREBASE SYNC (Realtime DB: SDK real-time + REST per push affidabile)
// ============================================================
// Stati possibili dell'indicatore:
//   'ok'      = sincronizzato col cloud, niente in coda
//   'syncing' = push o pull in corso
//   'warn'    = offline o nessun token, dati salvati solo in locale
//   'error'   = ultima sync fallita, retry in corso con backoff
function setSyncIndicator(state, txt) {
  const el = document.getElementById('sync-indicator');
  const t = document.getElementById('sync-text');
  if (!el || !t) return;
  el.classList.remove('sync-ok', 'sync-syncing', 'sync-warn', 'sync-error');
  el.classList.add('sync-' + state);
  const labels = { ok: 'OK', syncing: '...', warn: 'OFFLINE', error: 'ERRORE' };
  t.textContent = txt || labels[state] || '';
}

function markPushPending() { try { localStorage.setItem(PUSH_PENDING_KEY, '1'); } catch (e) {} }
function clearPushPending() { try { localStorage.removeItem(PUSH_PENDING_KEY); } catch (e) {} }
function hasPushPending() { return localStorage.getItem(PUSH_PENDING_KEY) === '1'; }

function buildPayload() {
  const payload = { _ts: Date.now() };
  for (const k of SYNC_KEYS) {
    const v = lsRead(k, null);
    // Una chiave assente qui non deve cancellare quella sul server (il push e' un PATCH).
    if (v) payload[k] = JSON.stringify(v);
  }
  return payload;
}

// Unisce due liste di oggetti con campo `id`.
// Per stesso id: vince la voce con `_modTs` (timestamp di ultima modifica) piu' recente.
// Le voci presenti solo in una delle due liste vengono preservate.
// Le voci con `_deleted: true` sono tombstones: rappresentano cancellazioni
// e si propagano correttamente cosi' una cancellazione fatta su un device
// non viene annullata dal merge con un'altra copia che ancora aveva quella voce.
function mergeById(local, remote) {
  const byId = new Map();
  const considerAll = [...(local || []), ...(remote || [])];
  for (const it of considerAll) {
    if (!it || !it.id) continue;
    const existing = byId.get(it.id);
    if (!existing) { byId.set(it.id, it); continue; }
    const existingTs = existing._modTs || 0;
    const newTs = it._modTs || 0;
    if (newTs > existingTs) byId.set(it.id, it);
    else if (newTs === existingTs) {
      // Parita di timestamp: se uno e' tombstone vince la cancellazione (sicuro).
      if (it._deleted && !existing._deleted) byId.set(it.id, it);
    }
  }
  return Array.from(byId.values());
}

// Filtra le entry attive (esclude i tombstones): da usare nella UI e nei calcoli.
function activeOnly(arr) {
  return (arr || []).filter(it => it && !it._deleted);
}

// Pulizia periodica dei tombstones piu' vecchi di 60 giorni.
// Serve a non far crescere indefinitamente lo storage e Firebase.
function purgeOldTombstones() {
  const cutoff = Date.now() - 60 * 24 * 60 * 60 * 1000;
  let changed = false;
  for (const k of ['movements', 'recurring']) {
    const arr = lsRead(k, []);
    if (!Array.isArray(arr)) continue;
    const filtered = arr.filter(it => !(it && it._deleted && (it._modTs || 0) < cutoff));
    if (filtered.length !== arr.length) {
      lsWrite(k, filtered);
      changed = true;
    }
  }
  if (changed) schedulePush();
}

// True dopo l'ultimo applyRemotePayload se la fusione ha conservato dati locali
// assenti (o piu' recenti) nel remoto: in quel caso lo stato fuso va ri-pushato,
// altrimenti vivrebbe solo su questo device e il server resterebbe monco.
let lastMergeNeedsRepush = false;
function applyRemotePayload(remote) {
  lastMergeNeedsRepush = false;
  if (!remote || typeof remote !== 'object') return false;
  let applied = false;
  const MERGE_KEYS = ['movements', 'recurring'];
  for (const k of SYNC_KEYS) {
    if (remote[k]) {
      try {
        const parsed = JSON.parse(remote[k]);
        if (MERGE_KEYS.includes(k) && Array.isArray(parsed)) {
          const local = lsRead(k, []);
          const merged = mergeById(local, parsed);
          // Se la fusione ha piu' voci del remoto, il server non aveva tutto: ri-push.
          if (merged.length > parsed.length) lastMergeNeedsRepush = true;
          lsWrite(k, merged);
        } else {
          lsWrite(k, parsed);
        }
        applied = true;
      } catch (e) {}
    }
  }
  for (const k of READONLY_KEYS) {
    if (!remote[k]) continue;
    try {
      lsWrite(k, JSON.parse(remote[k]));
      applied = true;
    } catch (e) {}
  }
  return applied;
}

async function fbPull() {
  setSyncIndicator('syncing');
  try {
    const r = await fetch(await authedUrl());
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return await r.json();
  } catch (e) {
    console.warn('Pull failed:', e);
    setSyncIndicator(isOnline ? 'error' : 'warn');
    return null;
  }
}

let pushTimer = null;
let needRepush = false;
let pushBackoff = 200;     // backoff esponenziale: 200ms, 400, 800, ..., max 30s
function schedulePush(delay) {
  clearTimeout(pushTimer);
  pushTimer = setTimeout(fbPush, typeof delay === 'number' ? delay : 200);
}

async function fbPush() {
  pushTimer = null;
  if (syncInProgress) {
    // Push gia' in volo: rifaremo un giro dopo per catturare le modifiche fatte
    // nel frattempo. Senza questo flag, la seconda modifica resterebbe solo
    // in locale finche' l'utente non riapre l'app.
    needRepush = true;
    return;
  }
  if (typeof firebase === 'undefined' || !firebase.auth || !firebase.auth().currentUser) {
    // SDK assente (offline) o non autenticato: lasciamo il flag pending e
    // ritentiamo al login / al ritorno della rete. Le modifiche restano in locale.
    markPushPending();
    setSyncIndicator('warn', typeof firebase === 'undefined' ? 'OFFLINE' : 'NON LOGGATO');
    return;
  }
  syncInProgress = true;
  needRepush = false;
  markPushPending();   // garantisce retry al prossimo boot se questo fallisce
  setSyncIndicator('syncing');
  try {
    // Forza refresh del token: evita 401 silenzioso se il token in cache e' scaduto.
    const url = await authedUrl(true);
    if (!idToken) throw new Error('Nessun token disponibile');
    // Prima unisce quello che c'e' sul server: una spesa scritta da Claude un attimo
    // fa non deve sparire perche' questo telefono non l'ha ancora ricevuta.
    const rGet = await fetch(url);
    if (!rGet.ok) throw new Error('HTTP ' + rGet.status);
    const remote = await rGet.json();
    const localTs = parseInt(localStorage.getItem(STORAGE_PREFIX + '_ts') || '0', 10);
    if (remote && remote._ts > localTs && applyRemotePayload(remote)) {
      localStorage.setItem(STORAGE_PREFIX + '_ts', String(remote._ts));
      refreshAllCachesAndRender();
    }
    const payload = buildPayload();
    const r = await fetch(url, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    lastPushTs = payload._ts;
    pushBackoff = 200;       // reset backoff dopo successo
    clearPushPending();
    setSyncIndicator('ok');
  } catch (e) {
    console.warn('Push failed:', e);
    pushBackoff = Math.min(pushBackoff * 2, 30000);
    setSyncIndicator(isOnline ? 'error' : 'warn', isOnline ? 'RETRY' : 'OFFLINE');
    schedulePush(pushBackoff);
  } finally {
    syncInProgress = false;
    if (needRepush) {
      needRepush = false;
      schedulePush();
    }
  }
}

// Flush sincrono via fetch keepalive: garantisce arrivo della PUT anche se la
// pagina viene chiusa, messa in background, cambio scheda. keepalive ha limite
// 64KB per richiesta (ampio per il nostro payload).
// Se non c'e' nulla in coda (pushTimer null e nessun pending), salta: niente
// PUT inutili a ogni cambio scheda.
function flushPushSync() {
  const hasTimer = !!pushTimer;
  if (!hasTimer && !hasPushPending()) return;
  if (pushTimer) { clearTimeout(pushTimer); pushTimer = null; }
  if (typeof firebase === 'undefined' || !firebase.auth || !firebase.auth().currentUser) return; // lo riprenderemo al prossimo login
  markPushPending();
  try {
    const payload = JSON.stringify(buildPayload());
    fetch(FB_URL + authParamSync(), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: payload,
      keepalive: true
    }).then(r => { if (r && r.ok) clearPushPending(); }).catch(() => {});
  } catch (e) {}
}

async function initialSync() {
  const remote = await fbPull();
  const localTs = parseInt(localStorage.getItem(STORAGE_PREFIX + '_ts') || '0', 10);
  if (remote && remote._ts && remote._ts > localTs) {
    const applied = applyRemotePayload(remote);
    if (applied) {
      localStorage.setItem(STORAGE_PREFIX + '_ts', String(Math.max(localTs, remote._ts)));
      // Propaghiamo lo stato fuso: protegge le spese locali appena unite,
      // altrimenti vivrebbero solo sul dispositivo.
      schedulePush();
    }
  } else if (localTs > 0 || hasPushPending()) {
    schedulePush();
  }
  setSyncIndicator(remote ? 'ok' : (isOnline ? 'error' : 'warn'));
}

// Sync real-time: ogni cambio cloud arriva entro 1-2 secondi su tutti i device.
// Sostituisce il vecchio modello "pull solo al boot" che lasciava i device
// disallineati finche' non si riapriva l'app.
function setupRealtimeSync() {
  if (typeof firebase === 'undefined' || !firebase.database) return;
  try {
    const db = firebase.database();
    realtimeRef = db.ref(FB_PATH);
    realtimeRef.on('value', snap => {
      const data = snap.val();
      if (!data || typeof data !== 'object') return;
      // Echo suppression: se l'update e' il nostro stesso push appena fatto,
      // ignoriamo per evitare rerender inutile.
      if (data._ts && lastPushTs && data._ts === lastPushTs) return;
      const localTs = parseInt(localStorage.getItem(STORAGE_PREFIX + '_ts') || '0', 10);
      if (!data._ts || data._ts <= localTs) return;
      const applied = applyRemotePayload(data);
      if (applied) {
        localStorage.setItem(STORAGE_PREFIX + '_ts', String(data._ts));
        // Se il merge ha conservato dati locali assenti dal remoto, ri-pusha lo
        // stato fuso: senza questo il server resterebbe monco finche' l'utente
        // non rifa una modifica qualsiasi (bug B3 dell'audit).
        if (lastMergeNeedsRepush) schedulePush();
        refreshAllCachesAndRender();
        setSyncIndicator('ok');
      }
    }, err => {
      console.warn('Realtime listener error:', err);
      setSyncIndicator('error');
    });
    // Indicatore online/offline reale (Firebase sa se siamo connessi).
    db.ref('.info/connected').on('value', s => {
      isOnline = s.val() === true;
      if (!isOnline) setSyncIndicator('warn');
      else if (!syncInProgress) setSyncIndicator(hasPushPending() ? 'syncing' : 'ok');
      // Quando torniamo online, ritenta i push in coda.
      if (isOnline && hasPushPending()) schedulePush();
    });
  } catch (e) {
    console.warn('Realtime sync setup failed', e);
  }
}

// Esegue il render di tutte le viste. Separato cosi' da poterlo rimandare.
function doRenderAll() {
  if (!document.getElementById('hero-residuo')) return; // app-container ancora hidden
  try { renderMonth(); } catch (e) { console.error(e); }
  try { renderMovements(); } catch (e) { console.error(e); }
  try { renderRecurring(); } catch (e) { console.error(e); }
  try { renderComeFunziona(); } catch (e) { console.error(e); }
}

// Se l'utente sta scrivendo in un campo (es. i tetti, salvati solo col bottone),
// un render distruttivo da sync remoto perderebbe il valore digitato e il focus.
// Rimandiamo il render al focusout (bug B8 dell'audit). I dati sono gia' in
// localStorage: il render rimandato e' solo cosmetico, non si perde nulla.
let pendingRender = false;
function safeRender() {
  const ae = document.activeElement;
  if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'SELECT')) { pendingRender = true; return; }
  doRenderAll();
}

// Rerender completo: usato quando il sync real-time porta dati nuovi.
function refreshAllCachesAndRender() {
  cachedRecurring = activeOnly(loadRecurring());
  cachedMovements = filterMovementsByMonth(currentMonth);
  safeRender();
}

function bindUnloadFlush() {
  // Quando l'app va in background o si chiude, forziamo il flush del push pendente.
  // Indispensabile su mobile: cambio scheda / app in background / chiusura tab
  // possono interrompere un setTimeout in volo. keepalive garantisce arrivo.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') { flushPushSync(); return; }
    // Tornati in primo piano: se nel frattempo e' cambiato il mese (PWA tenuta
    // aperta a cavallo della mezzanotte del 1), rigenera le ricorrenti e riallinea
    // la vista al mese corrente (bug B6 dell'audit).
    try {
      cachedMovements = filterMovementsByMonth(currentMonth);
      if (document.getElementById('hero-residuo')) { try { renderMonth(); } catch (e) {} try { renderMovements(); } catch (e) {} }
    } catch (e) {}
  });
  // Render rimandato (safeRender): lo scarichiamo quando l'utente lascia il campo.
  document.addEventListener('focusout', () => {
    if (pendingRender) { pendingRender = false; setTimeout(doRenderAll, 120); }
  });
  window.addEventListener('pagehide', flushPushSync);
  window.addEventListener('beforeunload', flushPushSync);
  // Online/offline browser (complementare a .info/connected di Firebase).
  window.addEventListener('online', () => {
    isOnline = true;
    if (hasPushPending()) schedulePush();
  });
  window.addEventListener('offline', () => {
    isOnline = false;
    setSyncIndicator('warn');
  });
}

// ============================================================
// HELPERS
// ============================================================
function fmtEUR(n) {
  return (n || 0).toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: 'always' });
}
function startOfMonth(d) {
  const x = new Date(d);
  x.setDate(1);
  x.setHours(0, 0, 0, 0);
  return x;
}
function monthKey(d) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
}
function monthLabel(d) {
  return d.toLocaleDateString('it-IT', { month: 'long', year: 'numeric' });
}
function todayISO() {
  const now = new Date();
  return now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');
}
function dateFromISO(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d, 12, 0, 0);
}
function getCategory(id) { return CATEGORIES.find(c => c.id === id); }
function escapeHtml(s) {
  if (!s) return '';
  return String(s).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}
function uuid() {
  return (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : ('id-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8));
}
function showToast(msg, isError) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'toast ' + (isError ? 'toast-error' : 'toast-ok') + ' toast-visible';
  setTimeout(() => t.classList.remove('toast-visible'), 2500);
}

// Migrazione al sistema portafoglio + cassaforte (22/11/2026). Gira una volta per versione;
// ogni voce toccata riceve _modTs nuovo, cosi' il merge fa vincere la versione migrata.
const MIGRATION_VERSION = 'v5-2026-11-22';
const CATEGORIE_VECCHIE = {
  'animali': 'spesa-casa',
  'sfizi': 'spese-libere',
  'abbigliamento': 'spese-libere',
  'palestra-vitamine': 'spese-libere',
  'vacanze': 'viaggi',
  'regali': 'regali-anno'
};
const MESE_AVVIO_MIGRAZIONE = '2026-11';
function migrateCategories() {
  if (localStorage.getItem(STORAGE_PREFIX + '_migration') === MIGRATION_VERSION) return;
  const migTs = Date.now();
  let touched = false;
  const movs = loadMovements();
  for (const m of movs) {
    if (!m) continue;
    if (CATEGORIE_VECCHIE[m.category]) {
      m.category = CATEGORIE_VECCHIE[m.category];
      m._modTs = migTs;
      touched = true;
    }
    // Le fisse generate in automatico dalle vecchie ricorrenti, dal mese di avvio in poi,
    // non sono spese vere: con il sistema nuovo le fisse sono previste finche' non arrivano.
    if (m.isRecurring && !m._deleted) {
      const d = new Date(m.date);
      const mk = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
      if (mk >= MESE_AVVIO_MIGRAZIONE) { m._deleted = true; m._modTs = migTs; touched = true; }
    }
  }
  if (touched) lsWrite('movements', movs);

  // Ricorrenti: le vecchie diventano tombstone, le nuove (id r-...) si aggiungono se mancano.
  const recs = lsRead('recurring', []);
  const nuoviId = new Set(DEFAULT_RECURRING.map(r => r.id));
  let touchedR = false;
  for (const r of recs) {
    if (r && !r._deleted && !nuoviId.has(r.id)) { r._deleted = true; r._modTs = migTs; touchedR = true; }
  }
  const presenti = new Set(recs.map(r => r && r.id));
  for (const d of DEFAULT_RECURRING) {
    if (!presenti.has(d.id)) { recs.push(Object.assign({ active: true }, d, { _modTs: migTs })); touchedR = true; }
  }
  if (touchedR) lsWrite('recurring', recs);
  if (touched || touchedR) schedulePush();
  localStorage.setItem(STORAGE_PREFIX + '_migration', MIGRATION_VERSION);
}

function filterMovementsByMonth(month) {
  const start = +new Date(month);
  const end = +new Date(new Date(month).setMonth(month.getMonth() + 1));
  return activeOnly(loadMovements())
    .filter(m => { const t = +new Date(m.date); return t >= start && t < end; })
    .sort((a, b) => +new Date(b.date) - +new Date(a.date));
}

// ============================================================
// AGGIUNGI
// ============================================================
function openAddModal() {
  document.getElementById('add-modal').classList.remove('hidden');
  document.getElementById('add-date').value = todayISO();
  setTimeout(() => document.getElementById('add-amount').focus(), 100);
}
function closeAddModal() {
  document.getElementById('add-modal').classList.add('hidden');
  document.getElementById('add-form').reset();
}

function bindAdd() {
  document.getElementById('top-add-btn').addEventListener('click', openAddModal);
  document.getElementById('cancel-add').addEventListener('click', closeAddModal);

  document.getElementById('add-form').addEventListener('submit', function (e) {
    e.preventDefault();
    const dateStr = document.getElementById('add-date').value;
    const amount = parseFloat(document.getElementById('add-amount').value);
    const category = document.getElementById('add-category').value;
    const note = document.getElementById('add-note').value.trim();
    if (!dateStr || !category) { showToast('Inserisci la data e scegli una categoria.', true); return; }
    if (!(amount > 0)) { showToast('Inserisci un importo maggiore di zero.', true); return; }
    const movs = loadMovements();
    movs.push({
      id: uuid(),
      date: dateFromISO(dateStr).toISOString(),
      amount: amount,
      category: category,
      note: note,
      isRecurring: false,
      _modTs: Date.now()
    });
    const ok = saveMovements(movs);
    if (!ok) {
      showToast('Spesa non salvata. Riprova.', true);
      return;
    }
    closeAddModal();
    cachedMovements = filterMovementsByMonth(currentMonth);
    renderMonth();
    renderMovements();
    showToast('Spesa salvata');
  });
}

// ============================================================
// SPLIT
// ============================================================
function bindSplit() {
  const splitModal = document.getElementById('split-modal');
  const splitRowsContainer = document.getElementById('split-rows');
  const splitHeader = document.getElementById('split-header');

  document.getElementById('open-split-btn').addEventListener('click', function () {
    const date = document.getElementById('add-date').value || todayISO();
    const note = document.getElementById('add-note').value.trim();
    splitHeader.innerHTML = '<div><strong>Data:</strong> ' + escapeHtml(date) + '</div>' +
      '<div><strong>Nota:</strong> ' + (note ? escapeHtml(note) : '<em>nessuna</em>') + '</div>';
    splitRowsContainer.innerHTML = '';
    addSplitRow(); addSplitRow();
    updateSplitTotal();
    splitModal.classList.remove('hidden');
  });

  document.getElementById('cancel-split').addEventListener('click', function () {
    splitModal.classList.add('hidden');
  });

  document.getElementById('add-split-row').addEventListener('click', function () {
    if (splitRowsContainer.children.length >= 5) return;
    addSplitRow();
  });

  function addSplitRow() {
    const row = document.createElement('div');
    row.className = 'split-row';
    row.innerHTML = '<input type="number" step="0.01" min="0" placeholder="&euro;" class="split-amount" inputmode="decimal" />' +
      '<select class="split-category"><option value="">Categoria</option>' +
      CATEGORIES.map(c => '<option value="' + c.id + '">' + c.name + '</option>').join('') +
      '</select>' +
      '<button type="button" class="btn-small btn-danger split-remove" aria-label="Rimuovi">&times;</button>';
    splitRowsContainer.appendChild(row);
    row.querySelector('.split-amount').addEventListener('input', updateSplitTotal);
    row.querySelector('.split-remove').addEventListener('click', function () {
      if (splitRowsContainer.children.length > 1) { row.remove(); updateSplitTotal(); }
    });
  }

  function updateSplitTotal() {
    let tot = 0;
    splitRowsContainer.querySelectorAll('.split-amount').forEach(i => tot += parseFloat(i.value) || 0);
    document.getElementById('split-total-amount').textContent = fmtEUR(tot);
  }

  document.getElementById('save-split').addEventListener('click', function () {
    const dateStr = document.getElementById('add-date').value || todayISO();
    const note = document.getElementById('add-note').value.trim();
    const rows = Array.from(splitRowsContainer.querySelectorAll('.split-row'));
    const data = rows.map(r => ({
      amount: parseFloat(r.querySelector('.split-amount').value) || 0,
      category: r.querySelector('.split-category').value
    })).filter(d => d.amount > 0 && d.category);
    if (data.length === 0) { showToast('Aggiungi almeno una riga con importo e categoria.', true); return; }
    const splitGroupId = uuid();
    const movs = loadMovements();
    const nowTs = Date.now();
    for (const row of data) {
      movs.push({
        id: uuid(),
        date: dateFromISO(dateStr).toISOString(),
        amount: row.amount,
        category: row.category,
        note: note ? note + ' (split)' : 'split',
        isRecurring: false,
        splitGroupId: splitGroupId,
        _modTs: nowTs
      });
    }
    const ok = saveMovements(movs);
    if (!ok) {
      showToast('Suddivisione non salvata. Riprova.', true);
      return;
    }
    splitModal.classList.add('hidden');
    closeAddModal();
    cachedMovements = filterMovementsByMonth(currentMonth);
    renderMonth();
    renderMovements();
    showToast('Suddivisione salvata (' + data.length + ' righe)');
  });
}

// ============================================================
// MESE
// ============================================================
function bindMonthNav() {
  document.getElementById('prev-month').addEventListener('click', function () {
    const candidate = new Date(currentMonth);
    candidate.setMonth(candidate.getMonth() - 1);
    if (candidate < MIN_MONTH) return;
    currentMonth = candidate;
    cachedMovements = filterMovementsByMonth(currentMonth);
    renderMonth(); renderMovements();
  });
  document.getElementById('next-month').addEventListener('click', function () {
    const candidate = new Date(currentMonth);
    candidate.setMonth(candidate.getMonth() + 1);
    const maxAllowed = new Date();
    maxAllowed.setMonth(maxAllowed.getMonth() + MAX_MONTH_OFFSET);
    if (candidate > maxAllowed) return;
    currentMonth = candidate;
    cachedMovements = filterMovementsByMonth(currentMonth);
    renderMonth(); renderMovements();
  });
}

function updateMonthNavState() {
  const prev = new Date(currentMonth);
  prev.setMonth(prev.getMonth() - 1);
  const prevBtn = document.getElementById('prev-month');
  if (prev < MIN_MONTH) {
    prevBtn.classList.add('disabled');
    prevBtn.setAttribute('aria-disabled', 'true');
  } else {
    prevBtn.classList.remove('disabled');
    prevBtn.removeAttribute('aria-disabled');
  }
  // Stesso trattamento per il bottone "mese successivo" al limite +12 mesi
  // (prima restava attivo ma muto, bug U10 dell'audit).
  const next = new Date(currentMonth);
  next.setMonth(next.getMonth() + 1);
  const maxAllowed = new Date();
  maxAllowed.setMonth(maxAllowed.getMonth() + MAX_MONTH_OFFSET);
  const nextBtn = document.getElementById('next-month');
  if (next > maxAllowed) {
    nextBtn.classList.add('disabled');
    nextBtn.setAttribute('aria-disabled', 'true');
  } else {
    nextBtn.classList.remove('disabled');
    nextBtn.removeAttribute('aria-disabled');
  }
}

// Aggiorna le viste legate al mese scelto (movimenti, diagnosi) e la schermata principale.
function renderMonth() {
  document.getElementById('month-label').textContent = monthLabel(currentMonth);
  updateMonthNavState();
  renderHome();
  renderDiagnosi();
}

// ============================================================
// SCHERMATA PRINCIPALE: numeri da calcoli.js
// ============================================================
function datiCalcolo() {
  return {
    movements: loadMovements(),
    recurring: loadRecurring(),
    incomeItems: lsRead('incomeItems', []),
    taxPayments: lsRead('taxPayments', []),
    scadenze: lsRead('scadenze', []),
    cassaforte: lsRead('cassaforte', null),
    settings: lsRead('settings', {}),
    categories: CATEGORIES
  };
}

function fmtGiorno(key) {
  if (!key) return '';
  const [y, m, d] = key.split('-');
  return d + '/' + m + '/' + y;
}
function euro(n) { return (n < 0 ? '-' : '') + fmtEUR(Math.abs(n)) + ' €'; }
function conSegno(n) { return (n >= 0 ? '+' : '-') + fmtEUR(Math.abs(n)) + ' €'; }

function rigaSoldi(etichetta, valore, classe) {
  return '<div class="quadro-row' + (classe ? ' ' + classe : '') + '"><span>' + escapeHtml(etichetta) + '</span><strong>' + escapeHtml(valore) + '</strong></div>';
}
function riquadro(titolo, corpo) {
  return '<div class="quadro-box"><div class="quadro-title">' + escapeHtml(titolo) + '</div>' + corpo + '</div>';
}
function righe(list) { return '<div class="quadro-rows">' + list.join('') + '</div>'; }

function barra(id, speso, budget) {
  const c = getCategory(id) || { name: id, color: '#78716c' };
  const pct = budget > 0 ? Math.min(speso / budget * 100, 100) : 0;
  const stato = budget > 0 && speso >= budget ? 'cat-over' : (budget > 0 && speso >= budget * 0.8 ? 'cat-warn' : '');
  return '<div class="cat-row ' + stato + '">' +
    '<div class="cat-row-head">' +
    '<span class="cat-dot" style="background:' + c.color + '"></span>' +
    '<span class="cat-name">' + escapeHtml(c.name) + '</span>' +
    '<span class="cat-amount">' + fmtEUR(speso) + ' € / ' + fmtEUR(budget) + ' €</span>' +
    '</div>' +
    '<div class="cat-bar"><div class="cat-bar-fill ' + (stato === 'cat-over' ? 'bar-over' : stato === 'cat-warn' ? 'bar-giallo' : 'bar-ok') + '" style="width:' + pct + '%"></div></div>' +
    '<div class="cat-stato ' + (stato === 'cat-over' ? 'st-over">Superato' : stato === 'cat-warn' ? 'st-giallo">Quasi al limite' : 'st-ok">In linea') + '</div>' +
    '</div>';
}

function rigaScadenza(s) {
  const quando = s.date ? fmtGiorno(s.date) : 'da pagare';
  const nota = s.finanziata ? ' · già su Fineco' : (s.daRiserva ? ' · dalla riserva' : '');
  const giorni = s.date ? Math.round((dateFromISO(s.date) - new Date(new Date().toDateString())) / 86400000) : null;
  const classe = s.scaduta || !s.date ? 'riga-negativa' : (giorni <= 10 ? 'riga-vicina' : '');
  return rigaSoldi(s.name + ' (' + quando + nota + ')', fmtEUR(s.amount) + ' €', classe);
}

function htmlCassaforte(c) {
  if (!c) return '<p class="money-hint">Manda a Claude il saldo di Tinaba: l’app lo usa per calcolare la parte libera della cassaforte.</p>';
  const r = [rigaSoldi('Saldo', euro(c.saldo))];
  r.push(rigaSoldi('− Riserva per l’imposta', fmtEUR(Math.max(c.riservaImposta - c.riservaFinanziata, 0)) + ' €', 'neg'));
  r.push(rigaSoldi('− Scadenze dei prossimi 12 mesi', fmtEUR(c.scadenzeDestinate) + ' €', 'neg'));
  r.push(rigaSoldi('− Fondo emergenze (non si tocca)', fmtEUR(c.risparmio) + ' €', 'neg'));
  r.push(c.libero >= 0
    ? rigaSoldi('= Libero', euro(c.libero), 'quadro-margin quadro-good')
    : rigaSoldi('= Da coprire con le prossime entrate', fmtEUR(-c.libero) + ' €', 'quadro-margin quadro-arancio'));
  let nota = 'Saldo di Tinaba dichiarato il ' + fmtGiorno(c.dataSaldo) + '.';
  if (c.libero < 0) nota += ' Le scadenze dei prossimi 12 mesi superano quello che c’è oltre il fondo: le pagano le entrate dei prossimi mesi, che passano qui col bonifico di inizio mese.';
  const r0 = (lsRead('settings', {}).risparmio || {});
  if (r0.mensile) nota += ' Il fondo emergenze cresce di ' + fmtEUR(r0.mensile) + ' € al mese.';
  if (c.entrateDaSistemare || c.speseDaSistemare) {
    const parti = [];
    if (c.entrateDaSistemare) parti.push('+' + fmtEUR(c.entrateDaSistemare) + ' € di entrate');
    if (c.speseDaSistemare) parti.push('−' + fmtEUR(c.speseDaSistemare) + ' € di spese');
    nota += ' Comprende ' + parti.join(' e ') + ' che passano col prossimo bonifico.';
  }
  return righe(r) + '<p class="money-hint">' + escapeHtml(nota) + '</p>';
}

// ============================================================
// PATRIMONIO: fotografie dei saldi (settings.patrimonio.storico), una per volta che Claude le registra
// ============================================================
const MESI_BREVI = ['gen', 'feb', 'mar', 'apr', 'mag', 'giu', 'lug', 'ago', 'set', 'ott', 'nov', 'dic'];
function totalePatrimonio(f) { return (+f.fineco || 0) + (+f.contanti || 0) + (+f.busta || 0) + (+f.tinaba || 0) + (+f.azioni || 0); }

function graficoPatrimonio(mesi) {
  // Due linee: i soldi che hai (continua) e il totale con i crediti netti (tratteggiata).
  // Conta la variazione da un mese all'altro, quindi l'asse parte vicino al minimo.
  const W = 600, H = 200, top = 34, base = 160, sx = 28, n = mesi.length;
  const vals = mesi.map(m => m.totale).concat(mesi.map(m => m.conCrediti));
  const minV = Math.min(...vals), maxV = Math.max(...vals);
  const pad = Math.max((maxV - minV) * 0.15, 100);
  const lo = minV - pad, hi = maxV + pad;
  const passo = n > 1 ? (W - 2 * sx) / (n - 1) : 0;
  const X = i => n > 1 ? sx + passo * i : W / 2;
  const Y = v => base - (v - lo) / (hi - lo) * (base - top);
  const linea = (chiave, classe) => n > 1 ? '<path class="' + classe + '" d="' + mesi.map((m, i) => (i ? 'L' : 'M') + X(i).toFixed(1) + ' ' + Y(m[chiave]).toFixed(1)).join('') + '"/>' : '';
  const larg = n > 1 ? passo : W;
  const anchor = n === 1 ? 'middle' : 'end';
  const punti = mesi.map((m, i) => {
    const ultimo = i === n - 1;
    const diff = i ? m.totale - mesi[i - 1].totale : null;
    const testo = m.etichetta + ': hai ' + fmtEUR(m.totale) + ' €' + (diff === null ? '' : ' (' + conSegno(diff) + ' sul mese prima)') +
      '; con i crediti ' + fmtEUR(m.conCrediti) + ' €';
    const mostraMese = n <= 6 || i % 2 === (n - 1) % 2;
    return '<g class="pat-punto' + (ultimo ? ' pat-ultimo' : '') + '" tabindex="0" aria-label="' + escapeHtml(testo) + '">' +
      '<title>' + escapeHtml(testo) + '</title>' +
      '<rect x="' + (X(i) - larg / 2) + '" y="0" width="' + larg + '" height="' + H + '" fill="transparent"/>' +
      '<circle class="pat-c2" cx="' + X(i) + '" cy="' + Y(m.conCrediti) + '" r="4"/>' +
      '<circle cx="' + X(i) + '" cy="' + Y(m.totale) + '" r="' + (ultimo ? 6 : 4.5) + '"/>' +
      (ultimo ? '<text class="pat-val" x="' + X(i) + '" y="' + (Y(m.conCrediti) - 12) + '" text-anchor="' + anchor + '">' + escapeHtml(fmtEUR(Math.round(m.conCrediti)) + ' €') + '</text>' +
        '<text class="pat-val" x="' + X(i) + '" y="' + (Y(m.totale) + 26) + '" text-anchor="' + anchor + '">' + escapeHtml(fmtEUR(Math.round(m.totale)) + ' €') + '</text>' : '') +
      (mostraMese ? '<text class="pat-mese" x="' + X(i) + '" y="' + (base + 30) + '" text-anchor="middle">' + escapeHtml(m.breve) + '</text>' : '') +
      '</g>';
  }).join('');
  return '<svg class="pat-grafico" viewBox="0 0 ' + W + ' ' + (H + 10) + '" role="img" aria-label="Patrimonio mese per mese, con e senza crediti">' +
    '<line class="pat-asse" x1="0" x2="' + W + '" y1="' + (base + 12) + '" y2="' + (base + 12) + '"/>' +
    linea('conCrediti', 'pat-linea pat-linea2') + linea('totale', 'pat-linea') + punti + '</svg>' +
    '<div class="pat-legenda"><span><i class="pat-l1"></i>Soldi che hai</span><span><i class="pat-l2"></i>Con i crediti netti</span></div>';
}

function htmlPatrimonio() {
  const dati = datiCalcolo();
  const st = (((dati.settings || {}).patrimonio || {}).storico || []).filter(f => f && f.data).slice().sort((a, b) => a.data.localeCompare(b.data));
  if (!st.length) return '';
  const f = st[st.length - 1];
  const tot = totalePatrimonio(f);
  const oggi = todayISO();
  const cr = BudgetCalcoli.crediti(dati, oggi);
  const crNetto = cr.filter(c => !c.aParte).reduce((a, c) => a + c.netto, 0);
  const aParte = cr.filter(c => c.aParte && c.lordo > 0);
  // Liquidità: quello che puoi usare subito, senza fondo emergenze, azioni e crediti.
  const qq = BudgetCalcoli.quadro(dati, new Date());
  const fondo = qq.cassaforte ? qq.cassaforte.risparmio : 0;
  const liquidita = (+f.fineco || 0) + (+f.contanti || 0) + Math.max((+f.tinaba || 0) - fondo, 0);
  const testa = '<div class="pat-liquidita"><span>Liquidità</span><strong>' + escapeHtml(fmtEUR(liquidita) + ' €') + '</strong>' +
    '<p>Conto Fineco, contanti e Tinaba oltre il fondo emergenze, al ' + escapeHtml(fmtGiorno(f.data)) + '. Fuori: fondo, azioni, crediti e la busta dei tuoi sfizi.</p></div>';
  const r = [
    rigaSoldi('Conto Fineco', fmtEUR(+f.fineco || 0) + ' €'),
    rigaSoldi('Contanti', fmtEUR(+f.contanti || 0) + ' €'),
    rigaSoldi('Busta dei tuoi sfizi', fmtEUR(+f.busta || 0) + ' €'),
    rigaSoldi('Conto Tinaba (cassaforte e fondo emergenze)', fmtEUR(+f.tinaba || 0) + ' €'),
    rigaSoldi('Azioni Fineco', fmtEUR(+f.azioni || 0) + ' €'),
    rigaSoldi('= Soldi che hai', fmtEUR(tot) + ' €', 'quadro-margin')
  ];
  if (cr.length) {
    r.push(rigaSoldi('+ Crediti netti (dettaglio in «Chi ti deve soldi»)', fmtEUR(crNetto) + ' €', 'riga-credito'));
    r.push(rigaSoldi('= Patrimonio con i crediti', fmtEUR(tot + crNetto) + ' €', 'quadro-margin quadro-totale'));
  }
  for (const c of aParte) r.push(rigaSoldi('A parte, data incerta: ' + c.nome, fmtEUR(c.netto) + ' €', 'riga-aparte'));
  // Un punto per mese: l'ultima fotografia di ogni mese, al massimo gli ultimi 12.
  const perMese = {};
  for (const x of st) perMese[x.data.slice(0, 7)] = x;
  const mesi = Object.keys(perMese).sort().slice(-12).map(k => {
    const [y, m] = k.split('-').map(Number);
    const foto = perMese[k];
    const t = totalePatrimonio(foto);
    const c = BudgetCalcoli.crediti(dati, foto.data).filter(x => !x.aParte).reduce((a, x) => a + x.netto, 0);
    return { k, totale: t, conCrediti: t + c, breve: MESI_BREVI[m - 1] + ' ' + String(y).slice(2), etichetta: MESI_BREVI[m - 1] + ' ' + y };
  });
  let confronto = '';
  if (mesi.length >= 2) {
    const d = mesi[mesi.length - 1].totale - mesi[mesi.length - 2].totale;
    confronto = '<p class="pat-confronto ' + (d >= 0 ? 'st-ok' : 'st-over') + '">' + (d >= 0 ? 'In crescita: ' : 'In calo: ') + conSegno(d) + ' di soldi che hai rispetto al mese prima</p>';
  }
  const nota = 'Saldi del ' + fmtGiorno(f.data) + '. ' +
    (mesi.length < 2 ? 'Il grafico mese per mese compare dal secondo mese: ogni primo del mese Claude aggiunge un punto quando gli mandi i saldi. ' : '') +
    'I soldi di Michelle restano fuori.';
  return riquadro('Patrimonio', testa + righe(r) + confronto + (mesi.length >= 2 ? graficoPatrimonio(mesi) : '') + '<p class="money-hint">' + escapeHtml(nota) + '</p>');
}

// ============================================================
// CHI TI DEVE SOLDI: ogni credito con il suo conto (mesi maturati, extra, pagato, prossimo)
// ============================================================
const MESI_LUNGHI = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'];
function nomeMese(k, conAnno) { const [y, m] = k.split('-').map(Number); return MESI_LUNGHI[m - 1] + (conAnno ? ' ' + y : ''); }

function htmlCrediti() {
  const dati = datiCalcolo();
  const cr = BudgetCalcoli.crediti(dati, todayISO());
  if (!cr.length) return '';
  const blocchi = cr.map(c => {
    const r = [];
    if (c.mesi) {
      const periodo = c.mesi === 1 ? nomeMese(c.dal, true) : nomeMese(c.dal, c.dal.slice(0, 4) !== c.finoA.slice(0, 4)) + '–' + nomeMese(c.finoA, true);
      r.push(rigaSoldi((c.perche || 'Maturato') + ', ' + periodo + ': ' + c.mesi + ' × ' + fmtEUR(c.lordoMensile) + ' €', fmtEUR(c.mesi * c.lordoMensile) + ' €'));
    }
    if (c.extra) r.push(rigaSoldi('+ ' + (c.extraNota || 'Altro'), fmtEUR(c.extra) + ' €'));
    for (const p of c.pagamenti) r.push(rigaSoldi(p.base ? '− Già pagato' + (p.nota ? ' (' + p.nota + ')' : '') : '− Pagato il ' + fmtGiorno(p.data), fmtEUR(p.lordo) + ' €', 'neg'));
    const lordi = c.lordo !== c.netto;
    if (c.lordo > 0) r.push(rigaSoldi('= Ti deve oggi', fmtEUR(c.lordo) + ' €' + (lordi ? ' lordi' : ''), 'quadro-margin quadro-totale'));
    if (lordi && c.lordo > 0) r.push(rigaSoldi('Al netto di tasse e commercialista', 'circa ' + fmtEUR(c.netto) + ' €', 'riga-credito'));
    const note = [];
    if (c.prossimo) note.push('Il ' + fmtGiorno(c.prossimo.data) + ' matura ' + nomeMese(c.prossimo.mese) + ': +' + fmtEUR(c.prossimo.lordo) + ' €.');
    else if (c.al) note.push('Ultima rata: ' + nomeMese(c.al, true) + '.');
    if (c.nota) note.push(c.nota);
    if (!c.mesi && !c.extra) note.unshift('Oggi non ti deve niente.');
    return '<div class="credito"><div class="credito-nome">' + escapeHtml(c.nome) + '</div>' + (r.length ? righe(r) : '') +
      (note.length ? '<p class="money-hint">' + escapeHtml(note.join(' ')) + '</p>' : '') + '</div>';
  });
  const totL = cr.reduce((a, c) => a + c.lordo, 0), totN = cr.reduce((a, c) => a + c.netto, 0);
  const tot = '<div class="credito">' + righe([rigaSoldi('= In tutto ti devono', fmtEUR(totL) + ' € lordi', 'quadro-totale'),
    rigaSoldi('Al netto di tasse e commercialista', 'circa ' + fmtEUR(totN) + ' €', 'riga-credito')]) + '</div>';
  return riquadro('Chi ti deve soldi', blocchi.join('') + tot);
}

function renderHome() {
  const home = document.getElementById('home-content');
  if (!home) return;
  const q = BudgetCalcoli.quadro(datiCalcolo(), new Date());
  const sl = q.speseLibere;
  const heroCard = document.querySelector('.hero-card');
  const heroLabel = document.getElementById('hero-label');
  const heroEl = document.getElementById('hero-residuo');
  const heroSub = document.getElementById('hero-sub');
  const heroPace = document.getElementById('hero-pace');

  if (q.primaDellAvvio) {
    heroLabel.textContent = 'Spese libere da ' + monthLabel(dateFromISO(q.avvio));
    heroEl.textContent = fmtEUR(sl.budget) + ' €';
    heroEl.classList.remove('hero-negative');
    heroCard.classList.remove('hero-card-negative', 'hero-giallo', 'hero-arancio');
    document.getElementById('hero-stato').classList.add('hidden');
    heroSub.textContent = 'Il conteggio parte il ' + fmtGiorno(q.avvio) + ': da quel giorno qui vedi quanto puoi spendere oggi.';
    heroPace.classList.add('hidden');
  } else {
    const negativo = sl.restaOggi < 0;
    heroLabel.textContent = 'Oggi puoi spendere';
    heroEl.textContent = euro(sl.restaOggi);
    // Stato: rosso se il mese è superato, arancione se oggi sei oltre la quota,
    // giallo se resta meno di un quarto della quota di oggi, verde altrimenti.
    const meseSuperato = sl.resto < 0;
    const stato = meseSuperato ? 'rosso' : (negativo ? 'arancio' : (sl.restaOggi < sl.quotaOggi * 0.25 ? 'giallo' : 'verde'));
    const parole = { verde: 'In linea', giallo: 'Quasi al limite di oggi', arancio: 'Oltre la quota di oggi', rosso: 'Mese superato' };
    heroEl.classList.toggle('hero-negative', stato === 'rosso');
    heroCard.classList.toggle('hero-card-negative', stato === 'rosso');
    heroCard.classList.toggle('hero-giallo', stato === 'giallo');
    heroCard.classList.toggle('hero-arancio', stato === 'arancio');
    const pill = document.getElementById('hero-stato');
    pill.textContent = parole[stato];
    pill.classList.remove('hidden');
    const gg = sl.giorniRestanti === 1 ? '1 giorno' : sl.giorniRestanti + ' giorni';
    heroSub.textContent = sl.resto >= 0
      ? 'Restano ' + fmtEUR(sl.resto) + ' € di spese libere fino a fine mese (' + gg + ').'
      : 'Hai superato le spese libere del mese di ' + fmtEUR(-sl.resto) + ' €.';
    const pace = [];
    if (sl.spesoOggi > 0) pace.push('<span>Oggi hai speso ' + fmtEUR(sl.spesoOggi) + ' € su ' + fmtEUR(sl.quotaOggi) + ' €</span>');
    if (sl.chiusuraIeri) pace.push('<span>Ieri hai chiuso</span><span class="pace-value">' + conSegno(sl.chiusuraIeri.saldo) + '</span>');
    heroPace.innerHTML = pace.join('<span class="pace-meta">·</span>');
    heroPace.classList.toggle('hidden', pace.length === 0);
  }
  heroSub.classList.remove('hidden');

  // Due colonne con un titolo ciascuna: a sinistra il mese, a destra i soldi. Sul telefono una sotto l'altra.
  const mese = [], soldi = [];
  if (!q.primaDellAvvio) {
    mese.push(riquadro('Spesa e benzina', '<div class="categories-list">' + q.barre.map(b => barra(b.id, b.speso, b.budget)).join('') + '</div>'));
    const p = q.portafoglio;
    mese.push(riquadro('Il mese', righe([
      rigaSoldi('Portafoglio del mese', fmtEUR(p.mensile) + ' €'),
      rigaSoldi('− Già speso', fmtEUR(p.speso) + ' €', 'neg'),
      rigaSoldi('− Fisse da pagare', fmtEUR(p.fisseDaUscire) + ' €', 'neg'),
      rigaSoldi('= Resta', euro(p.resto), 'quadro-margin ' + (p.resto >= 0 ? 'quadro-good' : 'quadro-bad'))
    ])));
  }
  if (q.scadenze.length) {
    const altre = q.scadenze.length > 5 ? '<p class="money-hint">Tutte le scadenze sono in «Come funziona».</p>' : '';
    mese.push(riquadro('Prossime scadenze', righe(q.scadenze.slice(0, 5).map(rigaScadenza)) + altre));
  }
  mese.push(riquadro('Cassaforte', htmlCassaforte(q.cassaforte)));
  const pat = htmlPatrimonio();
  if (pat) soldi.push(pat);
  const cre = htmlCrediti();
  if (cre) soldi.push(cre);
  const colonna = (titolo, blocchi) => blocchi.length ? '<section class="home-col"><h2 class="home-sezione">' + titolo + '</h2>' + blocchi.join('') + '</section>' : '';
  const piede = q.ultimoMovimento ? '<p class="money-hint home-ultimo">Ultimo movimento registrato: ' + escapeHtml(fmtGiorno(q.ultimoMovimento)) + '</p>' : '';
  home.innerHTML = '<div class="home-grid">' + colonna('Questo mese', mese) + colonna('I tuoi soldi', soldi) + '</div>' + piede;
}

// ============================================================
// COME FUNZIONA: budget, fisse, scadenze e regola del bonifico, in sola lettura
// ============================================================
function renderComeFunziona() {
  const box = document.getElementById('come-content');
  if (!box) return;
  const dati = datiCalcolo();
  const q = BudgetCalcoli.quadro(dati, new Date());
  const settings = dati.settings || {};
  const fisse = activeOnly(dati.recurring).filter(r => r.active !== false);
  const totFisse = fisse.reduce((a, r) => a + (Number(r.amount) || 0), 0);
  const budget = q.barre.slice(0, 1).concat([{ id: 'spese-libere', budget: q.speseLibere.budget }], q.barre.slice(1))
    .map(b => rigaSoldi((getCategory(b.id) || {}).name || b.id, fmtEUR(b.budget) + ' €'));
  budget.push(rigaSoldi('Spese fisse (abbonamenti, casa, lavoro)', fmtEUR(totFisse) + ' €'));
  budget.push(rigaSoldi('= Portafoglio del mese', fmtEUR(q.portafoglio.mensile) + ' €', 'quadro-margin quadro-good'));

  const stato = {};
  q.portafoglio.fisseUscite.forEach(f => { stato[f.id] = 'uscita: ' + fmtEUR(f.amount) + ' €'; });
  const righeFisse = fisse.slice().sort((a, b) => (a.dayOfMonth || 0) - (b.dayOfMonth || 0)).map(r =>
    rigaSoldi(r.name + ' (giorno ' + r.dayOfMonth + (q.primaDellAvvio ? '' : ', ' + (stato[r.id] || 'da pagare')) + ')', fmtEUR(r.amount) + ' €'));
  const titoloFisse = q.primaDellAvvio ? 'Le fisse di ogni mese' : 'Le fisse di ' + monthLabel(new Date());

  const medie = settings.medie || {};
  const righeMedie = Object.keys(medie).map(id => rigaSoldi(((getCategory(id) || {}).name || id) + ' (media)', fmtEUR(medie[id]) + ' € al mese'));
  const risparmio = settings.risparmio || {};
  const pct = settings.taxPctDefault != null ? settings.taxPctDefault : 12;
  const testoCassaforte = '<p class="money-hint">La cassaforte tiene da parte il ' + pct +
    '% dell’importo lordo di ogni fattura per l’imposta, i soldi delle scadenze dei prossimi 12 mesi' +
    (risparmio.mensile ? ' e ' + fmtEUR(risparmio.mensile) + ' € al mese di risparmio' + (risparmio.dal ? ' da ' + monthLabel(dateFromISO(risparmio.dal + '-01')) : '') : '') +
    '. Salute, auto, veterinario e regali si pagano dalla cassaforte quando capitano: le medie servono solo per orientarsi.</p>';

  box.innerHTML =
    riquadro('Il portafoglio del mese', righe(budget) + '<p class="money-hint">Questi numeri li aggiorna Claude: per cambiarli, scrivigli in chat.</p>') +
    riquadro(titoloFisse, righe(righeFisse) + '<p class="money-hint">Una fissa resta fra quelle da pagare finché Claude non registra la spesa effettiva; se in un mese salta, non conta.</p>') +
    riquadro('La cassaforte', (righeMedie.length ? righe(righeMedie) : '') + testoCassaforte) +
    riquadro('Tutte le scadenze', q.scadenze.length ? righe(q.scadenze.map(rigaScadenza)) : '<p class="money-hint">Nessuna scadenza.</p>') +
    riquadro('Il bonifico di inizio mese', '<p class="money-hint">Il primo del mese manda a Claude il saldo di Fineco e l’importo dei contanti, esclusa la busta dei tuoi sfizi personali. Claude ti indica un solo bonifico: da Tinaba a Fineco se il portafoglio è sotto i ' +
      fmtEUR(q.portafoglio.mensile) + ' €, da Fineco a Tinaba se è sopra (per esempio perché è arrivata un’entrata). Lo stesso bonifico porta su Fineco i soldi delle scadenze del mese.</p>') +
    '<p class="money-hint">Le entrate attese (Manlio, ADT, Michelle) non entrano nei conti finché i soldi non arrivano.</p>';
}

// ============================================================
// DIAGNOSI
// ============================================================
function renderDiagnosi() {
  const c = document.getElementById('diagnosi-content');
  if (!c) return;
  const d = BudgetCalcoli.diagnosi(datiCalcolo(), monthKey(currentMonth));
  document.getElementById('diagnosi-month').textContent = monthLabel(currentMonth);
  const sezione = (titolo, r) => r.length ? riquadro(titolo, righe(r)) : '';
  const avviso = d.giorniConSpese < 7
    ? '<p class="money-hint diagnosi-avviso">Spese registrate in ' + d.giorniConSpese + (d.giorniConSpese === 1 ? ' giorno' : ' giorni') + ': i totali sono ancora parziali.</p>'
    : '';
  const totali = [
    rigaSoldi('Portafoglio: speso', fmtEUR(d.portafoglio.speso) + ' € / ' + fmtEUR(d.portafoglio.mensile) + ' €', d.portafoglio.speso > d.portafoglio.mensile ? 'riga-negativa' : ''),
    rigaSoldi('Spese variabili', fmtEUR(d.variabili) + ' €'),
    rigaSoldi('Spese fisse', fmtEUR(d.fisse) + ' €'),
    rigaSoldi('Dalla cassaforte', fmtEUR(d.cassaforte) + ' €'),
    rigaSoldi('Totale del mese', fmtEUR(d.totale) + ' €')
  ];
  const categorie = d.categorie.map(x => rigaSoldi(
    x.name + (x.sforo > 0 ? ' (oltre di ' + fmtEUR(x.sforo) + ' €)' : ''),
    fmtEUR(x.speso) + ' €' + (x.budget > 0 ? ' / ' + fmtEUR(x.budget) + ' €' : ''),
    x.sforo > 0 ? 'riga-negativa' : ''
  ));
  const metodi = d.perMetodo.map(x => rigaSoldi(x.metodo.charAt(0).toUpperCase() + x.metodo.slice(1), fmtEUR(x.importo) + ' €'));
  const entrate = d.entrateArrivate.map(v => rigaSoldi(v.name + ' (arrivata)', fmtEUR(v.lordo) + ' €'))
    .concat(d.entrateAttese.map(v => rigaSoldi(v.name + ' (attesa)', fmtEUR(v.lordo) + ' €')));
  c.innerHTML = avviso + sezione('Totali', totali) + sezione('Per categoria', categorie) +
    sezione('Per metodo di pagamento', metodi) + sezione('Entrate', entrate);
}

function bindDiagnosi() {
  document.getElementById('diagnosi-prev').addEventListener('click', () => document.getElementById('prev-month').click());
  document.getElementById('diagnosi-next').addEventListener('click', () => document.getElementById('next-month').click());
}

// ============================================================
// MOVIMENTI
// ============================================================
function renderMovements() {
  const catFilter = document.getElementById('movements-category-filter').value;
  const showRecurring = document.getElementById('show-recurring-toggle').checked;
  let list = cachedMovements.slice();
  if (catFilter) list = list.filter(m => m.category === catFilter);
  if (!showRecurring) list = list.filter(m => !m.isRecurring);
  const sortEl = document.getElementById('movements-sort');
  const sortBy = sortEl ? sortEl.value : 'date';
  if (sortBy === 'amount') list.sort((a, b) => (b.amount || 0) - (a.amount || 0));
  else list.sort((a, b) => +new Date(b.date) - +new Date(a.date));
  const c = document.getElementById('movements-list');
  if (list.length === 0) {
    c.innerHTML = '<p class="empty-msg">Nessun movimento in questo mese.</p>';
    return;
  }
  c.innerHTML = list.map(m => {
    const cat = getCategory(m.category);
    const d = new Date(m.date);
    const dateStr = d.toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit' });
    return '<div class="movement-item">' +
      '<div class="movement-date">' + dateStr + '</div>' +
      '<div class="movement-body">' +
      '<div class="movement-top">' +
      '<span class="cat-badge" style="background:' + (cat ? cat.color : '#888') + '">' + escapeHtml(cat ? cat.name : '?') + '</span>' +
      (m.isRecurring ? '<span class="badge-recurring">automatica</span>' : '') +
      (m.recurringId && !m.isRecurring ? '<span class="badge-recurring">fissa</span>' : '') +
      (m.method ? '<span class="badge-split">' + escapeHtml(m.method) + '</span>' : '') +
      (m.splitGroupId ? '<span class="badge-split">split</span>' : '') +
      '</div>' +
      (m.note ? '<div class="movement-note">' + escapeHtml(m.note) + '</div>' : '') +
      '</div>' +
      '<div class="movement-amount">' + fmtEUR(m.amount) + ' €</div>' +
      '<button class="movement-delete" data-id="' + m.id + '" aria-label="Elimina">&times;</button>' +
      '</div>';
  }).join('');
}

function bindMovements() {
  document.getElementById('movements-category-filter').addEventListener('change', renderMovements);
  document.getElementById('show-recurring-toggle').addEventListener('change', renderMovements);
  var sortElBind = document.getElementById('movements-sort');
  if (sortElBind) sortElBind.addEventListener('change', renderMovements);
  document.getElementById('movements-list').addEventListener('click', function (e) {
    const btn = e.target.closest('.movement-delete');
    if (!btn) return;
    const id = btn.dataset.id;
    const mov = cachedMovements.find(m => m.id === id);
    if (!mov) return;
    if (confirm('Vuoi eliminare il movimento da ' + fmtEUR(mov.amount) + ' €?')) {
      // Tombstone invece di rimozione: cosi' la cancellazione si propaga ai
      // dispositivi che avevano ancora la voce in locale, e non viene "resuscitata".
      const all = loadMovements().map(m => m.id === id ? { ...m, _deleted: true, _modTs: Date.now() } : m);
      const ok = saveMovements(all);
      if (!ok) { showToast('Movimento non eliminato. Riprova.', true); return; }
      cachedMovements = cachedMovements.filter(m => m.id !== id);
      renderMonth(); renderMovements();
      showToast('Eliminato');
    }
  });
}

// ============================================================
// RICORRENTI
// ============================================================
function bindRecurring() {
  document.getElementById('recurring-form').addEventListener('submit', function (e) {
    e.preventDefault();
    const name = document.getElementById('rec-name').value.trim();
    const amount = parseFloat(document.getElementById('rec-amount').value);
    const category = document.getElementById('rec-category').value;
    const day = parseInt(document.getElementById('rec-day').value);
    if (!name || !category || !day) { showToast('Inserisci il nome e il giorno e scegli una categoria.', true); return; }
    if (!(amount > 0)) { showToast('Inserisci un importo maggiore di zero.', true); return; }
    const recs = loadRecurring();
    const item = { id: uuid(), name: name, amount: amount, category: category, dayOfMonth: day, active: true, lastGeneratedMonth: null, _modTs: Date.now() };
    recs.push(item);
    const ok = saveRecurring(recs);
    if (!ok) { showToast('Spesa fissa non salvata.', true); return; }
    cachedRecurring = recs;
    e.target.reset();
    renderRecurring();
    showToast('Spesa fissa aggiunta');
  });

  document.getElementById('recurring-list').addEventListener('click', function (e) {
    const btn = e.target.closest('button');
    if (btn) {
      const id = btn.dataset.id;
      const recs = loadRecurring();
      const rec = recs.find(r => r.id === id);
      if (!rec) return;
      if (btn.dataset.action === 'toggle') {
        rec.active = !rec.active;
        rec._modTs = Date.now();
        saveRecurring(recs);
        cachedRecurring = recs;
        renderRecurring();
      } else if (btn.dataset.action === 'edit') {
        openEditRecurring(id);
      }
      return;
    }
    // Click sulla riga (non sui bottoni) apre edit
    const item = e.target.closest('.recurring-item');
    if (item && item.dataset.id) {
      openEditRecurring(item.dataset.id);
    }
  });
}

let editingRecurringId = null;
function openEditRecurring(id) {
  const rec = cachedRecurring.find(r => r.id === id);
  if (!rec) return;
  editingRecurringId = id;
  document.getElementById('edit-rec-name').value = rec.name;
  document.getElementById('edit-rec-amount').value = rec.amount;
  document.getElementById('edit-rec-category').value = rec.category;
  document.getElementById('edit-rec-day').value = rec.dayOfMonth;
  document.getElementById('edit-recurring-modal').classList.remove('hidden');
}
function closeEditRecurring() {
  editingRecurringId = null;
  document.getElementById('edit-recurring-modal').classList.add('hidden');
}
function bindEditRecurring() {
  document.getElementById('edit-rec-form').addEventListener('submit', function (e) {
    e.preventDefault();
    if (!editingRecurringId) return;
    const recs = loadRecurring();
    const rec = recs.find(r => r.id === editingRecurringId);
    if (!rec) return;
    const newAmount = parseFloat(document.getElementById('edit-rec-amount').value);
    const newDay = parseInt(document.getElementById('edit-rec-day').value);
    rec.name = document.getElementById('edit-rec-name').value.trim() || rec.name;
    rec.amount = isNaN(newAmount) ? rec.amount : newAmount;
    rec.category = document.getElementById('edit-rec-category').value || rec.category;
    rec.dayOfMonth = isNaN(newDay) ? rec.dayOfMonth : newDay;
    rec._modTs = Date.now();
    const ok = saveRecurring(recs);
    if (!ok) { showToast('Modifica non salvata.', true); return; }
    cachedRecurring = recs;
    closeEditRecurring();
    renderRecurring();
    renderMonth();
    showToast('Spesa fissa aggiornata');
  });
  document.getElementById('cancel-edit-rec').addEventListener('click', closeEditRecurring);
  document.getElementById('delete-edit-rec').addEventListener('click', function () {
    if (!editingRecurringId) return;
    const rec = cachedRecurring.find(r => r.id === editingRecurringId);
    if (!rec) return;
    if (confirm('Vuoi eliminare "' + rec.name + '"? I movimenti già registrati restano nell’elenco.')) {
      // Tombstone per propagare la cancellazione.
      const all = loadRecurring().map(r => r.id === editingRecurringId ? { ...r, _deleted: true, _modTs: Date.now() } : r);
      const ok = saveRecurring(all);
      if (!ok) { showToast('Spesa fissa non eliminata.', true); return; }
      cachedRecurring = activeOnly(all);
      closeEditRecurring();
      renderRecurring();
      renderMonth();
      showToast('Spesa fissa eliminata');
    }
  });
}

function renderRecurring() {
  const list = document.getElementById('recurring-list');
  if (cachedRecurring.length === 0) {
    list.innerHTML = '<p class="empty-msg">Nessuna spesa fissa.</p>';
    return;
  }
  const sorted = cachedRecurring.slice().sort((a, b) => (a.dayOfMonth || 0) - (b.dayOfMonth || 0));
  list.innerHTML = sorted.map(rec => {
    const cat = getCategory(rec.category);
    return '<div class="recurring-item ' + (rec.active ? '' : 'inactive') + '" data-id="' + rec.id + '">' +
      '<div class="recurring-info">' +
      '<div class="recurring-name">' + escapeHtml(rec.name) + '</div>' +
      '<div class="recurring-meta">' +
      (cat && cat.name !== rec.name ? '<span class="cat-badge" style="background:' + cat.color + '">' + escapeHtml(cat.name) + '</span>' : '') +
      '<span>giorno ' + rec.dayOfMonth + '</span>' +
      '</div>' +
      '</div>' +
      '<div class="recurring-amount">' + fmtEUR(rec.amount) + ' €</div>' +
      '<div class="recurring-actions">' +
      '<button data-action="edit" data-id="' + rec.id + '" class="btn-small">Modifica</button>' +
      '<button data-action="toggle" data-id="' + rec.id + '" class="btn-small">' + (rec.active ? 'Disattiva' : 'Attiva') + '</button>' +
      '</div>' +
      '</div>';
  }).join('');
}

// ============================================================
// NAV
// ============================================================
const screenTitles = {
  'month-screen': 'Budget',
  'movements-screen': 'Movimenti',
  'recurring-screen': 'Spese fisse',
  'budget-screen': 'Come funziona',
  'diagnosi-screen': 'Diagnosi'
};

function bindNav() {
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', function () {
      const target = btn.dataset.screen;
      document.querySelectorAll('.app-screen').forEach(s => s.classList.remove('active'));
      document.getElementById(target).classList.add('active');
      document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById('header-title').textContent = screenTitles[target] || '';
    });
  });
}

function populateCategoryDropdowns() {
  // Le categorie raggruppate: portafoglio, fisse, cassaforte.
  const options = Object.keys(GROUP_LABELS).map(g =>
    '<optgroup label="' + GROUP_LABELS[g] + '">' +
    CATEGORIES.filter(c => c.group === g).map(c => '<option value="' + c.id + '">' + c.name + '</option>').join('') +
    '</optgroup>').join('');
  ['add-category', 'rec-category', 'edit-rec-category'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.innerHTML = '<option value="">Seleziona...</option>' + options;
  });
  document.getElementById('movements-category-filter').innerHTML =
    '<option value="">Tutte le categorie</option>' + options;
}

// ============================================================
// BOOT
// ============================================================
function showApp() {
  document.getElementById('app-container').classList.remove('hidden');
}

function bindLogout() {
  const btn = document.getElementById('logout-btn');
  if (!btn) return;
  btn.addEventListener('click', function () {
    if (!confirm('Vuoi uscire dall\'account? Per accedere di nuovo dovrai inserire email e password.')) return;
    try {
      // Flush dei push pendenti prima del logout: non lasciamo dati per strada.
      flushPushSync();
      if (typeof firebase !== 'undefined' && firebase.auth) {
        firebase.auth().signOut().catch(() => {});
      }
    } catch (e) {}
  });
}

async function startApp() {
  showApp();
  await initialSync();
  migrateCategories();
  purgeOldTombstones();
  cachedRecurring = activeOnly(loadRecurring());
  cachedMovements = filterMovementsByMonth(currentMonth);
  document.getElementById('add-date').value = todayISO();
  renderMonth();
  renderMovements();
  renderRecurring();
  renderComeFunziona();
  BudgetCoda.sincronizza();
}

function bindModalBackdrops() {
  const pairs = [
    ['add-modal', closeAddModal],
    ['edit-recurring-modal', closeEditRecurring],
    ['coda-modal', function () { BudgetCoda.chiudi(); }],
    ['split-modal', function () { document.getElementById('split-modal').classList.add('hidden'); }]
  ];
  for (const [modalId, closeFn] of pairs) {
    const el = document.getElementById(modalId);
    if (!el) continue;
    el.addEventListener('click', function (e) {
      if (e.target === el) closeFn();
    });
  }
}

// ============================================================
// FIREBASE AUTH GATE
// ============================================================
function showFbLogin() {
  document.getElementById('fb-login-screen').classList.remove('hidden');
  document.getElementById('app-container').classList.add('hidden');
}

function bindFbLogin() {
  const form = document.getElementById('fb-login-form');
  if (!form) return;
  form.addEventListener('submit', async function (e) {
    e.preventDefault();
    const email = document.getElementById('fb-email').value.trim();
    const pass = document.getElementById('fb-password').value;
    const rememberEl = document.getElementById('fb-remember');
    const remember = rememberEl ? rememberEl.checked : true;
    const errEl = document.getElementById('fb-login-error');
    errEl.textContent = 'Accesso in corso...';
    try {
      // Persistence va settata PRIMA del signIn. LOCAL = resta loggato anche
      // dopo chiusura tab/app. SESSION = sparisce alla chiusura.
      const persistenceMode = remember
        ? firebase.auth.Auth.Persistence.LOCAL
        : firebase.auth.Auth.Persistence.SESSION;
      await firebase.auth().setPersistence(persistenceMode);
      await firebase.auth().signInWithEmailAndPassword(email, pass);
      errEl.textContent = '';
      // onAuthStateChanged gestisce il passaggio diretto all'app.
    } catch (err) {
      errEl.textContent = 'Email o password errati';
    }
  });
}

function initFirebaseAuth(onReady) {
  // Avvio offline: se gli SDK Firebase non sono disponibili (CDN irraggiungibile
  // e non ancora in cache), NON bloccare l'app con pagina bianca. Si parte coi
  // dati locali; il sync ripartira' quando torna la rete. hasPushPending() garantisce
  // che le modifiche fatte offline vengano spedite al primo boot online.
  if (typeof firebase === 'undefined' || !firebase.auth) {
    console.warn('Firebase non disponibile (offline?): avvio in sola lettura locale');
    setSyncIndicator('warn', 'OFFLINE');
    startApp();
    return;
  }
  firebase.initializeApp(FIREBASE_CONFIG);
  // Default LOCAL: in caso di sessione gia' persistente prima del refactor,
  // resta tale. Il flag "Ricordami" del form puo' cambiarlo solo al login esplicito.
  firebase.auth().setPersistence(firebase.auth.Auth.Persistence.LOCAL).catch(() => {});
  firebase.auth().onIdTokenChanged(function (user) {
    if (user) user.getIdToken().then(t => {
      idToken = t;
      // Nuovo token disponibile: se c'erano push falliti per auth, riprova subito.
      if (hasPushPending()) schedulePush(50);
    }).catch(() => {});
    else idToken = null;
  });
  firebase.auth().onAuthStateChanged(function (user) {
    if (user) {
      user.getIdToken().then(t => { idToken = t; onReady(); }).catch(() => onReady());
    } else {
      showFbLogin();
    }
  });
}

let realtimeStarted = false;
function afterFbAuth() {
  document.getElementById('fb-login-screen').classList.add('hidden');
  // Sync real-time parte subito dopo login.
  if (!realtimeStarted) {
    setupRealtimeSync();
    realtimeStarted = true;
  }
  startApp();
}

function bindUpdateBanner() {
  const btn = document.getElementById('update-reload-btn');
  if (!btn) return;
  btn.addEventListener('click', function () {
    // Flush prima del reload: non perdiamo modifiche locali in coda.
    flushPushSync();
    btn.disabled = true;
    btn.textContent = 'Aggiorno...';
    // Manda SKIP_WAITING AL SW IN WAITING (non al controller vecchio, che
    // ignorerebbe il messaggio: era la causa radice del banner che ricompariva).
    // L'attivazione del nuovo SW scatena 'controllerchange' -> reload (in index.html).
    const waiting = window.__swWaiting;
    if (waiting) {
      try { waiting.postMessage({ type: 'SKIP_WAITING' }); } catch (e) {}
    } else if (navigator.serviceWorker && navigator.serviceWorker.controller) {
      // Fallback raro (riferimento perso): chiede al controller di promuovere.
      try { navigator.serviceWorker.controller.postMessage({ type: 'SKIP_WAITING' }); } catch (e) {}
    }
    // Rete di sicurezza: se controllerchange non arriva entro 3s, ricarica comunque.
    // Non un reload immediato (lascerebbe il SW vecchio al comando e il banner tornerebbe).
    setTimeout(() => { try { window.location.reload(); } catch (e) {} }, 3000);
  });
}

function showUpdateBanner() {
  const b = document.getElementById('update-banner');
  if (b) b.classList.remove('hidden');
}

function boot() {
  populateCategoryDropdowns();
  bindAdd();
  bindSplit();
  bindMonthNav();
  bindMovements();
  bindRecurring();
  bindEditRecurring();
  bindModalBackdrops();
  bindNav();
  bindLogout();
  bindUnloadFlush();
  bindFbLogin();
  bindUpdateBanner();
  bindDiagnosi();
  BudgetCoda.bind();

  initFirebaseAuth(afterFbAuth);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
