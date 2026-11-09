'use strict';
// R1.2-R1.6: configurazione catScad, delta (con lot), lotMove, cfgSet; esempio calcolato dell'Appendice A.
const assert = require('assert'); const H = require('./helpers.js');
const eq = assert.deepStrictEqual;
let n = 0; const t = (name, f) => { f(); n++; console.log('ok -', name); };
const P = 'p1abc';
const A = [
  { op: 'delta', id: P, delta: 1, lot: '2026-11-20', user: 'Mario', opId: 'o1' },
  { op: 'delta', id: P, delta: -1, user: 'Alba', opId: 'o2' },
  { op: 'delta', id: P, delta: 1, user: 'Mario', opId: 'o3' },
  { op: 'lotMove', id: P, from: '', to: '2026-12-05', q: 1, user: 'Mario', opId: 'o4' },
  { op: 'delta', id: P, delta: -1, lot: '2026-11-12', user: 'Mario', opId: 'o5' },
  { op: 'cfgSet', key: 'catScad', value: ['Latticini', 'Carne e pesce'], user: 'Mario', opId: 'o6' },
];
const STEPS = [  // qty e lotti dopo ciascuna operazione (Appendice A)
  [4, [{ d: '2026-11-10', q: 3 }, { d: '2026-11-20', q: 1 }]],
  [3, [{ d: '2026-11-10', q: 2 }, { d: '2026-11-20', q: 1 }]],
  [4, [{ d: '2026-11-10', q: 2 }, { d: '2026-11-20', q: 1 }, { d: '', q: 1 }]],
  [4, [{ d: '2026-11-10', q: 2 }, { d: '2026-11-20', q: 1 }, { d: '2026-12-05', q: 1 }]],
  [3, [{ d: '2026-11-10', q: 1 }, { d: '2026-11-20', q: 1 }, { d: '2026-12-05', q: 1 }]],
  [3, [{ d: '2026-11-10', q: 1 }, { d: '2026-11-20', q: 1 }, { d: '2026-12-05', q: 1 }]],
];

t('doGet restituisce version 1.2.0 e config con catScad (vuota se la proprietà manca o è invalida)', () => {
  const g = H.backend().get({ token: 'tok' });
  assert.strictEqual(g.version, '1.2.0'); eq(g.config, { catScad: [] });
  const bad = H.backend({ setup: true }); bad.props.set('catScad', 'non json');
  eq(bad.get({ token: 'tok' }).config, { catScad: [] });
  bad.props.set('catScad', '{"a":1}'); eq(bad.get({ token: 'tok' }).config, { catScad: [] });
  const ok = H.backend({ catScad: ['Latticini'] }); eq(ok.get({ token: 'tok' }).config, { catScad: ['Latticini'] });
});

t('Appendice A: ogni operazione dà qty e lotti attesi', () => {
  const h = H.backend({ catScad: ['Latticini'] });
  A.forEach((op, i) => {
    const r = H.post(h, [op]);
    assert.strictEqual(r.ok, true); assert.strictEqual(r.results[0].ok, true, 'op ' + (i + 1));
    assert.strictEqual(H.rowOf(h, P).qty, STEPS[i][0], 'qty dopo o' + (i + 1));
    eq(H.lotsOf(h, P), STEPS[i][1], 'lotti dopo o' + (i + 1));
  });
  assert.strictEqual(H.rowOf(h, P).scadenza, '2026-11-10');
  eq(h.get({ token: 'tok' }).config, { catScad: ['Latticini', 'Carne e pesce'] });
});

t('Appendice A in un solo blocco: results, items e config come nell\'esempio', () => {
  const h = H.backend({ catScad: ['Latticini'] });
  const r = H.post(h, A);
  eq(r.results, [{ ok: true, qty: 4 }, { ok: true, qty: 3 }, { ok: true, qty: 4 }, { ok: true }, { ok: true, qty: 3 }, { ok: true }]);
  const it = r.items.find(x => x.id === P);
  assert.strictEqual(it.qty, 3); assert.strictEqual(it.scadenza, '2026-11-10');
  assert.strictEqual(it.lotti, '[{"d":"2026-11-10","q":1},{"d":"2026-11-20","q":1},{"d":"2026-12-05","q":1}]');
  eq(r.config, { catScad: ['Latticini', 'Carne e pesce'] }); assert.strictEqual(r.version, '1.2.0');
});

t('lotMove non scrive su Movimenti; delta sì (una riga per delta)', () => {
  const h = H.backend({ catScad: ['Latticini'] });
  H.post(h, A.slice(0, 3)); const m0 = h.values('Movimenti').length;
  H.post(h, [A[3]]); assert.strictEqual(h.values('Movimenti').length, m0);
  H.post(h, [A[4]]); assert.strictEqual(h.values('Movimenti').length, m0 + 1);
});

t('delta 0 su prodotto tracciato materializza il lotto virtuale (è un tocco)', () => {
  const h = H.backend({ catScad: ['Latticini'] });
  assert.strictEqual(H.rowOf(h, P).lotti, '');
  H.post(h, [{ op: 'delta', id: P, delta: 0, user: 'Mario' }]);
  assert.strictEqual(H.rowOf(h, P).lotti, '[{"d":"2026-11-10","q":3}]'); assert.strictEqual(H.rowOf(h, P).qty, 3);
});

t('qty = 0: nessun lotto; il carico successivo crea il lotto senza data e svuota la scadenza derivata', () => {
  const h = H.backend({ catScad: ['Latticini'] });                  // p4jkl: Latticini, qty 0, scadenza 2026-11-12
  H.post(h, [{ op: 'delta', id: 'p4jkl', delta: 1, user: 'Mario' }]);
  eq(H.lotsOf(h, 'p4jkl'), [{ d: '', q: 1 }]); assert.strictEqual(H.rowOf(h, 'p4jkl').scadenza, '');
  assert.strictEqual(H.rowOf(h, 'p4jkl').stato, '');
});

t('scarico oltre la giacenza si ferma a 0 senza errori e svuota i lotti', () => {
  const h = H.backend({ catScad: ['Latticini'] });
  const r = H.post(h, [{ op: 'delta', id: P, delta: -9, user: 'Mario' }]);
  eq(r.results, [{ ok: true, qty: 0 }]); assert.strictEqual(H.rowOf(h, P).lotti, ''); assert.strictEqual(H.rowOf(h, P).scadenza, '');
});

t('categoria non attiva: delta come in v1.1, lotti e scadenza non toccati', () => {
  const h = H.backend({ catScad: ['Carne e pesce'] });
  H.post(h, [{ op: 'delta', id: P, delta: 2, lot: '2026-12-01', user: 'Mario' }]);
  assert.strictEqual(H.rowOf(h, P).qty, 5); assert.strictEqual(H.rowOf(h, P).lotti, ''); assert.strictEqual(H.rowOf(h, P).scadenza, '2026-11-10');
});

t('lot non ISO vale "senza data"', () => {
  const h = H.backend({ catScad: ['Latticini'] });
  H.post(h, [{ op: 'delta', id: P, delta: 1, lot: '12/11/2026', user: 'Mario' }]);
  eq(H.lotsOf(h, P), [{ d: '2026-11-10', q: 3 }, { d: '', q: 1 }]);
});

t('lotMove su prodotto non tracciato è un no-op senza errori e non tocca la riga', () => {
  const h = H.backend({ catScad: [] }); const before = JSON.stringify(H.rowOf(h, P));
  const r = H.post(h, [{ op: 'lotMove', id: P, from: '', to: '2026-12-05', q: 1, user: 'Mario' }]);
  eq(r.results, [{ ok: true }]); assert.strictEqual(JSON.stringify(H.rowOf(h, P)), before);
});

t('lotMove su prodotto inesistente: errore per operazione, richiesta ok', () => {
  const h = H.backend({ catScad: ['Latticini'] });
  const r = H.post(h, [{ op: 'lotMove', id: 'nope', from: '', to: '', q: 1 }]);
  assert.strictEqual(r.ok, true); assert.strictEqual(r.results[0].ok, false);
});

t('cfgSet: valore non valido o chiave sconosciuta → errore per operazione, config invariata', () => {
  const h = H.backend({ catScad: ['Latticini'] });
  const r = H.post(h, [
    { op: 'cfgSet', key: 'catScad', value: 'Latticini' }, { op: 'cfgSet', key: 'catScad', value: [1, 2] },
    { op: 'cfgSet', key: 'altro', value: [] }, { op: 'cfgSet', key: 'catScad', value: [' Carne e pesce ', 'Carne e pesce', ''] }]);
  assert.strictEqual(r.ok, true);
  eq(r.results.map(x => x.ok), [false, false, false, true]);
  eq(h.get({ token: 'tok' }).config, { catScad: ['Carne e pesce'] });
});

t('il consumo FEFO usa le unità senza data per ultime', () => {
  const h = H.backend({ catScad: ['Latticini'], mutate: s => { s.Prodotti[1][15] = '[{"d":"","q":1},{"d":"2026-11-20","q":2}]'; s.Prodotti[1][9] = '2026-11-20'; s.Prodotti[0][15] = 'lotti'; } });
  H.post(h, [{ op: 'delta', id: P, delta: -2, user: 'Mario' }]);
  eq(H.lotsOf(h, P), [{ d: '', q: 1 }]); assert.strictEqual(H.rowOf(h, P).scadenza, '');
});

t('una riga console.log per richiesta con operazioni e millisecondi (Q10)', () => {
  const h = H.backend({ catScad: ['Latticini'] }); h.logs.length = 0;
  H.post(h, [A[0], A[1]]);
  const l = h.logs.filter(x => /ms/.test(x)); assert.strictEqual(l.length, 1); assert.ok(/delta/.test(l[0]));
});
console.log(n + ' test superati');
