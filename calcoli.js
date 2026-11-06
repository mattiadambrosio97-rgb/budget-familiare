// Calcoli del Budget: funzioni pure, usate dall'app e, via Node, da budget_dati.py.
// Una sola fonte per il numero mostrato nell'app e per quello scritto in chat.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.BudgetCalcoli = api;
})(typeof self !== 'undefined' ? self : this, function () {
  const TASSA_DEFAULT = 41;
  const SPESA_MENSILE_DEFAULT = 1700;

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
  function lastDayOfMonth(key) {
    const [y, m] = key.split('-').map(Number);
    return new Date(y, m, 0).getDate();
  }
  function round(n) { return Math.round((n + Number.EPSILON) * 100) / 100; }
  function alive(list) { return (list || []).filter(x => x && !x._deleted); }
  function isCommitted(m) { return !!(m.isRecurring || m.installmentId); }

  function dopoAncora(anchor, giorno, registratoTs) {
    if (!anchor) return false;
    const giornoAncora = itemDay(anchor.date);
    if (giorno > giornoAncora) return true;
    return giorno === giornoAncora && (registratoTs || 0) > (anchor.ts || 0);
  }

  function nettoEntrata(voce, settings) {
    const lordo = Number(voce.receivedAmount != null ? voce.receivedAmount : voce.gross) || 0;
    const pct = voce.isGross
      ? Number(voce.taxPct != null ? voce.taxPct : (settings.taxPctDefault != null ? settings.taxPctDefault : TASSA_DEFAULT))
      : 0;
    const tassa = round(lordo * pct / 100);
    return { lordo: lordo, tassa: tassa, netto: round(lordo - tassa) };
  }

  // Quote dei fondi attivi fra l'ancora e il giorno D, e quelle ancora da uscire nel mese di D.
  function fondi(anchor, settings, giornoD, inclusoD) {
    const out = { usciti: 0, impegni: [] };
    if (!anchor) return out;
    const giornoAncora = itemDay(anchor.date);
    for (const f of alive(settings.funds)) {
      if (f.active === false) continue;
      let [y, m] = giornoAncora.split('-').map(Number);
      const [yD, mD] = giornoD.split('-').map(Number);
      while (y < yD || (y === yD && m <= mD)) {
        const mese = y + '-' + pad(m);
        const giorno = mese + '-' + pad(Math.min(Number(f.dayOfMonth) || 1, lastDayOfMonth(mese + '-01')));
        if (giorno > giornoAncora) {
          const uscito = inclusoD ? giorno <= giornoD : giorno < giornoD;
          if (uscito) out.usciti += Number(f.amount) || 0;
          else if (mese === monthOf(giornoD)) out.impegni.push({ name: f.name, amount: Number(f.amount) || 0, day: giorno, tipo: 'fondo' });
        }
        m++;
        if (m > 12) { m = 1; y++; }
      }
    }
    return out;
  }

  // Situazione al giorno D. inclusoD=true: conta tutto il giorno D; false: l'inizio del giorno D.
  function stato(data, giornoD, inclusoD) {
    const movements = alive(data.movements);
    const settings = data.settings || {};
    const anchor = data.anchor || null;
    const mese = monthOf(giornoD);
    const categorie = data.categories || [];
    const entro = g => (inclusoD ? g <= giornoD : g < giornoD);

    let soldi = anchor ? Number(anchor.cash) || 0 : null;
    let riserva = anchor ? Number(anchor.taxReserve) || 0 : null;
    const impegni = [];
    let impegniFuturi = 0;
    let spesoTetti = 0;
    const conTetto = new Set(categorie
      .filter(c => !c.fixed && !c.hidden && Number((data.caps || {})[c.id]) > 0)
      .map(c => c.id));

    for (const m of movements) {
      const g = itemDay(m.date);
      const importo = Number(m.amount) || 0;
      const vincolata = isCommitted(m);
      if (monthOf(g) === mese && conTetto.has(m.category)) {
        if (entro(g) || vincolata || inclusoD) spesoTetti += importo;
      }
      if (!anchor) continue;
      if (entro(g)) {
        if (dopoAncora(anchor, g, m._modTs)) soldi -= importo;
      } else if (vincolata || inclusoD) {
        if (monthOf(g) === mese) {
          impegni.push({ name: m.note || m.category, amount: importo, day: g, tipo: m.installmentId ? 'rata' : (m.isRecurring ? 'fissa' : 'spesa') });
        } else if (g > giornoD) {
          impegniFuturi += importo;
        }
      }
    }

    if (anchor) {
      const f = fondi(anchor, settings, giornoD, inclusoD);
      soldi -= f.usciti;
      impegni.push.apply(impegni, f.impegni);
      for (const v of alive(data.incomeItems)) {
        if (v.status !== 'arrivata') continue;
        const g = itemDay(v.receivedDate);
        if (!entro(g) || !dopoAncora(anchor, g, v.recordedTs || v._modTs)) continue;
        const n = nettoEntrata(v, settings);
        soldi += n.netto;
        riserva += n.tassa;
      }
      for (const t of alive(data.taxPayments)) {
        const g = itemDay(t.date);
        if (entro(g) && dopoAncora(anchor, g, t._modTs)) riserva -= Number(t.amount) || 0;
      }
    }

    const totaleTetti = Array.from(conTetto).reduce((a, id) => a + Number(data.caps[id]), 0);
    const margineTetti = conTetto.size ? round(totaleTetti - spesoTetti) : null;
    const totaleImpegni = round(impegni.reduce((a, i) => a + i.amount, 0));
    const margineSoldi = anchor ? round(soldi - totaleImpegni) : null;
    let puoi = null;
    let limite = 'nessuno';
    if (margineSoldi != null && margineTetti != null) {
      puoi = Math.min(margineSoldi, margineTetti);
      limite = margineSoldi <= margineTetti ? 'soldi' : 'tetti';
    } else if (margineSoldi != null) { puoi = margineSoldi; limite = 'soldi'; }
    else if (margineTetti != null) { puoi = margineTetti; limite = 'tetti'; }

    return {
      soldiOra: anchor ? round(soldi) : null,
      riservaTasse: anchor ? round(riserva) : null,
      impegni: impegni.sort((a, b) => a.day.localeCompare(b.day)),
      impegniMese: totaleImpegni,
      impegniFuturi: round(impegniFuturi),
      margineSoldi: margineSoldi,
      margineTetti: margineTetti,
      puoiSpendere: puoi,
      limite: limite
    };
  }

  function speseDelGiorno(data, giorno) {
    const fisse = new Set((data.categories || []).filter(c => c.fixed).map(c => c.id));
    return round(alive(data.movements)
      .filter(m => itemDay(m.date) === giorno && !isCommitted(m) && !fisse.has(m.category))
      .reduce((a, m) => a + (Number(m.amount) || 0), 0));
  }

  function quotaGiorno(data, giorno) {
    const inizio = stato(data, giorno, false);
    if (inizio.puoiSpendere == null) return null;
    const restanti = lastDayOfMonth(giorno) - Number(giorno.slice(8)) + 1;
    return round(Math.max(inizio.puoiSpendere, 0) / restanti);
  }

  function chiusura(data, giorno) {
    if (data.anchor && giorno < itemDay(data.anchor.date)) return null;
    const quota = quotaGiorno(data, giorno);
    if (quota == null) return null;
    const speso = speseDelGiorno(data, giorno);
    return { giorno: giorno, quota: quota, speso: speso, saldo: round(quota - speso) };
  }

  function metriche(data, now) {
    const oggi = dayKey(now || new Date());
    const settings = data.settings || {};
    const s = stato(data, oggi, true);
    const inArrivo = [];
    const inRitardo = [];
    for (const v of alive(data.incomeItems)) {
      if (v.status !== 'attesa') continue;
      const voce = { id: v.id, name: v.name, expectedDate: itemDay(v.expectedDate), netto: nettoEntrata(v, settings).netto, lordo: Number(v.gross) || 0 };
      (voce.expectedDate < oggi ? inRitardo : inArrivo).push(voce);
    }
    const ordina = (a, b) => a.expectedDate.localeCompare(b.expectedDate);
    inArrivo.sort(ordina);
    inRitardo.sort(ordina);

    const spesaMensile = Number(settings.autonomyMonthlySpend) || SPESA_MENSILE_DEFAULT;
    let autonomia = null;
    if (s.soldiOra != null) {
      const giorni = s.soldiOra > 0 ? Math.floor(s.soldiOra / (spesaMensile * 12 / 365.25)) : 0;
      autonomia = addDays(oggi, giorni);
    }
    const reali = alive(data.movements).filter(m => !m.isRecurring).map(m => itemDay(m.date)).filter(g => g <= oggi).sort();
    return Object.assign({}, s, {
      oggi: oggi,
      giorniRestanti: lastDayOfMonth(oggi) - Number(oggi.slice(8)) + 1,
      chiusuraOggi: chiusura(data, oggi),
      chiusuraIeri: chiusura(data, addDays(oggi, -1)),
      autonomiaData: autonomia,
      spesaMensile: spesaMensile,
      entrateInArrivo: inArrivo,
      entrateInRitardo: inRitardo,
      ultimoMovimento: reali.length ? reali[reali.length - 1] : null
    });
  }

  function diagnosi(data, mese) {
    const categorie = data.categories || [];
    const caps = data.caps || {};
    const delMese = alive(data.movements).filter(m => monthOf(itemDay(m.date)) === mese);
    const perCategoria = {};
    const perMetodo = {};
    let fisse = 0;
    let variabili = 0;
    const giorniRegistrati = new Set();
    const fisseIds = new Set(categorie.filter(c => c.fixed).map(c => c.id));
    for (const m of delMese) {
      const importo = Number(m.amount) || 0;
      perCategoria[m.category] = (perCategoria[m.category] || 0) + importo;
      const metodo = m.method || 'non indicato';
      perMetodo[metodo] = (perMetodo[metodo] || 0) + importo;
      if (m.isRecurring || fisseIds.has(m.category)) fisse += importo;
      else variabili += importo;
      if (!isCommitted(m)) giorniRegistrati.add(itemDay(m.date));
    }
    const categorieOut = categorie
      .filter(c => !c.hidden || perCategoria[c.id])
      .map(c => {
        const speso = round(perCategoria[c.id] || 0);
        const tetto = c.fixed ? 0 : Number(caps[c.id]) || 0;
        return { id: c.id, name: c.name, fixed: !!c.fixed, speso: speso, tetto: tetto, sforo: tetto > 0 && speso > tetto ? round(speso - tetto) : 0 };
      })
      .filter(c => c.speso > 0 || c.tetto > 0)
      .sort((a, b) => b.speso - a.speso);
    const settings = data.settings || {};
    const arrivate = [];
    const attese = [];
    for (const v of alive(data.incomeItems)) {
      if (v.status === 'arrivata' && monthOf(itemDay(v.receivedDate)) === mese) {
        arrivate.push(Object.assign({ name: v.name, day: itemDay(v.receivedDate) }, nettoEntrata(v, settings)));
      } else if (v.status === 'attesa' && monthOf(itemDay(v.expectedDate)) === mese) {
        attese.push(Object.assign({ name: v.name, day: itemDay(v.expectedDate) }, nettoEntrata(v, settings)));
      }
    }
    const rate = alive(data.installments).filter(r => monthOf(itemDay(r.firstDate)) === mese).map(r => ({
      name: r.name, total: Number(r.total) || 0, count: r.count, firstDate: itemDay(r.firstDate)
    }));
    const quoteRate = delMese.filter(m => m.installmentId).reduce((a, m) => a + (Number(m.amount) || 0), 0);
    return {
      mese: mese,
      totale: round(fisse + variabili),
      fisse: round(fisse),
      variabili: round(variabili),
      quoteRate: round(quoteRate),
      categorie: categorieOut,
      perMetodo: Object.keys(perMetodo).map(k => ({ metodo: k, importo: round(perMetodo[k]) })).sort((a, b) => b.importo - a.importo),
      acquistiARate: rate,
      entrateArrivate: arrivate,
      entrateAttese: attese,
      giorniConSpese: giorniRegistrati.size,
      spesaMensileRiferimento: Number(settings.autonomyMonthlySpend) || SPESA_MENSILE_DEFAULT
    };
  }

  return { metriche, diagnosi, stato, chiusura, nettoEntrata, dayKey, itemDay };
});

// Uso da riga di comando: legge {azione, data, now, mese} da stdin e stampa il risultato.
if (typeof require !== 'undefined' && typeof module !== 'undefined' && require.main === module) {
  let testo = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', c => { testo += c; });
  process.stdin.on('end', () => {
    const q = JSON.parse(testo);
    const api = module.exports;
    const adesso = q.now ? new Date(q.now) : new Date();
    const r = q.azione === 'diagnosi'
      ? api.diagnosi(q.data, q.mese || api.dayKey(adesso).slice(0, 7))
      : api.metriche(q.data, adesso);
    process.stdout.write(JSON.stringify(r));
  });
}
