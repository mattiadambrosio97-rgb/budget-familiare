// ============================================================
// Budget Familiare - localStorage + sync Firebase Realtime DB
// (stesso progetto agenda-f3298, nodo /budget separato)
// ============================================================

const STORAGE_PREFIX = 'bf_';
const PIN = '020597';
const FB_URL = 'https://agenda-f3298-default-rtdb.europe-west1.firebasedatabase.app/budget.json';
const SYNC_KEYS = ['movements', 'recurring', 'caps', 'sinking'];
let syncEnabled = true;
let syncInProgress = false;

const CATEGORIES = [
  { id: 'spesa-casa', name: 'Spesa + casa', color: '#22c55e' },
  { id: 'benzina', name: 'Benzina', color: '#f59e0b' },
  { id: 'bollette', name: 'Bollette/abbonamenti', color: '#3b82f6' },
  { id: 'animali', name: 'Animali', color: '#a855f7' },
  { id: 'sfizi', name: 'Sfizi e uscite', color: '#ef4444' },
  { id: 'vacanze', name: 'Vacanze/viaggi', color: '#06b6d4' }
];

const DEFAULT_CAPS = {
  'spesa-casa': 400,
  'benzina': 100,
  'bollette': 110,
  'animali': 120,
  'sfizi': 0,
  'vacanze': 0
};

const DEFAULT_SINKING = [
  { id: 's-auto', name: 'Sinking auto', amount: 75, note: 'Ass. luglio + gennaio, bollo settembre, revisione gennaio 2027' },
  { id: 's-emergenza', name: 'Fondo emergenza', amount: 200, note: 'Bonifico su conto deposito separato' }
];

// ============================================================
// STATE
// ============================================================
let currentMonth = startOfMonth(new Date());
let cachedMovements = [];
let cachedRecurring = [];
let cachedCaps = { ...DEFAULT_CAPS };
let cachedSinking = [...DEFAULT_SINKING];

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
function loadRecurring() { return lsRead('recurring', []); }
function saveRecurring(arr) { lsWrite('recurring', arr); schedulePush(); }
function loadCaps() { return lsRead('caps', { ...DEFAULT_CAPS }); }
function saveCaps(obj) { lsWrite('caps', obj); schedulePush(); }
function loadSinking() { return lsRead('sinking', [...DEFAULT_SINKING]); }
function saveSinking(arr) { lsWrite('sinking', arr); schedulePush(); }

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
function bindAdd() {
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
    e.target.reset();
    document.getElementById('add-date').value = todayISO();
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
    document.getElementById('add-form').reset();
    document.getElementById('add-date').value = todayISO();
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
    currentMonth.setMonth(currentMonth.getMonth() - 1);
    cachedMovements = filterMovementsByMonth(currentMonth);
    renderMonth(); renderMovements();
  });
  document.getElementById('next-month').addEventListener('click', function () {
    currentMonth.setMonth(currentMonth.getMonth() + 1);
    cachedMovements = filterMovementsByMonth(currentMonth);
    renderMonth(); renderMovements();
  });
}

function renderMonth() {
  document.getElementById('month-label').textContent = monthLabel(currentMonth);
  const totals = {};
  const counts = {};
  CATEGORIES.forEach(c => { totals[c.id] = 0; counts[c.id] = 0; });
  let total = 0;
  for (const m of cachedMovements) {
    totals[m.category] = (totals[m.category] || 0) + m.amount;
    counts[m.category] = (counts[m.category] || 0) + 1;
    total += m.amount;
  }
  document.getElementById('month-total').textContent = fmtEUR(total) + ' €';
  document.getElementById('month-count').textContent = cachedMovements.length;

  const totBudget = Object.values(cachedCaps).reduce((a, b) => a + (b || 0), 0);
  document.getElementById('month-budget').textContent = totBudget > 0 ? fmtEUR(totBudget) + ' €' : '—';
  const residuo = totBudget - total;
  const resEl = document.getElementById('month-residuo');
  if (totBudget > 0) {
    resEl.textContent = (residuo >= 0 ? '+' : '') + fmtEUR(residuo) + ' €';
    resEl.style.color = residuo >= 0 ? '#22c55e' : '#ef4444';
  } else {
    resEl.textContent = '—';
    resEl.style.color = '';
  }

  document.getElementById('categories-list').innerHTML = CATEGORIES.map(c => {
    const speso = totals[c.id];
    const cap = cachedCaps[c.id] || 0;
    let pct, statusClass = '';
    if (cap > 0) {
      pct = Math.min((speso / cap) * 100, 100);
      if (speso >= cap) statusClass = 'cat-over';
      else if (speso >= cap * 0.8) statusClass = 'cat-warn';
    } else {
      const max = Math.max.apply(null, Object.values(totals).concat([1]));
      pct = (speso / max) * 100;
    }
    const capText = cap > 0 ? '/ ' + fmtEUR(cap) : '';
    return '<div class="cat-row ' + statusClass + '">' +
      '<div class="cat-row-head">' +
      '<span class="cat-dot" style="background:' + c.color + '"></span>' +
      '<span class="cat-name">' + c.name + '</span>' +
      '<span class="cat-count">' + counts[c.id] + '</span>' +
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
  let list = cachedMovements.slice();
  if (catFilter) list = list.filter(m => m.category === catFilter);
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
    if (!btn) return;
    const id = btn.dataset.id;
    const recs = loadRecurring();
    const rec = recs.find(r => r.id === id);
    if (!rec) return;
    if (btn.dataset.action === 'toggle') {
      rec.active = !rec.active;
      saveRecurring(recs);
      cachedRecurring = recs;
      renderRecurring();
    } else if (btn.dataset.action === 'delete') {
      if (confirm('Eliminare "' + rec.name + '"? I movimenti gia generati restano.')) {
        const filtered = recs.filter(r => r.id !== id);
        saveRecurring(filtered);
        cachedRecurring = filtered;
        renderRecurring();
      }
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
    return '<div class="recurring-item ' + (rec.active ? '' : 'inactive') + '">' +
      '<div class="recurring-info">' +
      '<div class="recurring-name">' + escapeHtml(rec.name) + '</div>' +
      '<div class="recurring-meta">' +
      '<span class="cat-badge" style="background:' + (cat ? cat.color : '#888') + '">' + escapeHtml(cat ? cat.name : '?') + '</span>' +
      '<span>giorno ' + rec.dayOfMonth + '</span>' +
      '</div>' +
      '</div>' +
      '<div class="recurring-amount">' + fmtEUR(rec.amount) + ' €</div>' +
      '<div class="recurring-actions">' +
      '<button data-action="toggle" data-id="' + rec.id + '" class="btn-small">' + (rec.active ? 'Disattiva' : 'Attiva') + '</button>' +
      '<button data-action="delete" data-id="' + rec.id + '" class="btn-small btn-danger">Elimina</button>' +
      '</div>' +
      '</div>';
  }).join('');
}

// ============================================================
// BUDGET (tetti + sinking)
// ============================================================
function renderCaps() {
  const c = document.getElementById('caps-list');
  c.innerHTML = CATEGORIES.map(cat =>
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
    const values = {};
    inputs.forEach(i => { values[i.dataset.id] = parseFloat(i.value) || 0; });
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
  'add-screen': 'Aggiungi spesa',
  'month-screen': 'Mese corrente',
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
  const options = CATEGORIES.map(c => '<option value="' + c.id + '">' + c.name + '</option>').join('');
  ['add-category', 'rec-category'].forEach(id => {
    document.getElementById(id).innerHTML = '<option value="">Seleziona...</option>' + options;
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
  document.getElementById('logout-btn').addEventListener('click', function () {
    if (confirm('Bloccare l\'app?')) {
      sessionStorage.removeItem('bf_unlocked');
      showPinScreen();
    }
  });
}

async function startApp() {
  showApp();
  await initialSync();
  cachedRecurring = loadRecurring();
  ensureRecurringForMonth();
  cachedRecurring = loadRecurring();
  cachedMovements = filterMovementsByMonth(currentMonth);
  cachedCaps = loadCaps();
  cachedSinking = loadSinking();
  document.getElementById('add-date').value = todayISO();
  renderMonth();
  renderMovements();
  renderRecurring();
  renderCaps();
  renderSinking();
}

function boot() {
  populateCategoryDropdowns();
  bindAdd();
  bindSplit();
  bindMonthNav();
  bindMovements();
  bindRecurring();
  bindBudget();
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
