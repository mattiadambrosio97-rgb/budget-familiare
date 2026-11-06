// Si lancia con: node --test test/calcoli.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const { metriche, diagnosi, chiusura } = createRequire(import.meta.url)('../calcoli.js');

const categories = [
  { id: 'spesa-casa', name: 'Spesa', fixed: false },
  { id: 'sfizi', name: 'Sfizi', fixed: false },
  { id: 'regali', name: 'Regali', fixed: false },
  { id: 'abbonamenti', name: 'Abbonamenti', fixed: true }
];
const caps = { 'spesa-casa': 500, sfizi: 300, regali: 0, abbonamenti: 100, _t: { sfizi: 1 } };
const ADESSO = new Date(2026, 10, 20, 15, 0);
const anchor = { date: '2026-11-10', ts: new Date(2026, 10, 10, 18).getTime(), cash: 2000, taxReserve: 100 };
const base = o => Object.assign({ categories, caps, anchor, movements: [], incomeItems: [], taxPayments: [], installments: [], settings: { taxPctDefault: 41 } }, o);
const spesa = (date, amount, extra) => Object.assign({ id: date + amount, date, amount, category: 'sfizi', _modTs: new Date(date + 'T12:00').getTime() }, extra);

test('entrata lorda: va nei soldi al netto e la quota nella riserva', () => {
  const m = metriche(base({ incomeItems: [{ id: 'a', status: 'arrivata', gross: 1700, isGross: true, receivedDate: '2026-11-15', recordedTs: new Date(2026, 10, 15, 9).getTime() }] }), ADESSO);
  assert.equal(m.soldiOra, 3003);
  assert.equal(m.riservaTasse, 797);
});

test('entrata netta: resta intera', () => {
  const m = metriche(base({ incomeItems: [{ id: 'a', status: 'arrivata', gross: 500, isGross: false, receivedDate: '2026-11-15' , recordedTs: 1 }] }), ADESSO);
  assert.equal(m.soldiOra, 2500);
  assert.equal(m.riservaTasse, 100);
});

test('entrata attesa in ritardo: non cambia i numeri e risulta in ritardo', () => {
  const senza = metriche(base({}), ADESSO);
  const m = metriche(base({ incomeItems: [{ id: 'a', status: 'attesa', gross: 1700, isGross: true, expectedDate: '2026-11-15' }] }), ADESSO);
  assert.equal(m.puoiSpendere, senza.puoiSpendere);
  assert.equal(m.entrateInRitardo.length, 1);
  assert.equal(m.entrateInRitardo[0].netto, 1003);
  assert.equal(m.entrateInArrivo.length, 0);
});

test('ritardo dal 15 al 18: conta solo dal giorno di arrivo', () => {
  const voce = { id: 'a', status: 'arrivata', gross: 1000, isGross: false, receivedDate: '2026-11-18', recordedTs: 1, expectedDate: '2026-11-15' };
  assert.equal(metriche(base({ incomeItems: [voce] }), new Date(2026, 10, 17, 12)).soldiOra, 2000);
  assert.equal(metriche(base({ incomeItems: [voce] }), new Date(2026, 10, 18, 12)).soldiOra, 3000);
});

test('entrata spostata al mese dopo: resta in arrivo', () => {
  const m = metriche(base({ incomeItems: [{ id: 'a', status: 'attesa', gross: 500, isGross: false, expectedDate: '2026-12-15' }] }), ADESSO);
  assert.equal(m.entrateInArrivo[0].expectedDate, '2026-12-15');
  assert.equal(m.soldiOra, 2000);
});

test('soldi alti e tetti bassi: comanda il tetto', () => {
  const m = metriche(base({ movements: [spesa('2026-11-12', 700)] }), ADESSO);
  assert.equal(m.margineTetti, 100);
  assert.equal(m.margineSoldi, 1300);
  assert.equal(m.puoiSpendere, 100);
  assert.equal(m.limite, 'tetti');
});

test('tetti alti e soldi bassi: comandano i soldi', () => {
  const m = metriche(base({ anchor: Object.assign({}, anchor, { cash: 200 }) }), ADESSO);
  assert.equal(m.puoiSpendere, 200);
  assert.equal(m.limite, 'soldi');
});

test('spesa senza tetto: toglie dai soldi, non dai tetti', () => {
  const m = metriche(base({ movements: [spesa('2026-11-12', 150, { category: 'regali' })] }), ADESSO);
  assert.equal(m.soldiOra, 1850);
  assert.equal(m.margineTetti, 800);
});

test('rata a cavallo di mese: pesa nel suo mese, le future negli impegni', () => {
  const rate = [
    spesa('2026-11-12', 50, { id: 'r:1', installmentId: 'r', category: 'regali' }),
    spesa('2026-11-28', 50, { id: 'r:2', installmentId: 'r', category: 'regali' }),
    spesa('2026-12-12', 50, { id: 'r:3', installmentId: 'r', category: 'regali' })
  ];
  const m = metriche(base({ movements: rate }), ADESSO);
  assert.equal(m.soldiOra, 1950);
  assert.equal(m.impegniMese, 50);
  assert.equal(m.margineSoldi, 1900);
  assert.equal(m.impegniFuturi, 50);
});

test('ricorrente maturata e futura', () => {
  const ricorrenti = [
    spesa('2026-11-15', 21, { id: 'a:2026-11', isRecurring: true, category: 'abbonamenti' }),
    spesa('2026-11-25', 7, { id: 'b:2026-11', isRecurring: true, category: 'abbonamenti' })
  ];
  const m = metriche(base({ movements: ricorrenti }), ADESSO);
  assert.equal(m.soldiOra, 1979);
  assert.equal(m.impegniMese, 7);
  assert.equal(m.margineSoldi, 1972);
});

test('cambio mese: i tetti ripartono, i soldi restano', () => {
  const m = metriche(base({ movements: [spesa('2026-11-12', 700)] }), new Date(2026, 11, 1, 10));
  assert.equal(m.margineTetti, 800);
  assert.equal(m.soldiOra, 1300);
});

test('movimenti prima dell\'ancora: fuori dal saldo, dentro la diagnosi', () => {
  const dati = base({ movements: [spesa('2026-06-12', 700)] });
  assert.equal(metriche(dati, ADESSO).soldiOra, 2000);
  assert.equal(diagnosi(dati, '2026-06').totale, 700);
});

test('spesa del giorno dell\'ancora: conta solo se registrata dopo', () => {
  const prima = spesa('2026-11-10', 10, { id: 'p', _modTs: anchor.ts - 1000 });
  const dopo = spesa('2026-11-10', 20, { id: 'd', _modTs: anchor.ts + 1000 });
  assert.equal(metriche(base({ movements: [prima, dopo] }), ADESSO).soldiOra, 1980);
});

test('spesa inserita dopo ma datata prima dell\'ancora: già nel saldo', () => {
  const m = spesa('2026-11-05', 40, { _modTs: anchor.ts + 1000 });
  assert.equal(metriche(base({ movements: [m] }), ADESSO).soldiOra, 2000);
});

test('voci cancellate: ignorate', () => {
  const dati = base({
    movements: [spesa('2026-11-12', 100, { _deleted: true })],
    incomeItems: [{ id: 'a', _deleted: true, status: 'arrivata', gross: 1, receivedDate: '2026-11-12', recordedTs: 1 }]
  });
  assert.equal(metriche(dati, ADESSO).soldiOra, 2000);
});

test('entrata annullata: non compare', () => {
  const m = metriche(base({ incomeItems: [{ id: 'a', status: 'annullata', gross: 100, expectedDate: '2026-11-25' }] }), ADESSO);
  assert.equal(m.entrateInArrivo.length, 0);
});

test('pagamento tasse: scende la riserva, non i soldi spendibili', () => {
  const m = metriche(base({ taxPayments: [{ id: 't', date: '2026-11-15', amount: 60, _modTs: 1 }] }), ADESSO);
  assert.equal(m.riservaTasse, 40);
  assert.equal(m.soldiOra, 2000);
});

test('fondi attivi: impegno prima del giorno, uscita dopo; quelli spenti no', () => {
  const settings = { funds: [{ id: 'f', name: 'Auto', amount: 75, dayOfMonth: 25 }, { id: 's', name: 'Salvadanaio', amount: 200, dayOfMonth: 25, active: false }] };
  const prima = metriche(base({ settings }), ADESSO);
  assert.equal(prima.soldiOra, 2000);
  assert.equal(prima.impegniMese, 75);
  const dopo = metriche(base({ settings }), new Date(2026, 10, 26, 10));
  assert.equal(dopo.soldiOra, 1925);
  assert.equal(dopo.impegniMese, 0);
});

test('senza ancora: resta il conto sui tetti e i soldi sono assenti', () => {
  const m = metriche(base({ anchor: null, movements: [spesa('2026-11-12', 100)] }), ADESSO);
  assert.equal(m.soldiOra, null);
  assert.equal(m.puoiSpendere, 700);
  assert.equal(m.limite, 'tetti');
  assert.equal(m.autonomiaData, null);
});

test('chiusura: quota del giorno meno le spese del giorno, fisse escluse', () => {
  const dati = base({ movements: [
    spesa('2026-11-20', 30),
    spesa('2026-11-20', 21, { id: 'x', isRecurring: true, category: 'abbonamenti' })
  ] });
  const c = chiusura(dati, '2026-11-20');
  // Tetti 800 meno 21 di fissa non pesano sui tetti; soldi 2000 meno 21; comanda il tetto: 800 / 11 giorni.
  assert.equal(c.quota, 72.73);
  assert.equal(c.speso, 30);
  assert.equal(c.saldo, 42.73);
});

test('chiusura prima dell\'ancora: non disponibile', () => {
  assert.equal(chiusura(base({}), '2026-11-05'), null);
});

test('autonomia: soldi divisi per la spesa giornaliera di riferimento', () => {
  const m = metriche(base({ settings: { autonomyMonthlySpend: 1700 } }), ADESSO);
  assert.equal(m.autonomiaData, '2026-12-25');
});

test('diagnosi: categorie, sforo, metodo e costo intero delle rate senza doppio conteggio', () => {
  const dati = base({
    movements: [
      spesa('2026-11-12', 350, { method: 'carta' }),
      spesa('2026-11-13', 50, { id: 'r:1', installmentId: 'r', category: 'regali', method: 'carta' }),
      spesa('2026-11-15', 21, { id: 'f', isRecurring: true, category: 'abbonamenti' }),
      spesa('2026-11-16', 10, { method: 'contanti', _deleted: true })
    ],
    installments: [{ id: 'r', name: 'Scarpe', total: 150, count: 3, firstDate: '2026-11-13' }],
    caps: Object.assign({}, caps, { sfizi: 300 })
  });
  const d = diagnosi(dati, '2026-11');
  assert.equal(d.totale, 421);
  assert.equal(d.fisse, 21);
  assert.equal(d.quoteRate, 50);
  assert.equal(d.acquistiARate[0].total, 150);
  assert.equal(d.categorie.find(c => c.id === 'sfizi').sforo, 50);
  assert.equal(d.perMetodo[0].metodo, 'carta');
  assert.equal(d.giorniConSpese, 1);
});
