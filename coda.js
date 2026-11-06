// Coda «Da processare»: note e foto lasciate nell'app quando Claude non è raggiungibile.
// Offline restano in IndexedDB sul telefono; con la rete salgono su /budget-inbox.
// Sta fuori da /budget, così le foto non appesantiscono la sincronizzazione.
// Claude le legge con budget_dati.py (coda-scarica) e le toglie dopo averle registrate.
const BudgetCoda = (function () {
  const DB_NAME = 'budget-coda';
  const STORE = 'voci';
  const BASE = 'https://agenda-f3298-default-rtdb.europe-west1.firebasedatabase.app/budget-inbox';
  const LATO_MAX = 1200;
  const PESO_MAX = 300 * 1024;
  let fotoScelta = null;
  let remote = [];
  let inCorso = false;

  function apriDb() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' });
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function operazione(modo, azione) {
    const db = await apriDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, modo);
      const req = azione(tx.objectStore(STORE));
      tx.oncomplete = () => { db.close(); resolve(req.result); };
      tx.onerror = () => { db.close(); reject(tx.error); };
    });
  }

  const leggiLocali = () => operazione('readonly', s => s.getAll());
  const salvaLocale = voce => operazione('readwrite', s => s.put(voce));
  const togliLocale = id => operazione('readwrite', s => s.delete(id));

  async function tokenParam() {
    if (typeof firebase === 'undefined' || !firebase.auth || !firebase.auth().currentUser) return null;
    return '?auth=' + await firebase.auth().currentUser.getIdToken();
  }

  async function richiesta(percorso, token, metodo, corpo) {
    const r = await fetch(BASE + percorso + '.json' + token, {
      method: metodo || 'GET',
      headers: { 'Content-Type': 'application/json' },
      body: corpo === undefined ? undefined : JSON.stringify(corpo)
    });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.json();
  }

  // Riduce la foto: nel database deve stare in poche centinaia di KB.
  async function comprimi(file) {
    const url = URL.createObjectURL(file);
    try {
      const img = await new Promise((resolve, reject) => {
        const i = new Image();
        i.onload = () => resolve(i);
        i.onerror = reject;
        i.src = url;
      });
      const scala = Math.min(1, LATO_MAX / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * scala);
      canvas.height = Math.round(img.height * scala);
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      let qualita = 0.75;
      let dati = canvas.toDataURL('image/jpeg', qualita);
      while (dati.length * 0.75 > PESO_MAX && qualita > 0.35) {
        qualita -= 0.1;
        dati = canvas.toDataURL('image/jpeg', qualita);
      }
      return dati;
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  // La foto sale prima della voce: Claude non trova mai una voce senza la sua foto.
  async function sincronizza() {
    if (inCorso) return;
    inCorso = true;
    try {
      const token = await tokenParam();
      if (token) {
        for (const voce of await leggiLocali()) {
          if (voce.photo) await richiesta('/foto/' + voce.id, token, 'PUT', voce.photo);
          await richiesta('/voci/' + voce.id, token, 'PUT', {
            id: voce.id, createdAt: voce.createdAt, text: voce.text, hasPhoto: !!voce.photo
          });
          await togliLocale(voce.id);
        }
        remote = Object.values(await richiesta('/voci', token) || {});
      }
    } catch (e) {
      console.warn('Coda non sincronizzata:', e);
    } finally {
      inCorso = false;
      await aggiornaVista();
    }
  }

  async function aggiornaVista() {
    let locali = [];
    try { locali = await leggiLocali(); } catch (e) {}
    const voci = locali.map(v => ({ id: v.id, createdAt: v.createdAt, text: v.text, hasPhoto: !!v.photo, locale: true }))
      .concat(remote.filter(r => !locali.some(l => l.id === r.id)))
      .sort((a, b) => b.createdAt - a.createdAt);
    const banner = document.getElementById('coda-banner');
    if (banner) {
      banner.textContent = voci.length === 1
        ? '1 voce da processare: non è inclusa nei numeri. Tocca per vederla.'
        : voci.length + ' voci da processare: non sono incluse nei numeri. Tocca per vederle.';
      banner.classList.toggle('hidden', voci.length === 0);
    }
    const lista = document.getElementById('coda-list');
    if (!lista) return;
    lista.innerHTML = voci.length ? voci.map(v =>
      '<div class="coda-item"><div class="coda-testo">' +
      '<div>' + (escapeHtml(v.text) || '<em>Solo foto</em>') + '</div>' +
      '<div class="coda-meta">' + new Date(v.createdAt).toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'short' }) +
      (v.hasPhoto ? ' · con foto' : '') + (v.locale ? ' · sul telefono, in attesa di rete' : '') + '</div></div>' +
      '<button type="button" class="btn-small btn-danger" data-coda-id="' + escapeHtml(v.id) + '" aria-label="Elimina">&times;</button></div>'
    ).join('') : '<p class="empty-msg">Niente da processare.</p>';
  }

  function chiudi() {
    document.getElementById('coda-modal').classList.add('hidden');
    document.getElementById('coda-form').reset();
    document.getElementById('coda-foto-nome').textContent = '';
    fotoScelta = null;
  }

  async function elimina(id) {
    if (!confirm('Eliminare questa voce?')) return;
    try {
      await togliLocale(id);
      if (remote.some(v => v.id === id)) {
        const token = await tokenParam();
        if (!token) { showToast('Serve la rete per eliminarla.', true); return; }
        await richiesta('', token, 'PATCH', { ['voci/' + id]: null, ['foto/' + id]: null });
        remote = remote.filter(v => v.id !== id);
      }
      await aggiornaVista();
    } catch (e) {
      showToast('Non sono riuscito a eliminarla. Riprova.', true);
    }
  }

  function bind() {
    const apri = () => {
      document.getElementById('coda-modal').classList.remove('hidden');
      aggiornaVista();
    };
    document.getElementById('coda-open-btn').addEventListener('click', apri);
    document.getElementById('coda-banner').addEventListener('click', apri);
    document.getElementById('coda-close').addEventListener('click', chiudi);
    document.getElementById('coda-foto').addEventListener('change', async function (e) {
      const file = e.target.files[0];
      fotoScelta = null;
      document.getElementById('coda-foto-nome').textContent = '';
      if (!file) return;
      try {
        fotoScelta = await comprimi(file);
        document.getElementById('coda-foto-nome').textContent = 'Foto pronta';
      } catch (err) {
        showToast('Questa foto non si riesce a leggere.', true);
      }
    });
    document.getElementById('coda-form').addEventListener('submit', async function (e) {
      e.preventDefault();
      const text = document.getElementById('coda-testo').value.trim();
      if (!text && !fotoScelta) { showToast('Scrivi una nota o aggiungi una foto.', true); return; }
      try {
        await salvaLocale({ id: 'c' + Date.now() + Math.random().toString(36).slice(2, 8), createdAt: Date.now(), text: text, photo: fotoScelta });
      } catch (err) {
        showToast('Errore: voce NON salvata. Riprova.', true);
        return;
      }
      document.getElementById('coda-form').reset();
      document.getElementById('coda-foto-nome').textContent = '';
      fotoScelta = null;
      showToast('Messo in coda');
      await aggiornaVista();
      sincronizza();
    });
    document.getElementById('coda-list').addEventListener('click', function (e) {
      const btn = e.target.closest('[data-coda-id]');
      if (btn) elimina(btn.dataset.codaId);
    });
    window.addEventListener('online', sincronizza);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') sincronizza();
    });
    aggiornaVista();
  }

  return { bind, sincronizza, chiudi };
})();
