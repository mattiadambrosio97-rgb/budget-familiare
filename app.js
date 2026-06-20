// ============================================================
// Budget Familiare - localStorage + sync Firebase Realtime DB
// (stesso progetto agenda-f3298, nodo /budget separato)
// ============================================================

const STORAGE_PREFIX = 'bf_';
const FB_PATH = '/budget';
const FB_URL = 'https://agenda-f3298-default-rtdb.europe-west1.firebasedatabase.app' + FB_PATH + '.json';
const SYNC_KEYS = ['movements', 'recurring', 'caps', 'sinking', 'income'];
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

// Colori usati sia per i dot/barre sia per i badge a testo bianco: scelti per
// dare almeno 4.5:1 col bianco a 11px (bug U5 dell'audit; prima benzina/palestra/
// gas/spesa erano sotto soglia). Restano nella stessa famiglia cromatica.
const CATEGORIES = [
  { id: 'spesa-casa', name: 'Spesa + casa', color: '#15803d', fixed: false },
  { id: 'benzina', name: 'Benzina', color: '#b45309', fixed: false },
  { id: 'animali', name: 'Animali', color: '#9333ea', fixed: false },
  { id: 'sfizi', name: 'Sfizi e uscite', color: '#dc2626', fixed: false },
  { id: 'regali', name: 'Regali', color: '#be185d', fixed: false },
  { id: 'abbigliamento', name: 'Abbigliamento', color: '#7c3aed', fixed: false },
  { id: 'palestra-vitamine', name: 'Palestra + Vitamine', color: '#a16207', fixed: false },
  { id: 'abbonamenti', name: 'Abbonamenti streaming/SaaS', color: '#2563eb', fixed: true },
  { id: 'casa-gas', name: 'Casa - bombola gas', color: '#0f766e', fixed: true },
  { id: 'casa-pulizia', name: 'Casa - pulizia signora', color: '#0e7490', fixed: true },
  { id: 'cura-personale', name: 'Cura personale', color: '#be185d', fixed: true },
  { id: 'vacanze', name: 'Vacanze/viaggi', color: '#475569', fixed: false, hidden: true }
];

const DEFAULT_CAPS = {
  'spesa-casa': 400,
  'benzina': 100,
  'animali': 120,
  'sfizi': 300,
  'regali': 0,
  'abbigliamento': 0,
  'palestra-vitamine': 0,
  'abbonamenti': 0,
  'casa-gas': 0,
  'casa-pulizia': 0,
  'cura-personale': 0,
  'vacanze': 0
};

const DEFAULT_INCOME = [
  { id: 'i-mattia', name: 'Mattia entrate nette', amount: 1700, note: 'Conservativo, solo Mattia' }
];

const DEFAULT_SINKING = [
  { id: 's-salvadanaio', name: 'Salvadanaio coppia', amount: 200, note: 'Crescita patrimonio, conto deposito intoccabile' },
  { id: 's-auto', name: 'Sinking auto', amount: 75, note: 'Ass. luglio + gennaio, bollo settembre, revisione gennaio 2027' },
  { id: 's-regali', name: 'Sinking regali', amount: 50, note: 'Natale, compleanni, occasioni' }
];

// Id deterministici (r-...) come per sinking (s-...) e income (i-...): cosi' due
// device che seminano i default in autonomia (primo avvio con pull fallito) NON
// li duplicano al merge successivo (bug B4 dell'audit). Gli id non vanno piu' cambiati.
const DEFAULT_RECURRING = [
  { id: 'r-openai', name: 'OpenAI ChatGPT Plus', amount: 21, category: 'abbonamenti', dayOfMonth: 24 },
  { id: 'r-apple1', name: 'Apple #1', amount: 9.99, category: 'abbonamenti', dayOfMonth: 5 },
  { id: 'r-apple2', name: 'Apple #2', amount: 9.99, category: 'abbonamenti', dayOfMonth: 19 },
  { id: 'r-capcut', name: 'CapCut Pro', amount: 11.99, category: 'abbonamenti', dayOfMonth: 6 },
  { id: 'r-tim', name: 'Telecom Italia', amount: 10.97, category: 'abbonamenti', dayOfMonth: 17 },
  { id: 'r-iliad', name: 'Iliad', amount: 7.99, category: 'abbonamenti', dayOfMonth: 20 },
  { id: 'r-netflix', name: 'Netflix', amount: 6.99, category: 'abbonamenti', dayOfMonth: 25 },
  { id: 'r-disney', name: 'Disney+', amount: 6.99, category: 'abbonamenti', dayOfMonth: 17 },
  { id: 'r-hbo', name: 'HBO Max', amount: 5.99, category: 'abbonamenti', dayOfMonth: 11 },
  { id: 'r-intesa', name: 'Canone conto Intesa', amount: 3.95, category: 'abbonamenti', dayOfMonth: 28 },
  { id: 'r-signora', name: 'Signora delle pulizie', amount: 64, category: 'casa-pulizia', dayOfMonth: 1 },
  { id: 'r-barbiere', name: 'Barbiere', amount: 45, category: 'cura-personale', dayOfMonth: 1 }
];

const MIN_MONTH = new Date(2026, 4, 1); // maggio 2026 (mese 4 = maggio, 0-indexed)
const MAX_MONTH_OFFSET = 12;            // navigabile fino a 12 mesi nel futuro

// ============================================================
// STATE
// ============================================================
let currentMonth = startOfMonth(new Date());
let cachedMovements = [];
let cachedRecurring = [];
let cachedCaps = { ...DEFAULT_CAPS };
let cachedSinking = [...DEFAULT_SINKING];
let cachedIncome = [...DEFAULT_INCOME];

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
function loadCaps() { return lsRead('caps', { ...DEFAULT_CAPS }); }
function saveCaps(obj) {
  // Timbra un timestamp per categoria nel sotto-oggetto nascosto `_t`, cosi' il
  // merge multi-device puo' tenere il valore piu' recente categoria per categoria
  // (prima i caps venivano sovrascritti in blocco da un PUT stantio dell'altro device).
  // I dati esistenti senza `_t` valgono timestamp 0: un salvataggio vince sempre su di essi,
  // e un push stantio senza `_t` non sovrascrive piu' un tetto appena modificato qui.
  const now = Date.now();
  const out = {};
  const t = { ...(obj._t || {}) };
  for (const k in obj) { if (k !== '_t') { out[k] = obj[k]; t[k] = now; } }
  out._t = t;
  const ok = lsWrite('caps', out);
  if (ok) schedulePush();
  return ok;
}
// Merge dei tetti categoria per categoria: vince il valore col `_t` piu' recente.
function mergeCaps(local, remote) {
  local = local && typeof local === 'object' ? local : {};
  remote = remote && typeof remote === 'object' ? remote : {};
  const lt = local._t || {}, rt = remote._t || {};
  const out = {}, outT = {};
  const keys = new Set([...Object.keys(local), ...Object.keys(remote)].filter(k => k !== '_t'));
  for (const k of keys) {
    const lts = lt[k] || 0, rts = rt[k] || 0;
    // A parita' (tipico: entrambi senza _t, dati legacy) tiene il valore locale.
    if (rts > lts) { out[k] = remote[k]; outT[k] = rts; }
    else { out[k] = (k in local) ? local[k] : remote[k]; outT[k] = Math.max(lts, rts); }
  }
  out._t = outT;
  return out;
}
function loadSinking() { return lsRead('sinking', [...DEFAULT_SINKING]); }
function saveSinking(arr) { const ok = lsWrite('sinking', arr); if (ok) schedulePush(); return ok; }
function loadIncome() { return lsRead('income', [...DEFAULT_INCOME]); }
function saveIncome(arr) { const ok = lsWrite('income', arr); if (ok) schedulePush(); return ok; }

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
    payload[k] = v ? JSON.stringify(v) : null;
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
  for (const k of ['movements', 'recurring', 'sinking', 'income']) {
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
  const MERGE_KEYS = ['movements', 'recurring', 'sinking', 'income'];
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
        } else if (k === 'caps') {
          // Merge per categoria col timestamp `_t`: niente piu' sovrascrittura
          // in blocco di un tetto modificato qui da un payload stantio dell'altro device.
          const local = lsRead('caps', {});
          const merged = mergeCaps(local, parsed);
          // Se un tetto locale ha vinto sul remoto (valore diverso), ri-push.
          for (const ck in merged) {
            if (ck === '_t') continue;
            if (merged[ck] !== parsed[ck]) { lastMergeNeedsRepush = true; break; }
          }
          lsWrite('caps', merged);
        } else {
          lsWrite(k, parsed);
        }
        applied = true;
      } catch (e) {}
    }
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
    const payload = buildPayload();
    // Forza refresh del token: evita 401 silenzioso se il token in cache e' scaduto.
    const url = await authedUrl(true);
    if (!idToken) throw new Error('Nessun token disponibile');
    const r = await fetch(url, {
      method: 'PUT',
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
      method: 'PUT',
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
  try { renderMonth(); } catch (e) {}
  try { renderMovements(); } catch (e) {}
  try { renderRecurring(); } catch (e) {}
  try { renderCaps(); } catch (e) {}
  try { renderSinking(); } catch (e) {}
  try { renderIncome(); } catch (e) {}
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
  cachedCaps = loadCaps();
  cachedSinking = activeOnly(loadSinking());
  cachedIncome = activeOnly(loadIncome());
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
      const now = new Date();
      ensureRecurringForMonth();
      cachedRecurring = activeOnly(loadRecurring());
      const wasViewingCurrent = (currentMonth.getFullYear() === now.getFullYear() && currentMonth.getMonth() === now.getMonth());
      if (!wasViewingCurrent && document.getElementById('hero-residuo')) {
        // Non spostiamo a forza la vista se l'utente stava guardando un altro mese
        // di proposito; rigeneriamo solo i dati. Il render naturale mostrera' i nuovi.
      }
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
  return (n || 0).toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
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

const MIGRATION_VERSION = 'v4-2026-06-04';
function migrateCategories() {
  // Idempotenza: gira una volta sola per versione. Evita di cancellare entita future
  // che matcherebbero pattern legacy (es. un futuro sinking con parola "palestra").
  if (localStorage.getItem(STORAGE_PREFIX + '_migration') === MIGRATION_VERSION) return;
  // Ogni record toccato dalla migrazione riceve _modTs aggiornato. Cosi' il merge
  // multi-device fa vincere la versione migrata sui device che ancora avevano
  // i dati legacy.
  const migTs = Date.now();
  // Step 1: vecchia 'bollette' -> 'abbonamenti' o 'casa-gas'
  // Step 2: vecchia 'casa-fisse' -> 'casa-gas'
  let touched = false;
  const movs = loadMovements();
  for (const m of movs) {
    if (m.category === 'bollette') {
      const txt = ((m.note || '') + ' ' + (m.name || '')).toLowerCase();
      m.category = txt.includes('bombola') || txt.includes('gas') ? 'casa-gas' : 'abbonamenti';
      m._modTs = migTs;
      touched = true;
    } else if (m.category === 'casa-fisse') {
      m.category = 'casa-gas';
      m._modTs = migTs;
      touched = true;
    }
  }
  if (touched) lsWrite('movements', movs);

  const recs = loadRecurring();
  let touchedR = false;
  for (const r of recs) {
    if (r.category === 'bollette') {
      const n = (r.name || '').toLowerCase();
      r.category = n.includes('bombola') || n.includes('gas') ? 'casa-gas' : 'abbonamenti';
      r._modTs = migTs;
      touchedR = true;
    } else if (r.category === 'casa-fisse') {
      r.category = 'casa-gas';
      r._modTs = migTs;
      touchedR = true;
    }
  }
  // Rinomina vecchia "Pulizia signora" in "Signora delle pulizie"
  for (const r of recs) {
    if (r.name === 'Pulizia signora') {
      r.name = 'Signora delle pulizie';
      r._modTs = migTs;
      touchedR = true;
    }
  }

  // Aggiungi nuovi ricorrenti default se mancano (per utenti esistenti)
  const hasPulizia = recs.some(r => r.category === 'casa-pulizia');
  const hasBarbiere = recs.some(r => r.category === 'cura-personale');
  if (!hasPulizia) {
    recs.push({ id: uuid(), name: 'Signora delle pulizie', amount: 64, category: 'casa-pulizia', dayOfMonth: 1, active: true, lastGeneratedMonth: null, _modTs: migTs });
    touchedR = true;
  }
  if (!hasBarbiere) {
    recs.push({ id: uuid(), name: 'Barbiere', amount: 30, category: 'cura-personale', dayOfMonth: 1, active: true, lastGeneratedMonth: null, _modTs: migTs });
    touchedR = true;
  }
  const hasMichCura = recs.some(r => r.name && r.name.toLowerCase().includes('mich'));
  if (!hasMichCura) {
    recs.push({ id: uuid(), name: 'Mich cura di sé', amount: 60, category: 'cura-personale', dayOfMonth: 1, active: true, lastGeneratedMonth: null, _modTs: migTs });
    touchedR = true;
  }

  if (touchedR) lsWrite('recurring', recs);

  const caps = loadCaps();
  let touchedC = false;
  if ('bollette' in caps) { delete caps.bollette; touchedC = true; }
  if ('casa-fisse' in caps) { delete caps['casa-fisse']; touchedC = true; }
  for (const id of ['abbonamenti', 'casa-gas', 'casa-pulizia', 'cura-personale', 'regali', 'abbigliamento', 'palestra-vitamine']) {
    if (!(id in caps)) { caps[id] = 0; touchedC = true; }
  }
  if (touchedC) lsWrite('caps', caps);

  // Sinking: rinomina Fondo emergenza in Salvadanaio coppia, togli Palestra (pagata una tantum), aggiungi Regali se mancante
  const sinks = loadSinking();
  let touchedS = false;
  for (const s of sinks) {
    if (s.name === 'Fondo emergenza' || s.id === 's-emergenza') {
      s.name = 'Salvadanaio coppia';
      s.note = 'Crescita patrimonio, conto deposito intoccabile';
      s._modTs = migTs;
      touchedS = true;
    }
  }
  // Le voci "palestra" diventano tombstone invece di scomparire: la cancellazione
  // si propaga via merge multi-device (altrimenti un device che ancora le aveva
  // le rimetterebbe in vita al prossimo sync).
  for (const s of sinks) {
    if (s.name && s.name.toLowerCase().includes('palestra') && !s._deleted) {
      s._deleted = true;
      s._modTs = migTs;
      touchedS = true;
    }
  }
  const hasRegali = sinks.some(s => !s._deleted && s.name && s.name.toLowerCase().includes('regali'));
  if (!hasRegali) {
    sinks.push({ id: uuid(), name: 'Sinking regali', amount: 50, note: 'Natale, compleanni, occasioni', _modTs: migTs });
    touchedS = true;
  }
  if (touchedS) { lsWrite('sinking', sinks); schedulePush(); }
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
// RICORRENTI: generazione automatica del mese corrente
// ============================================================
// Genera le spese ricorrenti dei mesi mancanti, dal mese successivo a
// lastGeneratedMonth fino al mese corrente incluso (catch-up: bug B6 dell'audit,
// un mese in cui l'app non viene aperta non resta piu' senza spese fisse).
// L'id del movimento generato e' DETERMINISTICO (recurringId:YYYY-MM): cosi' due
// device che generano lo stesso mese producono lo stesso id e mergeById li collassa
// (niente piu' doppia generazione, bug B5), ed e' idempotente per costruzione.
function ensureRecurringForMonth() {
  const now = new Date();
  const curY = now.getFullYear(), curM = now.getMonth();
  const recs = loadRecurring();
  const movs = loadMovements();
  const nowTs = Date.now();
  // Indice degli id movimento gia' presenti (inclusi i tombstones: una voce
  // cancellata dall'utente non va rigenerata).
  const existingIds = new Set(movs.map(m => m && m.id).filter(Boolean));
  let touched = false;

  for (const rec of recs) {
    if (!rec || rec._deleted || !rec.active) continue;
    // Punto di partenza del catch-up: il mese dopo lastGeneratedMonth, oppure il
    // mese corrente se non e' mai stato generato nulla (niente storia retroattiva).
    let y = curY, m = curM;
    if (rec.lastGeneratedMonth && /^\d{4}-\d{2}$/.test(rec.lastGeneratedMonth)) {
      const [ly, lm] = rec.lastGeneratedMonth.split('-').map(Number);
      y = ly; m = lm - 1 + 1; // mese successivo (0-indexed: lm-1, poi +1)
      if (m > 11) { m = 0; y++; }
    }
    // Itera i mesi mancanti fino al corrente (cap a 24 iterazioni per sicurezza).
    let guard = 0;
    while ((y < curY || (y === curY && m <= curM)) && guard++ < 24) {
      const mk = y + '-' + String(m + 1).padStart(2, '0');
      const movId = rec.id + ':' + mk;
      if (!existingIds.has(movId)) {
        const day = Math.min(Math.max(parseInt(rec.dayOfMonth) || 1, 1), 28);
        const movDate = new Date(y, m, day, 12, 0, 0);
        movs.push({
          id: movId,
          date: movDate.toISOString(),
          amount: rec.amount,
          category: rec.category,
          note: rec.name + ' (ricorrente)',
          isRecurring: true,
          recurringId: rec.id,
          _modTs: nowTs
        });
        existingIds.add(movId);
        touched = true;
      }
      if (m === curM && y === curY) break;
      m++; if (m > 11) { m = 0; y++; }
    }
    const curMk = curY + '-' + String(curM + 1).padStart(2, '0');
    if (rec.lastGeneratedMonth !== curMk) { rec.lastGeneratedMonth = curMk; rec._modTs = nowTs; touched = true; }
  }
  if (touched) { saveMovements(movs); saveRecurring(recs); }
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
  document.getElementById('fab-add').addEventListener('click', openAddModal);
  document.getElementById('top-add-btn').addEventListener('click', openAddModal);
  document.getElementById('cancel-add').addEventListener('click', closeAddModal);

  document.getElementById('add-form').addEventListener('submit', function (e) {
    e.preventDefault();
    const dateStr = document.getElementById('add-date').value;
    const amount = parseFloat(document.getElementById('add-amount').value);
    const category = document.getElementById('add-category').value;
    const note = document.getElementById('add-note').value.trim();
    if (!dateStr || !category) { showToast('Compila data e categoria.', true); return; }
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
      showToast('Errore: spesa NON salvata. Riprova.', true);
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
      showToast('Errore: split NON salvato. Riprova.', true);
      return;
    }
    splitModal.classList.add('hidden');
    closeAddModal();
    cachedMovements = filterMovementsByMonth(currentMonth);
    renderMonth();
    renderMovements();
    showToast('Split salvato (' + data.length + ' righe)');
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

function renderMonth() {
  document.getElementById('month-label').textContent = monthLabel(currentMonth);
  updateMonthNavState();
  const totals = {};
  CATEGORIES.forEach(c => { totals[c.id] = 0; });
  let totalToday = 0;
  let totalVariable = 0;
  let totalFixed = 0;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayStr = todayISO();
  for (const m of cachedMovements) {
    totals[m.category] = (totals[m.category] || 0) + m.amount;
    const cat = getCategory(m.category);
    if (cat && cat.fixed) totalFixed += m.amount;
    else totalVariable += m.amount;
    // Giorno locale via getter (non slice UTC: pattern fragile dell'audit B12).
    const mDate = new Date(m.date);
    const dStr = mDate.getFullYear() + '-' + String(mDate.getMonth() + 1).padStart(2, '0') + '-' + String(mDate.getDate()).padStart(2, '0');
    if (dStr === todayStr) totalToday += m.amount;
  }

  // Separazione capped vs free: il residuo del hero si calcola SOLO sulle
  // categorie con tetto > 0. Le libere (regali, palestra, abbigliamento ecc.)
  // sono spese occasionali a parte e non devono erodere il budget delle
  // categorie su cui ci si e' dati un limite.
  let totBudget = 0;
  let totalCapped = 0;
  let totalFree = 0;
  for (const c of CATEGORIES) {
    if (c.fixed || c.hidden) continue;
    const cap = cachedCaps[c.id] || 0;
    if (cap > 0) {
      totBudget += cap;
      totalCapped += totals[c.id] || 0;
    } else {
      totalFree += totals[c.id] || 0;
    }
  }
  const residuo = totBudget - totalCapped;

  // HERO (su variabili)
  const heroEl = document.getElementById('hero-residuo');
  const heroSub = document.getElementById('hero-sub');
  const heroCard = document.querySelector('.hero-card');
  const heroLabel = document.querySelector('.hero-label');
  // Etichetta dinamica: dice quale mese si sta guardando (prima diceva sempre
  // "questo mese" anche navigando ai mesi passati, bug U2 dell'audit).
  const isCurMonth = (today.getFullYear() === currentMonth.getFullYear() && today.getMonth() === currentMonth.getMonth());
  if (heroLabel) {
    heroLabel.textContent = isCurMonth
      ? 'Budget residuo questo mese (spese variabili)'
      : 'Budget residuo ' + monthLabel(currentMonth) + ' (spese variabili)';
  }
  if (totBudget > 0) {
    heroEl.textContent = (residuo >= 0 ? '' : '-') + fmtEUR(Math.abs(residuo)) + ' €';
    heroEl.classList.toggle('hero-negative', residuo < 0);
    if (heroCard) heroCard.classList.toggle('hero-card-negative', residuo < 0);
    if (residuo < 0) {
      heroSub.textContent = 'Tetto superato di ' + fmtEUR(Math.abs(residuo)) + ' €.';
      heroSub.classList.remove('hidden');
    } else {
      heroSub.textContent = '';
      heroSub.classList.add('hidden');
    }
  } else {
    heroEl.textContent = fmtEUR(totalVariable) + ' €';
    heroEl.classList.remove('hero-negative');
    if (heroCard) heroCard.classList.remove('hero-card-negative');
    heroSub.textContent = 'Imposta i tetti dal tab Budget per vedere il residuo.';
    heroSub.classList.remove('hidden');
  }

  // Daily pace: quanto puoi spendere al giorno fino a fine mese (solo mese corrente)
  const heroPace = document.getElementById('hero-pace');
  const isCurrentMonth = (today.getFullYear() === currentMonth.getFullYear() && today.getMonth() === currentMonth.getMonth());
  if (isCurrentMonth && totBudget > 0 && residuo > 0) {
    const lastDay = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 0).getDate();
    const daysRemaining = lastDay - today.getDate() + 1; // incluso oggi
    const dailyPace = residuo / daysRemaining;
    const endDateStr = String(lastDay) + '/' + String(currentMonth.getMonth() + 1).padStart(2, '0');
    const gg = daysRemaining === 1 ? '1 giorno' : daysRemaining + ' giorni';
    heroPace.innerHTML =
      '<span>Puoi spendere</span>' +
      '<span class="pace-value">' + fmtEUR(dailyPace) + ' €/giorno</span>' +
      '<span class="pace-meta">fino al ' + endDateStr + ' (' + gg + ')</span>';
    heroPace.classList.remove('hidden');
  } else {
    heroPace.classList.add('hidden');
  }

  // Spese libere (categorie variabili senza tetto): mostrate a parte dal residuo
  // dei tetti. Cosi' si vede a colpo d'occhio quanto e' uscito in regali,
  // palestra, abbigliamento senza che eroda il budget delle altre categorie.
  const freeBox = document.getElementById('free-box');
  const freeDetails = CATEGORIES.filter(c => !c.fixed && !c.hidden && !(cachedCaps[c.id] > 0))
    .map(c => ({ c: c, amount: totals[c.id] || 0 }))
    .filter(x => x.amount > 0);
  if (freeBox) {
    if (freeDetails.length > 0) {
      freeBox.innerHTML =
        '<div class="fixed-box-head">' +
          '<div>' +
            '<div class="fixed-label">Spese libere del mese (senza tetto)</div>' +
            '<div class="fixed-total">' + fmtEUR(totalFree) + ' €</div>' +
          '</div>' +
          '<div class="fixed-toggle" aria-hidden="true">&#9662;</div>' +
        '</div>' +
        '<div class="fixed-breakdown">' +
        freeDetails.map(x =>
          '<span class="fixed-pill" style="background:' + x.c.color + '">' +
          escapeHtml(x.c.name) + ': ' + fmtEUR(x.amount) + ' €</span>'
        ).join('') +
        '</div>';
      freeBox.classList.remove('hidden');
    } else {
      freeBox.classList.add('hidden');
    }
  }

  // Spese fisse mensili (collapsible: solo totale, click per dettaglio)
  const fixedBox = document.getElementById('fixed-box');
  const fixedDetails = CATEGORIES.filter(c => c.fixed && !c.hidden)
    .map(c => ({ c: c, amount: totals[c.id] || 0 }))
    .filter(x => x.amount > 0);
  if (fixedDetails.length > 0) {
    fixedBox.innerHTML =
      '<div class="fixed-box-head">' +
        '<div>' +
          '<div class="fixed-label">Spese fisse del mese</div>' +
          '<div class="fixed-total">' + fmtEUR(totalFixed) + ' €</div>' +
        '</div>' +
        '<div class="fixed-toggle" aria-hidden="true">&#9662;</div>' +
      '</div>' +
      '<div class="fixed-breakdown">' +
      fixedDetails.map(x =>
        '<span class="fixed-pill" style="background:' + x.c.color + '">' +
        escapeHtml(x.c.name) + ': ' + fmtEUR(x.amount) + ' €</span>'
      ).join('') +
      '</div>';
    fixedBox.classList.remove('hidden');
  } else {
    fixedBox.classList.add('hidden');
  }

  // Quadro mensile (piano)
  const quadroBox = document.getElementById('quadro-box');
  const entrateTot = cachedIncome.reduce((a, i) => a + (i.amount || 0), 0);
  const fissiAttesi = cachedRecurring.filter(r => r.active).reduce((a, r) => a + (r.amount || 0), 0);
  const tettiVariabili = CATEGORIES.filter(c => !c.fixed && !c.hidden).reduce((a, c) => a + (cachedCaps[c.id] || 0), 0);
  const accantonamentiTot = cachedSinking.reduce((a, s) => a + (s.amount || 0), 0);
  const margineTeorico = entrateTot - fissiAttesi - tettiVariabili - accantonamentiTot;
  const marginClass = margineTeorico >= 0 ? 'quadro-good' : 'quadro-bad';
  if (entrateTot > 0) {
    quadroBox.classList.remove('hidden');
    quadroBox.innerHTML =
      '<div class="quadro-title">Quadro mensile (piano)</div>' +
      '<div class="quadro-rows">' +
        '<div class="quadro-row"><span>Entrate stimate</span><strong>' + fmtEUR(entrateTot) + ' €</strong></div>' +
        '<div class="quadro-row neg"><span>− Spese fisse attese</span><strong>' + fmtEUR(fissiAttesi) + ' €</strong></div>' +
        '<div class="quadro-row neg"><span>− Tetti variabili</span><strong>' + fmtEUR(tettiVariabili) + ' €</strong></div>' +
        '<div class="quadro-row neg"><span>− Accantonamenti</span><strong>' + fmtEUR(accantonamentiTot) + ' €</strong></div>' +
        '<div class="quadro-row quadro-margin ' + marginClass + '"><span>= Margine libero teorico</span><strong>' + (margineTeorico >= 0 ? '+' : '') + fmtEUR(margineTeorico) + ' €</strong></div>' +
      '</div>';
  } else {
    quadroBox.classList.add('hidden');
  }

  // KPI
  document.getElementById('kpi-speso').textContent = fmtEUR(totalVariable) + ' €';
  document.getElementById('kpi-tetto').textContent = totBudget > 0 ? fmtEUR(totBudget) + ' €' : 'n/d';
  document.getElementById('kpi-oggi').textContent = fmtEUR(totalToday) + ' €';

  // Categories list: solo variabili visibili
  const variableCats = CATEGORIES.filter(c => !c.fixed && !c.hidden);
  document.getElementById('categories-list').innerHTML = variableCats.map(c => {
    const speso = totals[c.id];
    const cap = cachedCaps[c.id] || 0;
    let pct, statusClass = '';
    if (cap > 0) {
      pct = Math.min((speso / cap) * 100, 100);
      if (speso >= cap) statusClass = 'cat-over';
      else if (speso >= cap * 0.8) statusClass = 'cat-warn';
    } else {
      const max = Math.max.apply(null, variableCats.map(vc => totals[vc.id]).concat([1]));
      pct = (speso / max) * 100;
    }
    // Formato pulito: "120,00 € / 300,00 €" oppure "120,00 € (libero)".
    const capText = cap > 0 ? ' / ' + fmtEUR(cap) + ' €' : ' (libero)';
    return '<div class="cat-row ' + statusClass + '">' +
      '<div class="cat-row-head">' +
      '<span class="cat-dot" style="background:' + c.color + '"></span>' +
      '<span class="cat-name">' + c.name + '</span>' +
      '<span class="cat-amount">' + fmtEUR(speso) + ' €' + capText + '</span>' +
      '</div>' +
      '<div class="cat-bar"><div class="cat-bar-fill" style="width:' + pct + '%;background:' + c.color + '"></div></div>' +
      '</div>';
  }).join('');
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
    c.innerHTML = '<p class="empty-msg">Nessun movimento manuale in questo mese. Spunta "Mostra abbonamenti" per vedere anche i ricorrenti automatici.</p>';
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
      (m.isRecurring ? '<span class="badge-recurring">ricorr.</span>' : '') +
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
    if (confirm('Eliminare il movimento da ' + fmtEUR(mov.amount) + ' €?')) {
      // Tombstone invece di rimozione: cosi' la cancellazione si propaga ai
      // dispositivi che avevano ancora la voce in locale, e non viene "resuscitata".
      const all = loadMovements().map(m => m.id === id ? { ...m, _deleted: true, _modTs: Date.now() } : m);
      const ok = saveMovements(all);
      if (!ok) { showToast('Errore: NON eliminato. Riprova.', true); return; }
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
    if (!name || !category || !day) { showToast('Compila nome, categoria e giorno.', true); return; }
    if (!(amount > 0)) { showToast('Inserisci un importo maggiore di zero.', true); return; }
    const recs = loadRecurring();
    const item = { id: uuid(), name: name, amount: amount, category: category, dayOfMonth: day, active: true, lastGeneratedMonth: null, _modTs: Date.now() };
    recs.push(item);
    const ok = saveRecurring(recs);
    if (!ok) { showToast('Errore: ricorrente NON salvata.', true); return; }
    cachedRecurring = recs;
    e.target.reset();
    renderRecurring();
    showToast('Ricorrente aggiunta');
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
    if (!ok) { showToast('Errore: modifica NON salvata.', true); return; }
    cachedRecurring = recs;
    closeEditRecurring();
    renderRecurring();
    renderMonth();
    showToast('Ricorrente aggiornata');
  });
  document.getElementById('cancel-edit-rec').addEventListener('click', closeEditRecurring);
  document.getElementById('delete-edit-rec').addEventListener('click', function () {
    if (!editingRecurringId) return;
    const rec = cachedRecurring.find(r => r.id === editingRecurringId);
    if (!rec) return;
    if (confirm('Eliminare "' + rec.name + '"? I movimenti gia generati restano nei movimenti.')) {
      // Tombstone per propagare la cancellazione.
      const all = loadRecurring().map(r => r.id === editingRecurringId ? { ...r, _deleted: true, _modTs: Date.now() } : r);
      const ok = saveRecurring(all);
      if (!ok) { showToast('Errore: NON eliminato.', true); return; }
      cachedRecurring = activeOnly(all);
      closeEditRecurring();
      renderRecurring();
      renderMonth();
      showToast('Ricorrente eliminata');
    }
  });
}

function renderRecurring() {
  const list = document.getElementById('recurring-list');
  if (cachedRecurring.length === 0) {
    list.innerHTML = '<p class="empty-msg">Nessuna spesa ricorrente configurata.</p>';
    return;
  }
  const sorted = cachedRecurring.slice().sort((a, b) => (a.dayOfMonth || 0) - (b.dayOfMonth || 0));
  list.innerHTML = sorted.map(rec => {
    const cat = getCategory(rec.category);
    return '<div class="recurring-item ' + (rec.active ? '' : 'inactive') + '" data-id="' + rec.id + '">' +
      '<div class="recurring-info">' +
      '<div class="recurring-name">' + escapeHtml(rec.name) + '</div>' +
      '<div class="recurring-meta">' +
      '<span class="cat-badge" style="background:' + (cat ? cat.color : '#888') + '">' + escapeHtml(cat ? cat.name : '?') + '</span>' +
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
// BUDGET (tetti + sinking)
// ============================================================
function renderCaps() {
  const c = document.getElementById('caps-list');
  c.innerHTML = CATEGORIES.filter(cat => !cat.fixed && !cat.hidden).map(cat =>
    '<div class="cap-row">' +
    '<span class="cap-dot" style="background:' + cat.color + '"></span>' +
    '<label class="cap-label">' + cat.name + '</label>' +
    '<input type="number" step="1" min="0" data-id="' + cat.id + '" class="cap-input" value="' + (cachedCaps[cat.id] || 0) + '" inputmode="numeric" />' +
    '<span class="cap-unit">€/mese</span>' +
    '</div>'
  ).join('');
}

function bindBudget() {
  document.getElementById('save-caps').addEventListener('click', function () {
    const inputs = document.querySelectorAll('.cap-input');
    const values = { ...cachedCaps };
    // Math.max(0, ...): un tetto negativo (il bottone e' fuori dal form, il min=0
    // HTML non viene validato) falserebbe il residuo. Bug B10 dell'audit.
    inputs.forEach(i => { values[i.dataset.id] = Math.max(0, parseFloat(i.value) || 0); });
    CATEGORIES.forEach(c => { if (c.fixed) values[c.id] = 0; });
    saveCaps(values);
    cachedCaps = values;
    renderMonth();
    showToast('Tetti salvati');
  });

  document.getElementById('sinking-form').addEventListener('submit', function (e) {
    e.preventDefault();
    const name = document.getElementById('sink-name').value.trim();
    const amount = parseFloat(document.getElementById('sink-amount').value);
    const note = document.getElementById('sink-note').value.trim();
    if (!name) { showToast('Inserisci un nome.', true); return; }
    if (!(amount > 0)) { showToast('Inserisci un importo maggiore di zero.', true); return; }
    cachedSinking.push({ id: uuid(), name: name, amount: amount, note: note, _modTs: Date.now() });
    const ok = saveSinking(cachedSinking);
    if (!ok) { showToast('Errore: NON salvato.', true); return; }
    e.target.reset();
    renderSinking();
    showToast('Accantonamento aggiunto');
  });

  document.getElementById('sinking-list').addEventListener('click', function (e) {
    const btn = e.target.closest('[data-action="del-sink"]');
    if (!btn) return;
    const id = btn.dataset.id;
    const it = cachedSinking.find(s => s.id === id);
    if (it && confirm('Eliminare "' + it.name + '"?')) {
      // Tombstone su localStorage, cache rimuove solo l'attivo.
      const all = loadSinking().map(s => s.id === id ? { ...s, _deleted: true, _modTs: Date.now() } : s);
      const ok = saveSinking(all);
      if (!ok) { showToast('Errore: NON eliminato.', true); return; }
      cachedSinking = activeOnly(all);
      renderSinking();
    }
  });
}

function renderIncome() {
  const c = document.getElementById('income-list');
  if (cachedIncome.length === 0) {
    c.innerHTML = '<p class="empty-msg">Nessuna entrata configurata.</p>';
    return;
  }
  const totale = cachedIncome.reduce((a, s) => a + (s.amount || 0), 0);
  c.innerHTML = '<div class="sink-total income-total">Totale entrate stimate: <strong>' + fmtEUR(totale) + ' &euro;/mese</strong></div>' +
    cachedIncome.map(s =>
      '<div class="sink-item sink-item-clickable" data-id="' + s.id + '">' +
      '<div class="sink-info">' +
      '<div class="sink-name">' + escapeHtml(s.name) + '</div>' +
      (s.note ? '<div class="sink-note">' + escapeHtml(s.note) + '</div>' : '') +
      '</div>' +
      '<div class="sink-amount">' + fmtEUR(s.amount) + ' &euro;</div>' +
      '<button class="btn-small" data-action="edit-income" data-id="' + s.id + '">Modifica</button>' +
      '</div>'
    ).join('');
}

function bindIncome() {
  document.getElementById('income-form').addEventListener('submit', function (e) {
    e.preventDefault();
    const name = document.getElementById('inc-name').value.trim();
    const amount = parseFloat(document.getElementById('inc-amount').value);
    const note = document.getElementById('inc-note').value.trim();
    if (!name) { showToast('Inserisci un nome.', true); return; }
    if (!(amount > 0)) { showToast('Inserisci un importo maggiore di zero.', true); return; }
    cachedIncome.push({ id: uuid(), name: name, amount: amount, note: note, _modTs: Date.now() });
    const ok = saveIncome(cachedIncome);
    if (!ok) { showToast('Errore: NON salvato.', true); return; }
    e.target.reset();
    renderIncome();
    renderMonth();
    showToast('Entrata aggiunta');
  });

  document.getElementById('income-list').addEventListener('click', function (e) {
    const editBtn = e.target.closest('[data-action="edit-income"]');
    if (editBtn) { openEditIncome(editBtn.dataset.id); return; }
    const item = e.target.closest('.sink-item-clickable');
    if (item && item.dataset.id) {
      openEditIncome(item.dataset.id);
    }
  });
}

let editingIncomeId = null;
function openEditIncome(id) {
  const inc = cachedIncome.find(s => s.id === id);
  if (!inc) return;
  editingIncomeId = id;
  document.getElementById('edit-inc-name-input').value = inc.name;
  document.getElementById('edit-inc-amount-input').value = inc.amount;
  document.getElementById('edit-inc-note-input').value = inc.note || '';
  document.getElementById('edit-income-modal').classList.remove('hidden');
}
function closeEditIncome() {
  editingIncomeId = null;
  document.getElementById('edit-income-modal').classList.add('hidden');
}
function bindEditIncome() {
  document.getElementById('edit-inc-form').addEventListener('submit', function (e) {
    e.preventDefault();
    if (!editingIncomeId) return;
    const inc = cachedIncome.find(s => s.id === editingIncomeId);
    if (!inc) return;
    const newIncAmount = parseFloat(document.getElementById('edit-inc-amount-input').value);
    inc.name = document.getElementById('edit-inc-name-input').value.trim() || inc.name;
    inc.amount = isNaN(newIncAmount) ? inc.amount : newIncAmount;
    inc.note = document.getElementById('edit-inc-note-input').value.trim();
    inc._modTs = Date.now();
    const ok = saveIncome(cachedIncome);
    if (!ok) { showToast('Errore: modifica NON salvata.', true); return; }
    closeEditIncome();
    renderIncome();
    renderMonth();
    showToast('Entrata aggiornata');
  });
  document.getElementById('cancel-edit-inc').addEventListener('click', closeEditIncome);
  document.getElementById('delete-edit-inc').addEventListener('click', function () {
    if (!editingIncomeId) return;
    const inc = cachedIncome.find(s => s.id === editingIncomeId);
    if (!inc) return;
    if (confirm('Eliminare "' + inc.name + '"?')) {
      const all = loadIncome().map(s => s.id === editingIncomeId ? { ...s, _deleted: true, _modTs: Date.now() } : s);
      const ok = saveIncome(all);
      if (!ok) { showToast('Errore: NON eliminato.', true); return; }
      cachedIncome = activeOnly(all);
      closeEditIncome();
      renderIncome();
      renderMonth();
      showToast('Entrata eliminata');
    }
  });
}

function renderSinking() {
  const c = document.getElementById('sinking-list');
  if (cachedSinking.length === 0) {
    c.innerHTML = '<p class="empty-msg">Nessun accantonamento configurato.</p>';
    return;
  }
  const totale = cachedSinking.reduce((a, s) => a + (s.amount || 0), 0);
  c.innerHTML = '<div class="sink-total">Totale accantonamenti: <strong>' + fmtEUR(totale) + ' €/mese</strong></div>' +
    cachedSinking.map(s =>
      '<div class="sink-item">' +
      '<div class="sink-info">' +
      '<div class="sink-name">' + escapeHtml(s.name) + '</div>' +
      (s.note ? '<div class="sink-note">' + escapeHtml(s.note) + '</div>' : '') +
      '</div>' +
      '<div class="sink-amount">' + fmtEUR(s.amount) + ' €</div>' +
      '<button class="btn-small btn-danger" data-action="del-sink" data-id="' + s.id + '" aria-label="Elimina">&times;</button>' +
      '</div>'
    ).join('');
}

// ============================================================
// NAV
// ============================================================
const screenTitles = {
  'month-screen': 'Dashboard',
  'movements-screen': 'Movimenti',
  'recurring-screen': 'Spese ricorrenti',
  'budget-screen': 'Budget e accantonamenti'
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
  const visible = CATEGORIES.filter(c => !c.hidden);
  const options = visible.map(c => '<option value="' + c.id + '">' + c.name + '</option>').join('');
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
    if (!confirm('Uscire dall\'account? Dovrai rifare login con email e password.')) return;
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
  ensureRecurringForMonth();
  cachedRecurring = activeOnly(loadRecurring());
  cachedMovements = filterMovementsByMonth(currentMonth);
  cachedCaps = loadCaps();
  cachedSinking = activeOnly(loadSinking());
  cachedIncome = activeOnly(loadIncome());
  document.getElementById('add-date').value = todayISO();
  renderMonth();
  renderMovements();
  renderRecurring();
  renderCaps();
  renderSinking();
  renderIncome();
}

function bindFixedBox() {
  ['fixed-box', 'free-box'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('click', function () {
      el.classList.toggle('fixed-box-expanded');
    });
  });
}

function bindModalBackdrops() {
  const pairs = [
    ['add-modal', closeAddModal],
    ['edit-recurring-modal', closeEditRecurring],
    ['edit-income-modal', closeEditIncome],
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
  bindBudget();
  bindIncome();
  bindEditRecurring();
  bindEditIncome();
  bindFixedBox();
  bindModalBackdrops();
  bindNav();
  bindLogout();
  bindUnloadFlush();
  bindFbLogin();
  bindUpdateBanner();

  initFirebaseAuth(afterFbAuth);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
