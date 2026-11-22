// Si lancia con: node --test test/calcoli.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const { quadro, bonificoInizioMese, diagnosi, crediti } = createRequire(import.meta.url)('../calcoli.js');

const categories = [
  { id: 'spesa-casa', name: 'Spesa e casa', group: 'variabile' },
  { id: 'spese-libere', name: 'Spese libere', group: 'variabile' },
  { id: 'benzina', name: 'Benzina', group: 'variabile' },
  { id: 'abbonamenti', name: 'Abbonamenti', group: 'fissa' },
  { id: 'casa-pulizia', name: 'Signora delle pulizie', group: 'fissa' },
  { id: 'salute', name: 'Salute', group: 'cassaforte' },
  { id: 'tasse', name: 'Tasse', group: 'cassaforte' },
  { id: 'auto', name: 'Auto', group: 'cassaforte' }
];
const settings = {
  portafoglio: { mensile: 1370 },
  budget: { 'spesa-casa': 500, 'spese-libere': 400, benzina: 120 },
  taxPctDefault: 12,
  riservaImposta: { base: 355, data: '2026-11-22' },
  risparmio: { mensile: 200, dal: '2026-12', base: 0 }
};
const recurring = [
  { id: 'r-netflix', name: 'Netflix', amount: 6.99, category: 'abbonamenti', dayOfMonth: 25, active: true },
  { id: 'r-signora', name: 'Signora', amount: 70, category: 'casa-pulizia', dayOfMonth: 1, active: true }
];
const cassaforte = { saldo: 10000, data: '2026-11-22', ts: new Date(2026, 10, 22, 12).getTime(), giroconti: [] };
const base = o => Object.assign({ categories, settings, recurring, cassaforte, movements: [], incomeItems: [], taxPayments: [], scadenze: [] }, o);
const spesa = (date, amount, category, extra) => Object.assign({ id: date + amount + category, date, amount, category: category || 'spese-libere', _modTs: new Date(date + 'T12:00').getTime() }, extra);
const giorno = (y, m, d) => new Date(y, m - 1, d, 15, 0);

test('quota giornaliera a inizio, metà e fine mese', () => {
  assert.equal(quadro(base({}), giorno(2026, 12, 1)).speseLibere.quotaOggi, 12.9); // 400 / 31
  const meta = quadro(base({ movements: [spesa('2026-12-05', 100)] }), giorno(2026, 12, 16));
  assert.equal(meta.speseLibere.quotaOggi, 18.75); // 300 / 16
  const fine = quadro(base({ movements: [spesa('2026-12-05', 380)] }), giorno(2026, 12, 31));
  assert.equal(fine.speseLibere.quotaOggi, 20);
});

test('spesa che sfora le spese libere: quota zero e resto negativo', () => {
  const q = quadro(base({ movements: [spesa('2026-12-03', 450)] }), giorno(2026, 12, 10));
  assert.equal(q.speseLibere.quotaOggi, 0);
  assert.equal(q.speseLibere.resto, -50);
});

test('spesa di oggi abbassa restaOggi ma non la quota', () => {
  const q = quadro(base({ movements: [spesa('2026-12-01', 10)] }), giorno(2026, 12, 1));
  assert.equal(q.speseLibere.quotaOggi, 12.9);
  assert.equal(q.speseLibere.restaOggi, 2.9);
  assert.equal(q.speseLibere.resto, 390);
});

test('chiusura di ieri: quota meno speso', () => {
  const q = quadro(base({ movements: [spesa('2026-12-01', 20)] }), giorno(2026, 12, 2));
  assert.deepEqual(q.speseLibere.chiusuraIeri, { giorno: '2026-12-01', quota: 12.9, speso: 20, saldo: -7.1 });
});

test('prevista non confermata: conta fra le fisse da uscire, non fra le spese', () => {
  const q = quadro(base({}), giorno(2026, 12, 10));
  assert.equal(q.portafoglio.fisseDaUscire, 76.99);
  assert.equal(q.portafoglio.speso, 0);
  assert.equal(q.portafoglio.resto, 1293.01);
});

test('prevista confermata: conta una volta sola, con l’importo vero', () => {
  const q = quadro(base({ movements: [spesa('2026-12-02', 65, 'casa-pulizia', { recurringId: 'r-signora' })] }), giorno(2026, 12, 10));
  assert.equal(q.portafoglio.fisseDaUscire, 6.99);
  assert.equal(q.portafoglio.speso, 65);
  assert.equal(q.portafoglio.resto, 1298.01);
  assert.equal(q.portafoglio.fisseUscite[0].amount, 65);
});

test('fissa saltata: non è prevista in quel mese, torna il mese dopo; se arriva comunque conta', () => {
  const rec = [{ ...recurring[0] }, { ...recurring[1], saltaMesi: ['2026-12'] }];
  const dic = quadro(base({ recurring: rec }), giorno(2026, 12, 10));
  assert.equal(dic.portafoglio.fisseDaUscire, 6.99);
  const gen = quadro(base({ recurring: rec }), giorno(2027, 1, 10));
  assert.equal(gen.portafoglio.fisseDaUscire, 76.99);
  const pagata = quadro(base({ recurring: rec, movements: [spesa('2026-12-02', 70, 'casa-pulizia', { recurringId: 'r-signora' })] }), giorno(2026, 12, 10));
  assert.equal(pagata.portafoglio.speso, 70);
  assert.equal(pagata.portafoglio.fisseDaUscire, 6.99);
});

test('prevista decaduta: il mese dopo non conta più', () => {
  const dic = quadro(base({}), giorno(2026, 12, 31));
  assert.equal(dic.portafoglio.fisseDaUscire, 76.99);
  const d = diagnosi(base({}), '2026-12');
  assert.equal(d.fisse, 0); // la signora saltata non è una spesa
  const gen = quadro(base({ movements: [spesa('2027-01-01', 70, 'casa-pulizia', { recurringId: 'r-signora' })] }), giorno(2027, 1, 5));
  assert.equal(gen.portafoglio.speso, 70);
  assert.equal(gen.portafoglio.fisseDaUscire, 6.99);
});

test('cassaforte: riserva, scadenze nel destinato, risparmio, libero', () => {
  const scadenze = [
    { id: 'inps', name: 'INPS', amount: 1152.93, date: '2027-02-16', category: 'tasse' },
    { id: 'bollo', name: 'Bollo', amount: 174.39, date: null, category: 'auto' },
    { id: 'lontana', name: 'Fra più di un anno', amount: 999, date: '2028-06-01', category: 'auto' },
    { id: 'imposta', name: 'Imposta', amount: null, date: '2027-06-30', category: 'tasse', daRiserva: true }
  ];
  const c = quadro(base({ scadenze }), giorno(2026, 12, 10)).cassaforte;
  assert.equal(c.riservaImposta, 355);
  assert.equal(c.risparmio, 200);
  assert.equal(c.destinato, 1882.32); // 355 + 1152,93 + 174,39 + 200
  assert.equal(c.libero, 8117.68);
  const feb = quadro(base({ scadenze }), giorno(2027, 2, 1)).cassaforte;
  assert.equal(feb.risparmio, 600);
});

test('scadenza finanziata: esce dal destinato', () => {
  const scadenze = [{ id: 'inps', name: 'INPS', amount: 1152.93, date: '2027-02-16', category: 'tasse', finanziata: true, finanziataImporto: 1152.93 }];
  const c = quadro(base({ scadenze }), giorno(2027, 2, 3)).cassaforte;
  assert.equal(c.scadenzeDestinate, 0);
});

test('entrata lorda: 12% nella riserva, entra in cassaforte fino al bonifico', () => {
  const incomeItems = [{ id: 'm', name: 'Manlio', status: 'arrivata', gross: 3000, isGross: true, receivedDate: '2026-12-15', recordedTs: new Date(2026, 11, 15, 10).getTime() }];
  const c = quadro(base({ incomeItems }), giorno(2026, 12, 20)).cassaforte;
  assert.equal(c.riservaImposta, 715);
  assert.equal(c.entrateDaSistemare, 3000);
  assert.equal(c.saldo, 13000);
});

test('spesa della cassaforte pagata col portafoglio: scende subito il saldo', () => {
  const c = quadro(base({ movements: [spesa('2026-12-05', 80, 'salute')] }), giorno(2026, 12, 6)).cassaforte;
  assert.equal(c.speseDaSistemare, 80);
  assert.equal(c.saldo, 9920);
});

test('entrata attesa: non cambia nessun numero', () => {
  const senza = quadro(base({}), giorno(2026, 12, 10));
  const con = quadro(base({ incomeItems: [{ id: 'a', name: 'ADT', status: 'attesa', gross: 3120, expectedDate: null }, { id: 'b', name: 'AM', status: 'attesa', gross: 500, expectedDate: '2026-12-05' }] }), giorno(2026, 12, 10));
  assert.deepEqual(con.speseLibere, senza.speseLibere);
  assert.deepEqual(con.portafoglio, senza.portafoglio);
  assert.deepEqual(con.cassaforte, senza.cassaforte);
  assert.equal(con.entrateAttese.inRitardo.length, 1);
  assert.equal(con.entrateAttese.inArrivo[0].name, 'ADT');
});

test('bonifico positivo: portafoglio sotto i 1.370 €', () => {
  const b = bonificoInizioMese(base({}), 900, '2026-12', giorno(2026, 12, 1));
  assert.equal(b.netto, 470);
  assert.equal(b.verso, 'fineco');
});

test('bonifico negativo: portafoglio sopra i 1.370 € (entrate arrivate su Fineco)', () => {
  const b = bonificoInizioMese(base({}), 2000, '2026-12', giorno(2026, 12, 1));
  assert.equal(b.importo, 630);
  assert.equal(b.verso, 'tinaba');
});

test('bonifico con scadenza nel mese nuovo', () => {
  const scadenze = [{ id: 'paypal', name: 'PayPal', amount: 129.49, date: '2026-12-28', category: 'auto' }, { id: 'inps', name: 'INPS', amount: 1152.93, date: '2027-02-16', category: 'tasse' }];
  const b = bonificoInizioMese(base({ scadenze }), 1370, '2026-12', giorno(2026, 12, 1));
  assert.equal(b.netto, 129.49);
  assert.equal(b.dettaglio.scadenze.length, 1);
});

test('bonifico con scadenza finanziata ma non ancora pagata: i soldi restano su Fineco', () => {
  const scadenze = [{ id: 'inps', name: 'INPS', amount: 1152.93, date: '2027-02-16', category: 'tasse', finanziata: true, finanziataImporto: 1152.93 }];
  const b = bonificoInizioMese(base({ scadenze }), 2522.93, '2027-02', giorno(2027, 2, 10));
  assert.equal(b.netto, 0);
});

test('bonifico con versamento dell’imposta: dalla riserva, poi esce dal destinato', () => {
  const scadenze = [{ id: 'imposta', name: 'Imposta', amount: null, date: '2027-06-30', category: 'tasse', daRiserva: true }];
  const b = bonificoInizioMese(base({ scadenze }), 1370, '2027-06', giorno(2027, 6, 1));
  assert.equal(b.netto, 355);
  assert.equal(b.dettaglio.imposta[0].amount, 355);
  const finanziata = [{ ...scadenze[0], finanziata: true, finanziataImporto: 355 }];
  const c = quadro(base({ scadenze: finanziata }), giorno(2027, 6, 2)).cassaforte;
  assert.equal(c.riservaFinanziata, 355);
  assert.equal(c.destinato, 1400); // solo il risparmio: 7 mesi × 200
});

test('diagnosi: totali per gruppo e budget', () => {
  const d = diagnosi(base({ movements: [spesa('2026-12-02', 450), spesa('2026-12-03', 52, 'spesa-casa'), spesa('2026-12-04', 80, 'salute'), spesa('2026-12-25', 6.99, 'abbonamenti', { recurringId: 'r-netflix' })] }), '2026-12');
  assert.equal(d.variabili, 502);
  assert.equal(d.fisse, 6.99);
  assert.equal(d.cassaforte, 80);
  assert.equal(d.categorie.find(c => c.id === 'spese-libere').sforo, 50);
  assert.equal(d.giorniConSpese, 4);
});

test('avvio: prima del 1/12 il quadro lo segnala', () => {
  const q = quadro(base({ settings: { ...settings, avvio: '2026-12-01' } }), giorno(2026, 11, 22));
  assert.equal(q.primaDellAvvio, true);
  assert.equal(q.speseLibere.chiusuraIeri, null);
});

test('crediti: Manlio matura il primo del mese dopo e scala i pagamenti arrivati', () => {
  const s = Object.assign({}, settings, { crediti: [
    { id: 'manlio', nome: 'Manlio', dal: '2026-06', lordoMensile: 1700, nettoMensile: 1000, pagatoLordo: 3000, pagatoFino: '2026-11-22' },
    { id: 'amgroup', nome: 'AM Group', dal: '2026-11', lordoMensile: 500, nettoMensile: 500, pagatoLordo: 0, pagatoFino: '2026-11-22' }
  ] });
  const d = base({ settings: s });
  const al30 = crediti(d, '2026-11-30');
  assert.deepEqual(al30.map(c => c.lordo), [5500, 0]);
  assert.equal(al30[0].netto, 3235.29);
  const al1 = crediti(d, '2026-12-01');
  assert.deepEqual(al1.map(c => c.lordo), [7200, 500]);
  const pagato = base({ settings: s, incomeItems: [
    { id: 'x', name: 'Manlio (ottimistica)', gross: 3000, isGross: true, status: 'arrivata', receivedDate: '2026-12-20' },
    { id: 'y', name: 'AM Group (novembre)', gross: 500, isGross: false, status: 'arrivata', receivedDate: '2026-12-15' },
    { id: 'z', name: 'Manlio', gross: 3000, isGross: true, status: 'attesa', expectedDate: '2026-12-31' }
  ] });
  assert.deepEqual(crediti(pagato, '2026-12-31').map(c => c.lordo), [4200, 0]);
});

test('crediti: rate a termine (TFR) si fermano al mese finale e restano a parte', () => {
  const s = Object.assign({}, settings, { crediti: [
    { id: 'adt', nome: 'ADT, TFR', cerca: 'adt', dal: '2026-09', al: '2026-12', lordoMensile: 780, nettoMensile: 780, pagatoLordo: 0, pagatoFino: '2026-11-22', aParte: true }
  ] });
  const d = base({ settings: s });
  assert.equal(crediti(d, '2026-11-22')[0].lordo, 1560);
  assert.equal(crediti(d, '2026-12-01')[0].lordo, 2340);
  assert.equal(crediti(d, '2027-06-01')[0].lordo, 3120);
  assert.equal(crediti(d, '2027-06-01')[0].aParte, true);
});
