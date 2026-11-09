'use strict';
// R3.1-R3.3, §6.4: setup() sicuro, auditDb(), snapshot(), prepareRollback(), token da Script Properties (Q6).
const assert = require('assert'); const path = require('path');
const { loadBackend } = require('./harness.js'); const { makeFixture } = require('./fixture.js');
const CODE = path.join(__dirname, '../backend/Code.gs');
const eq = assert.deepStrictEqual;
let n = 0; const t = (name, f) => { f(); n++; console.log('ok -', name); };

const fx = makeFixture();
const clone = x => JSON.parse(JSON.stringify(x));
// righe a 16 colonne (dopo setup) per i test su lotti
const wide = rows => rows.map((r, i) => r.concat(Array(16 - r.length).fill('')).map((v, j) => (i === 0 && j === 15 ? 'lotti' : v)));
function load(over = {}) {
  const sheets = Object.assign(clone(fx), over.sheets || {});
  return loadBackend(CODE, { sheets, props: 'props' in over ? over.props : { TOKEN: 'tok' }, maxCols: over.maxCols });
}
const snap = h => JSON.stringify({ P: h.values('Prodotti'), S: h.values('Spesa'), M: h.values('Movimenti'), names: h.sheetNames(), trg: h.triggers.length });

t('la fixture ha il punto fisso della 1.1 (barcode con zero iniziale, Date in testo ISO, qty numerica)', () => {
  assert.strictEqual(fx.Prodotti[1][1], '0012345678905'); assert.strictEqual(fx.Prodotti[2][1], '8001234567890');
  assert.strictEqual(fx.Prodotti[3][7], 5); assert.strictEqual(fx.Prodotti[4][9], '2026-11-12'); assert.strictEqual(fx.Prodotti[4][7], 0);
  assert.strictEqual(fx.Prodotti[0].length, 15);
});

t('setup si ferma senza scrivere se P1 contiene altro', () => {
  const s = clone(fx.Prodotti); s[0][15] = 'foo';
  const h = load({ sheets: { Prodotti: s } }); const before = snap(h);
  assert.throws(() => h.fn.setup(), /P1/); assert.strictEqual(snap(h), before);
  assert.strictEqual(h.formats('Prodotti').length, 0);
});
t('setup si ferma se esiste una riga senza id ma con altre celle', () => {
  const s = clone(fx.Prodotti); s.push(['', '', 'Orfano', '', '', 'Altro', '', 1]);
  const h = load({ sheets: { Prodotti: s } }); const before = snap(h);
  assert.throws(() => h.fn.setup(), /senza id/); assert.strictEqual(snap(h), before);
});
t('setup si ferma se manca la proprietà TOKEN', () => {
  const h = load({ props: {} }); const before = snap(h);
  assert.throws(() => h.fn.setup(), /TOKEN/); assert.strictEqual(snap(h), before);
});
t('setup si ferma se le intestazioni esistenti non corrispondono alle colonne attese', () => {
  const s = clone(fx.Prodotti); s[0][2] = 'titolo';
  const h = load({ sheets: { Prodotti: s } }); const before = snap(h);
  assert.throws(() => h.fn.setup(), /intestazione/); assert.strictEqual(snap(h), before);
});
t('setup valido: cambia solo P1 e il formato della colonna 16; righe, Spesa e Movimenti identici', () => {
  const h = load(); const before = clone({ P: h.values('Prodotti'), S: h.values('Spesa'), M: h.values('Movimenti') });
  h.fn.setup();
  const after = h.values('Prodotti');
  eq(after[0].slice(0, 15), before.P[0]); assert.strictEqual(after[0][15], 'lotti');
  eq(after.slice(1).map(r => r.slice(0, 15)), before.P.slice(1));
  assert.ok(after.slice(1).every(r => (r[15] === undefined || r[15] === '')));
  eq(h.values('Spesa'), before.S); eq(h.values('Movimenti'), before.M);
  const f = h.formats('Prodotti'); assert.ok(f.length >= 1 && f.every(x => x.c === 16 && x.f === '@'), 'formato testo solo sulla colonna 16');
  eq(h.triggers.map(x => x.fn).sort(), ['pulisciStorico', 'snapshot']);
});
t('setup è idempotente', () => {
  const h = load(); h.fn.setup(); const once = snap(h); h.fn.setup();
  eq(JSON.parse(snap(h)).P, JSON.parse(once).P); assert.strictEqual(h.triggers.length, 2);
});
t('setup espande le colonne se il foglio ne ha meno di 16, senza toccare i dati', () => {
  const h = load({ maxCols: { Prodotti: 15 } }); const before = clone(h.values('Prodotti'));
  h.fn.setup(); assert.ok(h.ss.getSheetByName('Prodotti').getMaxColumns() >= 16);
  eq(h.values('Prodotti').slice(1).map(r => r.slice(0, 15)), before.slice(1));
});
t('setup su un foglio vuoto crea i tre fogli con le intestazioni', () => {
  const h = loadBackend(CODE, { props: { TOKEN: 'tok' } }); h.fn.setup();
  eq(h.values('Prodotti')[0].length, 16); eq(h.values('Prodotti')[0][15], 'lotti');
  assert.ok(h.ss.getSheetByName('Spesa') && h.ss.getSheetByName('Movimenti'));
});

t('auditDb segnala ogni anomalia e non modifica Prodotti', () => {
  const base = wide(fx.Prodotti);
  const dupId = base[1].slice(); dupId[1] = '9990000000001';           // id duplicato di p1abc
  const badQty = base[2].slice(); badQty[0] = 'pA'; badQty[1] = '1000000000001'; badQty[7] = 'abc';
  const badNome = base[3].slice(); badNome[0] = 'pB'; badNome[1] = '1000000000002'; badNome[2] = 123;
  const badDate = base[4].slice(); badDate[0] = 'pC'; badDate[1] = '1000000000003'; badDate[9] = '12/11/2026';
  const badLotti = base[5].slice(); badLotti[0] = 'pD'; badLotti[1] = '1000000000004'; badLotti[15] = '{';
  const badSum = base[6].slice(); badSum[0] = 'pE'; badSum[1] = '1000000000005'; badSum[7] = 3; badSum[15] = '[{"d":"2026-11-10","q":1}]';
  const dupBc = base[7].slice(); dupBc[0] = 'pF'; dupBc[1] = base[1][1];                 // barcode duplicato di p1abc
  const noId = ['', '', 'Orfano', '', '', 'Altro', '', 1].concat(Array(8).fill(''));
  const rows = base.concat([dupId, badQty, badNome, badDate, badLotti, badSum, dupBc, noId]);
  dupId[0] = 'p1abc';
  const h = load({ sheets: { Prodotti: rows } }); const before = clone(h.values('Prodotti')); const names = h.sheetNames();
  h.fn.auditDb();
  eq(h.values('Prodotti'), before);
  eq(h.sheetNames(), names.concat(['Audit']));
  const rep = h.values('Audit').slice(1); const tipi = rep.map(r => r[0]);
  const find = tipo => rep.filter(r => r[0] === tipo);
  assert.ok(find('id duplicato').length >= 1); assert.ok(find('barcode duplicato').length >= 1);
  assert.strictEqual(find('qty non numerica')[0][2], 'pA'); assert.strictEqual(find('nome numerico')[0][2], 'pB');
  assert.strictEqual(find('data non ISO')[0][2], 'pC'); assert.strictEqual(find('lotti non valida')[0][2], 'pD');
  assert.strictEqual(find('lotti somma diversa da qty')[0][2], 'pE'); assert.strictEqual(find('riga senza id')[0][1], rows.length);
  assert.ok(!tipi.includes(undefined));
});
t('auditDb su dati puliti non segnala nulla', () => {
  const h = load(); h.fn.auditDb(); eq(h.values('Audit').length, 1);
});

t('snapshot copia Prodotti e Spesa, non cancella mai e può ripetersi', () => {
  const h = load(); const before = clone({ P: h.values('Prodotti'), S: h.values('Spesa') });
  h.fn.snapshot(); h.fn.snapshot();
  const bak = h.sheetNames().filter(x => x.startsWith('_bak_'));
  eq(bak.length, 4); assert.ok(bak.some(x => x.endsWith('_Prodotti')) && bak.some(x => x.endsWith('_Spesa')));
  eq(h.values('Prodotti'), before.P); eq(h.values('Spesa'), before.S);
  eq(h.values(bak.find(x => x.endsWith('_Prodotti'))), before.P);
});

t('prepareRollback svuota solo la colonna lotti e riporta quanti prodotti', () => {
  const rows = wide(fx.Prodotti); rows[1][15] = '[{"d":"2026-11-10","q":3}]'; rows[3][15] = '[{"d":"","q":5}]';
  const h = load({ sheets: { Prodotti: rows } }); const before = clone(h.values('Prodotti'));
  assert.strictEqual(h.fn.prepareRollback(), 2);
  const after = h.values('Prodotti');
  eq(after.map(r => r.slice(0, 15)), before.map(r => r.slice(0, 15)));
  assert.ok(after.slice(1).every(r => r[15] === '' || r[15] === undefined)); assert.strictEqual(after[0][15], 'lotti');
});

t('il token si legge solo dalla proprietà TOKEN: costante segnaposto e token vuoto non passano', () => {
  const h = load();
  assert.strictEqual(h.get({ token: 'tok' }).ok, true);
  assert.strictEqual(h.get({ token: 'altro' }).error, 'token');
  assert.strictEqual(h.get({ token: 'CAMBIA-QUESTO-TOKEN' }).error, 'token');
  assert.strictEqual(h.post({ token: 'x', ops: [] }).error, 'token');
  assert.strictEqual(h.post({ token: 'tok', ops: [] }).ok, true);
  const nop = load({ props: {} });
  assert.strictEqual(nop.get({ token: '' }).error, 'token'); assert.strictEqual(nop.get({}).error, 'token');
  assert.strictEqual(nop.post({ ops: [] }).error, 'token');
});
console.log(n + ' test superati');
