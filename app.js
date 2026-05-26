// ============================================================
// Budget Familiare - localStorage + sync Firebase Realtime DB
// (stesso progetto agenda-f3298, nodo /budget separato)
// ============================================================

const STORAGE_PREFIX = 'bf_';
const PIN = '020597';
const FB_URL = 'https://agenda-f3298-default-rtdb.europe-west1.firebasedatabase.app/budget.json';
const SYNC_KEYS = ['movements', 'recurring', 'caps', 'sinking', 'income'];
let syncEnabled = true;
let syncInProgress = false;

const CATEGORIES = [
  { id: 'spesa-casa', name: 'Spesa + casa', color: '#16a34a', fixed: false },
  { id: 'benzina', name: 'Benzina', color: '#d97706', fixed: false },
  { id: 'animali', name: 'Animali', color: '#9333ea', fixed: false },
  { id: 'sfizi', name: 'Sfizi e uscite', color: '#dc2626', fixed: false },
  { id: 'abbonamenti', name: 'Abbonamenti streaming/SaaS', color: '#2563eb', fixed: true },
  { id: 'casa-gas', name: 'Casa - bombola gas', color: '#0d9488', fixed: true },
  { id: 'casa-pulizia', name: 'Casa - pulizia signora', color: '#0891b2', fixed: true },
  { id: 'cura-personale', name: 'Cura personale', color: '#be185d', fixed: true },
  { id: 'vacanze', name: 'Vacanze/viaggi', color: '#475569', fixed: false, hidden: true }
];

const DEFAULT_CAPS = {
  'spesa-casa': 400,
  'benzina': 100,
  'animali': 120,
  'sfizi': 200,
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
  { id: 's-auto', name: 'Sinking auto', amount: 75, note: 'Ass. luglio + gennaio, bollo settembre, revisione gennaio 2027' },
  { id: 's-palestra', name: 'Sinking palestra', amount: 13, note: '300 € ogni 2 anni' },
  { id: 's-emergenza', name: 'Fondo emergenza', amount: 200, note: 'Bonifico su conto deposito separato' }
];

const DEFAULT_RECURRING = [
  { name: 'OpenAI ChatGPT Plus', amount: 21, category: 'abbonamenti', dayOfMonth: 24 },
  { name: 'Apple #1', amount: 9.99, category: 'abbonamenti', dayOfMonth: 5 },
  { name: 'Apple #2', amount: 9.99, category: 'abbonamenti', dayOfMonth: 19 },
  { name: 'CapCut Pro', amount: 11.99, category: 'abbonamenti', dayOfMonth: 6 },
  { name: 'Telecom Italia', amount: 10.97, category: 'abbonamenti', dayOfMonth: 17 },
  { name: 'Iliad', amount: 7.99, category: 'abbonamenti', dayOfMonth: 20 },
  { name: 'Netflix', amount: 6.99, category: 'abbonamenti', dayOfMonth: 25 },
  { name: 'Disney+', amount: 6.99, category: 'abbonamenti', dayOfMonth: 17 },
  { name: 'HBO Max', amount: 5.99, category: 'abbonamenti', dayOfMonth: 11 },
  { name: 'Canone conto Intesa', amount: 3.95, category: 'abbonamenti', dayOfMonth: 28 },
  { name: 'Bombola gas (media)', amount: 45, category: 'casa-gas', dayOfMonth: 15 },
  { name: 'Signora delle pulizie', amount: 64, category: 'casa-pulizia', dayOfMonth: 1 },
  { name: 'Barbiere', amount: 30, category: 'cura-personale', dayOfMonth: 1 },
  { name: 'Mich cura di sé', amount: 60, category: 'cura-personale', dayOfMonth: 1 }
];

const MIN_MONTH = new Date(2026, 4, 1); // maggio 2026 (mese 4 = maggio, 0-indexed)

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
  localStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(value));
  localStorage.setItem(STORAGE_PREFIX + '_ts', String(Date.now()));
}

function loadMovements() { return lsRead('movements', []); }
function saveMovements(arr) { lsWrite('movements', arr); schedulePush(); }
function loadRecurring() {
  let arr = lsRead('recurring', null);
  if (arr === null) {
    arr = DEFAULT_RECURRING.map(r => ({
      id: uuid(),
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
function saveRecurring(arr) { lsWrite('recurring', arr); schedulePush(); }
function loadCaps() { return lsRead('caps', { ...DEFAULT_CAPS }); }
function saveCaps(obj) { lsWrite('caps', obj); schedulePush(); }
function loadSinking() { return lsRead('sinking', [...DEFAULT_SINKING]); }
function saveSinking(arr) { lsWrite('sinking', arr); schedulePush(); }
function loadIncome() { return lsRead('income', [...DEFAULT_INCOME]); }
function saveIncome(arr) { lsWrite('income', arr); schedulePush(); }

// ============================================================
// FIREBASE SYNC (Realtime DB via REST)
// ============================================================
function setSyncStatus(text, isError) {
  const banner = document.getElementById('sync-banner');
  const status = document.getElementById('sync-status');
  if (!banner || !status) return;
  banner.classList.remove('hidden');
  banner.classList.toggle('sync-error', !!isError);
  status.textContent = text;
  if (!isError) {
    setTimeout(() => banner.classList.add('hidden'), 2000);
  }
}

function buildPayload() {
  const payload = { _ts: Date.now() };
  for (const k of SYNC_KEYS) {
    const v = lsRead(k, null);
    payload[k] = v ? JSON.stringify(v) : null;
  }
  return payload;
}

function applyRemotePayload(remote) {
  if (!remote || typeof remote !== 'object') return false;
  let applied = false;
  for (const k of SYNC_KEYS) {
    if (remote[k]) {
      try {
        const parsed = JSON.parse(remote[k]);
        lsWrite(k, parsed);
        applied = true;
      } catch (e) {}
    }
  }
  return applied;
}

async function fbPull() {
  if (!syncEnabled) return null;
  setSyncStatus('Sync in corso...');
  try {
    const r = await fetch(FB_URL);
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const data = await r.json();
    setSyncStatus('Sincronizzato');
    return data;
  } catch (e) {
    setSyncStatus('Errore sync (offline)', true);
    console.warn('Pull failed:', e);
    return null;
  }
}

let pushTimer = null;
function schedulePush() {
  if (!syncEnabled) return;
  clearTimeout(pushTimer);
  pushTimer = setTimeout(fbPush, 800);
}

async function fbPush() {
  if (!syncEnabled || syncInProgress) return;
  syncInProgress = true;
  setSyncStatus('Salvataggio...');
  try {
    const payload = buildPayload();
    const r = await fetch(FB_URL, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    setSyncStatus('Sincronizzato');
  } catch (e) {
    setSyncStatus('Errore salvataggio', true);
    console.warn('Push failed:', e);
  } finally {
    syncInProgress = false;
  }
}

async function initialSync() {
  const remote = await fbPull();
  const localTs = parseInt(localStorage.getItem(STORAGE_PREFIX + '_ts') || '0', 10);
  if (remote && remote._ts && remote._ts > localTs) {
    const applied = applyRemotePayload(remote);
    if (applied) {
      localStorage.setItem(STORAGE_PREFIX + '_ts', String(remote._ts));
    }
  } else if (localTs > 0) {
    schedulePush();
  }
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

function migrateCategories() {
  // Step 1: vecchia 'bollette' -> 'abbonamenti' o 'casa-gas'
  // Step 2: vecchia 'casa-fisse' -> 'casa-gas'
  let touched = false;
  const movs = loadMovements();
  for (const m of movs) {
    if (m.category === 'bollette') {
      const txt = ((m.note || '') + ' ' + (m.name || '')).toLowerCase();
      m.category = txt.includes('bombola') || txt.includes('gas') ? 'casa-gas' : 'abbonamenti';
      touched = true;
    } else if (m.category === 'casa-fisse') {
      m.category = 'casa-gas';
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
      touchedR = true;
    } else if (r.category === 'casa-fisse') {
      r.category = 'casa-gas';
      touchedR = true;
    }
  }
  // Rinomina vecchia "Pulizia signora" in "Signora delle pulizie"
  for (const r of recs) {
    if (r.name === 'Pulizia signora') {
      r.name = 'Signora delle pulizie';
      touchedR = true;
    }
  }

  // Aggiungi nuovi ricorrenti default se mancano (per utenti esistenti)
  const hasPulizia = recs.some(r => r.category === 'casa-pulizia');
  const hasBarbiere = recs.some(r => r.category === 'cura-personale');
  if (!hasPulizia) {
    recs.push({ id: uuid(), name: 'Signora delle pulizie', amount: 64, category: 'casa-pulizia', dayOfMonth: 1, active: true, lastGeneratedMonth: null });
    touchedR = true;
  }
  if (!hasBarbiere) {
    recs.push({ id: uuid(), name: 'Barbiere', amount: 30, category: 'cura-personale', dayOfMonth: 1, active: true, lastGeneratedMonth: null });
    touchedR = true;
  }
  const hasMichCura = recs.some(r => r.name && r.name.toLowerCase().includes('mich'));
  if (!hasMichCura) {
    recs.push({ id: uuid(), name: 'Mich cura di sé', amount: 60, category: 'cura-personale', dayOfMonth: 1, active: true, lastGeneratedMonth: null });
    touchedR = true;
  }

  if (touchedR) lsWrite('recurring', recs);

  const caps = loadCaps();
  let touchedC = false;
  if ('bollette' in caps) { delete caps.bollette; touchedC = true; }
  if ('casa-fisse' in caps) { delete caps['casa-fisse']; touchedC = true; }
  for (const id of ['abbonamenti', 'casa-gas', 'casa-pulizia', 'cura-personale']) {
    if (!(id in caps)) { caps[id] = 0; touchedC = true; }
  }
  if (touchedC) lsWrite('caps', caps);
}

function filterMovementsByMonth(month) {
  const start = +new Date(month);
  const end = +new Date(new Date(month).setMonth(month.getMonth() + 1));
  return loadMovements()
    .filter(m => { const t = +new Date(m.date); return t >= start && t < end; })
    .sort((a, b) => +new Date(b.date) - +new Date(a.date));
}

// ============================================================
// RICORRENTI: generazione automatica del mese corrente
// ============================================================
function ensureRecurringForMonth() {
  const now = new Date();
  const mk = monthKey(now);
  const recs = loadRecurring();
  const movs = loadMovements();
  let touched = false;
  for (const rec of recs) {
    if (!rec.active) continue;
    if (rec.lastGeneratedMonth === mk) continue;
    const day = Math.min(Math.max(parseInt(rec.dayOfMonth) || 1, 1), 28);
    const movDate = new Date(now.getFullYear(), now.getMonth(), day, 12, 0, 0);
    movs.push({
      id: uuid(),
      date: movDate.toISOString(),
      amount: rec.amount,
      category: rec.category,
      note: rec.name + ' (ricorrente)',
      isRecurring: true,
      recurringId: rec.id
    });
    rec.lastGeneratedMonth = mk;
    touched = true;
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
    if (!dateStr || !amount || !category) return;
    const movs = loadMovements();
    movs.push({
      id: uuid(),
      date: dateFromISO(dateStr).toISOString(),
      amount: amount,
      category: category,
      note: note,
      isRecurring: false
    });
    saveMovements(movs);
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
    if (data.length === 0) { alert('Aggiungi almeno una riga con importo e categoria.'); return; }
    const splitGroupId = uuid();
    const movs = loadMovements();
    for (const row of data) {
      movs.push({
        id: uuid(),
        date: dateFromISO(dateStr).toISOString(),
        amount: row.amount,
        category: row.category,
        note: note ? note + ' (split)' : 'split',
        isRecurring: false,
        splitGroupId: splitGroupId
      });
    }
    saveMovements(movs);
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
    currentMonth.setMonth(currentMonth.getMonth() + 1);
    cachedMovements = filterMovementsByMonth(currentMonth);
    renderMonth(); renderMovements();
  });
}

function updateMonthNavState() {
  const prev = new Date(currentMonth);
  prev.setMonth(prev.getMonth() - 1);
  const btn = document.getElementById('prev-month');
  if (prev < MIN_MONTH) {
    btn.classList.add('disabled');
    btn.setAttribute('aria-disabled', 'true');
  } else {
    btn.classList.remove('disabled');
    btn.removeAttribute('aria-disabled');
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
    const mDate = new Date(m.date);
    const dStr = mDate.toISOString().slice(0, 10);
    if (dStr === todayStr) totalToday += m.amount;
  }

  // Tetto su solo variabili
  let totBudget = 0;
  for (const c of CATEGORIES) {
    if (!c.fixed) totBudget += (cachedCaps[c.id] || 0);
  }
  const residuo = totBudget - totalVariable;

  // HERO (su variabili)
  const heroEl = document.getElementById('hero-residuo');
  const heroSub = document.getElementById('hero-sub');
  if (totBudget > 0) {
    heroEl.textContent = (residuo >= 0 ? '' : '-') + fmtEUR(Math.abs(residuo)) + ' €';
    heroEl.classList.toggle('hero-negative', residuo < 0);
    let sub = 'Su ' + fmtEUR(totBudget) + ' € di tetto variabili. Speso ' + fmtEUR(totalVariable) + ' €';
    sub += '.';
    if (residuo < 0) sub = 'Tetto superato di ' + fmtEUR(Math.abs(residuo)) + ' €. ' + sub;
    heroSub.textContent = sub;
  } else {
    heroEl.textContent = fmtEUR(totalVariable) + ' €';
    heroEl.classList.remove('hero-negative');
    heroSub.textContent = 'Spese variabili del mese. Imposta i tetti dal tab Budget per vedere il residuo.';
  }

  // Spese fisse mensili
  const fixedBox = document.getElementById('fixed-box');
  const fixedDetails = CATEGORIES.filter(c => c.fixed && !c.hidden)
    .map(c => ({ c: c, amount: totals[c.id] || 0 }))
    .filter(x => x.amount > 0);
  if (fixedDetails.length > 0) {
    fixedBox.innerHTML =
      '<div class="fixed-label">Spese fisse del mese</div>' +
      '<div class="fixed-total">' + fmtEUR(totalFixed) + ' €</div>' +
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
  document.getElementById('kpi-tetto').textContent = totBudget > 0 ? fmtEUR(totBudget) + ' €' : '—';
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
    const capText = cap > 0 ? '/ ' + fmtEUR(cap) : '(libero)';
    return '<div class="cat-row ' + statusClass + '">' +
      '<div class="cat-row-head">' +
      '<span class="cat-dot" style="background:' + c.color + '"></span>' +
      '<span class="cat-name">' + c.name + '</span>' +
      '<span class="cat-amount">' + fmtEUR(speso) + ' ' + capText + ' €</span>' +
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
  document.getElementById('movements-list').addEventListener('click', function (e) {
    const btn = e.target.closest('.movement-delete');
    if (!btn) return;
    const id = btn.dataset.id;
    const mov = cachedMovements.find(m => m.id === id);
    if (!mov) return;
    if (confirm('Eliminare il movimento da ' + fmtEUR(mov.amount) + ' €?')) {
      const all = loadMovements().filter(m => m.id !== id);
      saveMovements(all);
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
    if (!name || !amount || !category || !day) return;
    const recs = loadRecurring();
    const item = { id: uuid(), name: name, amount: amount, category: category, dayOfMonth: day, active: true, lastGeneratedMonth: null };
    recs.push(item);
    saveRecurring(recs);
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
    rec.name = document.getElementById('edit-rec-name').value.trim() || rec.name;
    rec.amount = parseFloat(document.getElementById('edit-rec-amount').value) || rec.amount;
    rec.category = document.getElementById('edit-rec-category').value || rec.category;
    rec.dayOfMonth = parseInt(document.getElementById('edit-rec-day').value) || rec.dayOfMonth;
    saveRecurring(recs);
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
      const filtered = loadRecurring().filter(r => r.id !== editingRecurringId);
      saveRecurring(filtered);
      cachedRecurring = filtered;
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
    inputs.forEach(i => { values[i.dataset.id] = parseFloat(i.value) || 0; });
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
    if (!name || !amount) return;
    cachedSinking.push({ id: uuid(), name: name, amount: amount, note: note });
    saveSinking(cachedSinking);
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
      cachedSinking = cachedSinking.filter(s => s.id !== id);
      saveSinking(cachedSinking);
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
    if (!name || !amount) return;
    cachedIncome.push({ id: uuid(), name: name, amount: amount, note: note });
    saveIncome(cachedIncome);
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
    inc.name = document.getElementById('edit-inc-name-input').value.trim() || inc.name;
    inc.amount = parseFloat(document.getElementById('edit-inc-amount-input').value) || inc.amount;
    inc.note = document.getElementById('edit-inc-note-input').value.trim();
    saveIncome(cachedIncome);
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
      cachedIncome = cachedIncome.filter(s => s.id !== editingIncomeId);
      saveIncome(cachedIncome);
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
function showPinScreen() {
  document.getElementById('pin-screen').classList.remove('hidden');
  document.getElementById('app-container').classList.add('hidden');
  setTimeout(() => {
    const inp = document.getElementById('pin-input');
    if (inp) inp.focus();
  }, 100);
}

function showApp() {
  document.getElementById('pin-screen').classList.add('hidden');
  document.getElementById('app-container').classList.remove('hidden');
}

function bindPin() {
  document.getElementById('pin-form').addEventListener('submit', function (e) {
    e.preventDefault();
    const v = document.getElementById('pin-input').value.trim();
    if (v === PIN) {
      sessionStorage.setItem('bf_unlocked', '1');
      document.getElementById('pin-input').value = '';
      document.getElementById('pin-error').textContent = '';
      startApp();
    } else {
      document.getElementById('pin-error').textContent = 'PIN errato';
      document.getElementById('pin-input').value = '';
    }
  });
}

function bindLogout() {
  const btn = document.getElementById('logout-btn');
  if (!btn) return;
  btn.addEventListener('click', function () {
    if (confirm('Bloccare l\'app?')) {
      sessionStorage.removeItem('bf_unlocked');
      showPinScreen();
    }
  });
}

async function startApp() {
  showApp();
  await initialSync();
  migrateCategories();
  cachedRecurring = loadRecurring();
  ensureRecurringForMonth();
  cachedRecurring = loadRecurring();
  cachedMovements = filterMovementsByMonth(currentMonth);
  cachedCaps = loadCaps();
  cachedSinking = loadSinking();
  cachedIncome = loadIncome();
  document.getElementById('add-date').value = todayISO();
  renderMonth();
  renderMovements();
  renderRecurring();
  renderCaps();
  renderSinking();
  renderIncome();
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
  bindNav();
  bindPin();
  bindLogout();

  if (sessionStorage.getItem('bf_unlocked') === '1') {
    startApp();
  } else {
    showPinScreen();
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
