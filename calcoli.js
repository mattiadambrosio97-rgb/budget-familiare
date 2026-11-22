// Calcoli del Budget: funzioni pure, usate dall'app e, via Node, da budget_dati.py.
// Una sola fonte per i numeri mostrati nell'app e per quelli scritti in chat.
//
// Il sistema (deciso con Mattia il 22/11/2026):
// - portafoglio Fineco + contanti: 1.370 € al mese per definizione; le spese registrate
//   si contano contro quel budget (spese libere, spesa e casa, benzina, fisse);
// - cassaforte Tinaba: tasse, auto, regali, salute, scadenze e risparmio;
// - il primo del mese un solo bonifico riporta il portafoglio a 1.370 € e finanzia
//   le scadenze del mese che si apre.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.BudgetCalcoli = api;
})(typeof self !== 'undefined' ? self : this, function () {
  const TASSA_DEFAULT = 12;
  const MENSILE_DEFAULT = 1370;
  const BUDGET_DEFAULT = { 'spesa-casa': 500, 'spese-libere': 400, 'benzina': 120 };
  const BARRE = ['spesa-casa', 'benzina'];
  const MESI_SCADENZE = 12;

  function pad(n) { return String(n).padStart(2, '0'); }
  // Giorno locale AAAA-MM-GG. Mai toISOString: sposterebbe il giorno vicino alla mezzanotte.
  function dayKey(d) {
    const x = d instanceof Date ? d : new Date(d);
    return x.getFullYear() + '-' + pad(x.getMonth() + 1) + '-' + pad(x.getDate());
  }
  function itemDay(value) {
    if (!value) return '';
    // Una data senza orario resta quel giorno; una con orario va riportata all'ora locale.
    return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : dayKey(value);
  }
  function monthOf(key) { return key.slice(0, 7); }
  function addDays(key, n) {
    const [y, m, d] = key.split('-').map(Number);
    return dayKey(new Date(y, m - 1, d + n, 12));
  }
  function addMonths(key, n) {
    const [y, m, d] = key.split('-').map(Number);
    const ultimo = new Date(y, m - 1 + n + 1, 0).getDate();
    return dayKey(new Date(y, m - 1 + n, Math.min(d, ultimo), 12));
  }
  function lastDayOfMonth(key) {
    const [y, m] = key.split('-').map(Number);
    return new Date(y, m, 0).getDate();
  }
  // Mesi da `dal` a `al` compresi (AAAA-MM); 0 se `al` viene prima.
  function mesiCompresi(dal, al) {
    const [y1, m1] = dal.split('-').map(Number);
    const [y2, m2] = al.split('-').map(Number);
    return Math.max(0, (y2 - y1) * 12 + (m2 - m1) + 1);
  }
  function round(n) { return Math.round((n + Number.EPSILON) * 100) / 100; }
  function num(x) { return Number(x) || 0; }
  function alive(list) { return (list || []).filter(x => x && !x._deleted); }
  function somma(list, f) { return round(list.reduce((a, x) => a + (f ? f(x) : num(x.amount)), 0)); }

  function gruppi(data) {
    const g = {};
    for (const c of data.categories || []) g[c.id] = c.group || 'variabile';
    return g;
  }
  function budgetDi(settings, id) {
    const b = settings.budget || {};
    return b[id] != null ? num(b[id]) : (BUDGET_DEFAULT[id] || 0);
  }

  // Vero se il giorno (con il timestamp di registrazione) viene dopo il riferimento.
  function dopo(rif, giorno, ts) {
    if (!rif) return true;
    if (giorno > rif.date) return true;
    return giorno === rif.date && (ts || 0) > (rif.ts || 0);
  }

  function nettoEntrata(voce, settings) {
    const lordo = num(voce.receivedAmount != null ? voce.receivedAmount : voce.gross);
    const pct = voce.isGross
      ? Number(voce.taxPct != null ? voce.taxPct : (settings.taxPctDefault != null ? settings.taxPctDefault : TASSA_DEFAULT))
      : 0;
    const tassa = round(lordo * pct / 100);
    return { lordo: lordo, tassa: tassa, netto: round(lordo - tassa) };
  }

  // Le spese vere (le previste generate dalle ricorrenti, se ce ne sono, non contano).
  function spese(data) {
    return alive(data.movements).filter(m => !m.prevista);
  }

  // Fisse del mese: ogni ricorrente attiva è prevista finché non arriva la spesa vera
  // collegata (stesso recurringId nello stesso mese). Una prevista non confermata
  // decade a fine mese: conta solo nel mese che si sta guardando.
  function fisseDelMese(data, mese) {
    const vere = spese(data).filter(m => m.recurringId && monthOf(itemDay(m.date)) === mese);
    const daUscire = [];
    const uscite = [];
    for (const r of alive(data.recurring)) {
      if (r.active === false) continue;
      if (r.dal && mese < r.dal) continue;
      const giorno = mese + '-' + pad(Math.min(Math.max(parseInt(r.dayOfMonth, 10) || 1, 1), lastDayOfMonth(mese + '-01')));
      const conferma = vere.filter(m => m.recurringId === r.id);
      const voce = { id: r.id, name: r.name, category: r.category, day: giorno, previsto: num(r.amount) };
      if (conferma.length) uscite.push(Object.assign(voce, { amount: somma(conferma) }));
      else daUscire.push(Object.assign(voce, { amount: num(r.amount) }));
    }
    const ordina = (a, b) => a.day.localeCompare(b.day);
    return { daUscire: daUscire.sort(ordina), uscite: uscite.sort(ordina) };
  }

  function speseLibereAl(data, giorno) {
    const settings = data.settings || {};
    const budget = budgetDi(settings, 'spese-libere');
    const mese = monthOf(giorno);
    let prima = 0, quelGiorno = 0, totale = 0;
    for (const m of spese(data)) {
      if (m.category !== 'spese-libere') continue;
      const g = itemDay(m.date);
      if (monthOf(g) !== mese) continue;
      const a = num(m.amount);
      totale += a;
      if (g < giorno) prima += a;
      else if (g === giorno) quelGiorno += a;
    }
    const giorniRestanti = lastDayOfMonth(giorno) - Number(giorno.slice(8)) + 1;
    const quota = round(Math.max(budget - prima, 0) / giorniRestanti);
    return {
      budget: budget, spesoMese: round(totale), spesoPrima: round(prima), spesoGiorno: round(quelGiorno),
      resto: round(budget - totale), quota: quota, restaGiorno: round(quota - quelGiorno), giorniRestanti: giorniRestanti
    };
  }

  // Riserva per l'imposta sostitutiva: base iniziale + quota delle entrate lorde arrivate
  // dopo la data della base − imposta pagata dopo quella data.
  function riservaImposta(data, oggi) {
    const settings = data.settings || {};
    const r = settings.riservaImposta || {};
    const dal = r.data || '0000-00-00';
    let riserva = num(r.base);
    for (const v of alive(data.incomeItems)) {
      if (v.status !== 'arrivata') continue;
      const g = itemDay(v.receivedDate);
      if (g < dal || g > oggi) continue;
      riserva += nettoEntrata(v, settings).tassa;
    }
    for (const t of alive(data.taxPayments)) {
      const g = itemDay(t.date);
      if (g < dal || g > oggi) continue;
      riserva -= num(t.amount);
    }
    return round(riserva);
  }

  function importoScadenza(s, riserva) {
    if (s.daRiserva && (s.amount == null || s.amount === 'riserva')) return round(Math.max(riserva, 0));
    return num(s.amount);
  }

  function risparmioAccantonato(settings, mese) {
    const r = settings.risparmio || {};
    if (!r.dal) return round(num(r.base));
    return round(num(r.base) + num(r.mensile) * mesiCompresi(r.dal, mese));
  }

  // Ultimo momento in cui la cassaforte è stata messa in pari: saldo dichiarato o bonifico.
  function riferimentoCassaforte(cf) {
    let rif = { date: itemDay(cf.data), ts: num(cf.ts) };
    for (const g of alive(cf.giroconti)) {
      const r = { date: itemDay(g.date), ts: num(g.ts) };
      if (r.date > rif.date || (r.date === rif.date && r.ts > rif.ts)) rif = r;
    }
    return rif;
  }

  function cassaforte(data, oggi) {
    const cf = data.cassaforte;
    if (!cf || cf.saldo == null) return null;
    const settings = data.settings || {};
    const gr = gruppi(data);
    const inizio = { date: itemDay(cf.data), ts: num(cf.ts) };
    let saldoTinaba = num(cf.saldo);
    for (const g of alive(cf.giroconti)) {
      if (!dopo(inizio, itemDay(g.date), g.ts)) continue;
      saldoTinaba += g.verso === 'tinaba' ? num(g.amount) : -num(g.amount);
    }
    // Fra un bonifico e l'altro: le entrate arrivate su Fineco e le spese della cassaforte
    // pagate col portafoglio passano in cassaforte col prossimo bonifico. Si contano già.
    const rif = riferimentoCassaforte(cf);
    const scadenze = alive(data.scadenze);
    const finanziate = new Set(scadenze.filter(s => s.finanziata).map(s => s.id));
    let entrate = 0;
    for (const v of alive(data.incomeItems)) {
      if (v.status !== 'arrivata') continue;
      const g = itemDay(v.receivedDate);
      if (g <= oggi && dopo(rif, g, v.recordedTs || v._modTs)) entrate += nettoEntrata(v, settings).lordo;
    }
    let speseCf = 0;
    for (const m of spese(data)) {
      if (gr[m.category] !== 'cassaforte') continue;
      if (m.scadenzaId && finanziate.has(m.scadenzaId)) continue;
      const g = itemDay(m.date);
      if (g <= oggi && dopo(rif, g, m._modTs)) speseCf += num(m.amount);
    }
    const saldo = round(saldoTinaba + entrate - speseCf);

    const riserva = riservaImposta(data, oggi);
    let riservaFinanziata = 0;
    let scadenzeDestinate = 0;
    const limite = addMonths(oggi, MESI_SCADENZE);
    for (const s of scadenze) {
      if (s.pagata) continue;
      if (s.daRiserva) {
        if (s.finanziata) riservaFinanziata += num(s.finanziataImporto);
        continue;
      }
      if (s.finanziata) continue;
      const g = itemDay(s.date);
      if (g && g > limite) continue;
      scadenzeDestinate += num(s.amount);
    }
    const risparmio = risparmioAccantonato(settings, monthOf(oggi));
    const destinato = round(Math.max(riserva - riservaFinanziata, 0) + scadenzeDestinate + risparmio);
    return {
      saldoDichiarato: num(cf.saldo), dataSaldo: itemDay(cf.data),
      saldoTinaba: round(saldoTinaba), entrateDaSistemare: round(entrate), speseDaSistemare: round(speseCf),
      saldo: saldo,
      riservaImposta: riserva, riservaFinanziata: round(riservaFinanziata),
      scadenzeDestinate: round(scadenzeDestinate), risparmio: risparmio,
      destinato: destinato, libero: round(saldo - destinato)
    };
  }

  function elencoScadenze(data, oggi) {
    const riserva = riservaImposta(data, oggi);
    return alive(data.scadenze)
      .filter(s => !s.pagata)
      .map(s => ({
        id: s.id, name: s.name, category: s.category, date: itemDay(s.date) || null,
        amount: importoScadenza(s, riserva), daRiserva: !!s.daRiserva, finanziata: !!s.finanziata,
        scaduta: !!(s.date && itemDay(s.date) < oggi)
      }))
      .sort((a, b) => (a.date ? 1 : 0) - (b.date ? 1 : 0) || String(a.date).localeCompare(String(b.date)));
  }

  function entrateAttese(data, oggi) {
    const settings = data.settings || {};
    const inArrivo = [], inRitardo = [];
    for (const v of alive(data.incomeItems)) {
      if (v.status !== 'attesa') continue;
      const n = nettoEntrata(v, settings);
      const voce = { id: v.id, name: v.name, expectedDate: itemDay(v.expectedDate) || null, lordo: n.lordo, netto: n.netto, isGross: !!v.isGross };
      (voce.expectedDate && voce.expectedDate < oggi ? inRitardo : inArrivo).push(voce);
    }
    const ordina = (a, b) => (a.expectedDate ? 0 : 1) - (b.expectedDate ? 0 : 1) || String(a.expectedDate).localeCompare(String(b.expectedDate));
    return { inArrivo: inArrivo.sort(ordina), inRitardo: inRitardo.sort(ordina) };
  }

  function quadro(data, now) {
    const oggi = dayKey(now || new Date());
    const mese = monthOf(oggi);
    const settings = data.settings || {};
    const gr = gruppi(data);
    const nomi = {};
    for (const c of data.categories || []) nomi[c.id] = c.name;

    const sl = speseLibereAl(data, oggi);
    const ieri = addDays(oggi, -1);
    let chiusuraIeri = null;
    if (monthOf(ieri) === mese && (!settings.avvio || ieri >= settings.avvio)) {
      const s = speseLibereAl(data, ieri);
      chiusuraIeri = { giorno: ieri, quota: s.quota, speso: s.spesoGiorno, saldo: s.restaGiorno };
    }

    const delMese = spese(data).filter(m => monthOf(itemDay(m.date)) === mese);
    const barre = BARRE.map(id => ({
      id: id, name: nomi[id] || id, budget: budgetDi(settings, id),
      speso: somma(delMese.filter(m => m.category === id))
    }));

    const fisse = fisseDelMese(data, mese);
    const mensile = settings.portafoglio && settings.portafoglio.mensile != null ? num(settings.portafoglio.mensile) : MENSILE_DEFAULT;
    const spesoPortafoglio = somma(delMese.filter(m => gr[m.category] === 'variabile' || gr[m.category] === 'fissa'));
    const fisseDaUscire = somma(fisse.daUscire);

    const reali = spese(data).filter(m => !m.isRecurring).map(m => itemDay(m.date)).filter(g => g <= oggi).sort();
    return {
      oggi: oggi,
      mese: mese,
      avvio: settings.avvio || null,
      primaDellAvvio: !!(settings.avvio && oggi < settings.avvio),
      speseLibere: {
        budget: sl.budget, spesoMese: sl.spesoMese, resto: sl.resto, giorniRestanti: sl.giorniRestanti,
        quotaOggi: sl.quota, spesoOggi: sl.spesoGiorno, restaOggi: sl.restaGiorno, chiusuraIeri: chiusuraIeri
      },
      barre: barre,
      portafoglio: {
        mensile: mensile, speso: spesoPortafoglio, fisseDaUscire: fisseDaUscire,
        resto: round(mensile - spesoPortafoglio - fisseDaUscire),
        fisseDaUscireLista: fisse.daUscire, fisseUscite: fisse.uscite
      },
      cassaforte: cassaforte(data, oggi),
      scadenze: elencoScadenze(data, oggi),
      entrateAttese: entrateAttese(data, oggi),
      ultimoMovimento: reali.length ? reali[reali.length - 1] : null
    };
  }

  // Bonifico di inizio mese. saldoPortafoglio = Fineco + tutti i contanti.
  // bonifico = mensile − (saldo − scadenze finanziate e non pagate)
  //          + scadenze del mese nuovo (anche quelle scadute e non pagate) + imposta del mese.
  // Positivo: da Tinaba a Fineco. Negativo: da Fineco a Tinaba.
  function bonificoInizioMese(data, saldoPortafoglio, meseNuovo, now) {
    const settings = data.settings || {};
    const oggi = dayKey(now || new Date());
    const mensile = settings.portafoglio && settings.portafoglio.mensile != null ? num(settings.portafoglio.mensile) : MENSILE_DEFAULT;
    const scadenze = alive(data.scadenze).filter(s => !s.pagata);
    const finanziateNonPagate = somma(scadenze.filter(s => s.finanziata), s => num(s.finanziataImporto));
    const riserva = riservaImposta(data, oggi);
    const riservaFinanziata = somma(scadenze.filter(s => s.daRiserva && s.finanziata), s => num(s.finanziataImporto));
    const daFinanziare = [];
    const imposta = [];
    for (const s of scadenze) {
      if (s.finanziata) continue;
      const g = itemDay(s.date);
      if (!g || monthOf(g) > meseNuovo) continue;
      if (s.daRiserva) imposta.push({ id: s.id, name: s.name, date: g, amount: round(Math.max(riserva - riservaFinanziata, 0)) });
      else daFinanziare.push({ id: s.id, name: s.name, date: g, amount: num(s.amount) });
    }
    const saldo = round(num(saldoPortafoglio));
    const ricarica = round(mensile - (saldo - finanziateNonPagate));
    const netto = round(ricarica + somma(daFinanziare) + somma(imposta));
    return {
      mese: meseNuovo,
      importo: Math.abs(netto),
      verso: netto > 0 ? 'fineco' : (netto < 0 ? 'tinaba' : 'nessuno'),
      netto: netto,
      dettaglio: {
        mensile: mensile, saldoPortafoglio: saldo, finanziateNonPagate: finanziateNonPagate,
        ricarica: ricarica, scadenze: daFinanziare, imposta: imposta
      }
    };
  }

  function diagnosi(data, mese) {
    const settings = data.settings || {};
    const gr = gruppi(data);
    const delMese = spese(data).filter(m => monthOf(itemDay(m.date)) === mese);
    const perCategoria = {}, perMetodo = {};
    const totali = { variabile: 0, fissa: 0, cassaforte: 0 };
    const giorniRegistrati = new Set();
    for (const m of delMese) {
      const a = num(m.amount);
      perCategoria[m.category] = (perCategoria[m.category] || 0) + a;
      const metodo = m.method || 'non indicato';
      perMetodo[metodo] = (perMetodo[metodo] || 0) + a;
      totali[gr[m.category] || 'variabile'] += a;
      if (!m.isRecurring && !m.installmentId) giorniRegistrati.add(itemDay(m.date));
    }
    const categorie = (data.categories || [])
      .map(c => {
        const speso = round(perCategoria[c.id] || 0);
        const budget = c.group === 'variabile' ? budgetDi(settings, c.id) : 0;
        return { id: c.id, name: c.name, group: c.group, speso: speso, budget: budget, sforo: budget > 0 && speso > budget ? round(speso - budget) : 0 };
      })
      .filter(c => c.speso > 0 || c.budget > 0)
      .sort((a, b) => b.speso - a.speso);
    const arrivate = [], attese = [];
    for (const v of alive(data.incomeItems)) {
      if (v.status === 'arrivata' && monthOf(itemDay(v.receivedDate)) === mese) {
        arrivate.push(Object.assign({ name: v.name, day: itemDay(v.receivedDate) }, nettoEntrata(v, settings)));
      } else if (v.status === 'attesa' && v.expectedDate && monthOf(itemDay(v.expectedDate)) === mese) {
        attese.push(Object.assign({ name: v.name, day: itemDay(v.expectedDate) }, nettoEntrata(v, settings)));
      }
    }
    return {
      mese: mese,
      totale: round(totali.variabile + totali.fissa + totali.cassaforte),
      variabili: round(totali.variabile),
      fisse: round(totali.fissa),
      cassaforte: round(totali.cassaforte),
      portafoglio: { mensile: settings.portafoglio && settings.portafoglio.mensile != null ? num(settings.portafoglio.mensile) : MENSILE_DEFAULT, speso: round(totali.variabile + totali.fissa) },
      categorie: categorie,
      perMetodo: Object.keys(perMetodo).map(k => ({ metodo: k, importo: round(perMetodo[k]) })).sort((a, b) => b.importo - a.importo),
      entrateArrivate: arrivate,
      entrateAttese: attese,
      giorniConSpese: giorniRegistrati.size
    };
  }

  // Crediti maturati al giorno indicato (settings.crediti): un mese di lavoro matura il primo
  // del mese dopo; si scala quanto è già arrivato (voci arrivate col nome del debitore, dopo pagatoFino).
  function crediti(data, giorno) {
    const out = [];
    for (const c of alive((data.settings || {}).crediti)) {
      const [y1, m1] = c.dal.split('-').map(Number);
      const [y2, m2] = monthOf(giorno).split('-').map(Number);
      let mesi = Math.max(0, (y2 - y1) * 12 + (m2 - m1));
      if (c.al) {
        const [y3, m3] = c.al.split('-').map(Number);
        mesi = Math.min(mesi, Math.max(0, (y3 - y1) * 12 + (m3 - m1) + 1));
      }
      const rapporto = num(c.lordoMensile) ? num(c.nettoMensile) / num(c.lordoMensile) : 1;
      let pagato = num(c.pagatoLordo);
      const cerca = String(c.cerca || c.nome).toLowerCase();
      for (const v of alive(data.incomeItems)) {
        if (v.status !== 'arrivata' || !String(v.name || '').toLowerCase().includes(cerca)) continue;
        const g = itemDay(v.receivedDate);
        if (!g || g <= itemDay(c.pagatoFino) || g > giorno) continue;
        const importo = num(v.receivedAmount != null ? v.receivedAmount : v.gross);
        pagato += v.isGross ? importo : importo / rapporto;
      }
      const lordo = round(Math.max(num(c.lordoMensile) * mesi + num(c.extraLordo) - pagato, 0));
      out.push({ id: c.id, nome: c.nome, lordo: lordo, netto: round(lordo * rapporto), aParte: !!c.aParte });
    }
    return out;
  }

  return { quadro, bonificoInizioMese, diagnosi, fisseDelMese, riservaImposta, nettoEntrata, dayKey, itemDay, addMonths, crediti };
});

// Uso da riga di comando: legge {azione, data, now, mese, saldo} da stdin e stampa il risultato.
if (typeof require !== 'undefined' && typeof module !== 'undefined' && require.main === module) {
  let testo = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', c => { testo += c; });
  process.stdin.on('end', () => {
    const q = JSON.parse(testo);
    const api = module.exports;
    const adesso = q.now ? new Date(q.now) : new Date();
    let r;
    if (q.azione === 'diagnosi') r = api.diagnosi(q.data, q.mese || api.dayKey(adesso).slice(0, 7));
    else if (q.azione === 'bonifico') r = api.bonificoInizioMese(q.data, q.saldo, q.mese || api.dayKey(adesso).slice(0, 7), adesso);
    else r = api.quadro(q.data, adesso);
    process.stdout.write(JSON.stringify(r));
  });
}
