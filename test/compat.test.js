'use strict';
// §6.3: app 1.1 contro backend 1.2, regole di upsert (R1.4a), riconciliazione (R1.3).
const assert = require('assert'); const H = require('./helpers.js');
const eq = assert.deepStrictEqual;
let n = 0; const t = (name, f) => { f(); n++; console.log('ok -', name); };
const P = 'p1abc';
const item = (h, id) => h.get({ token: 'tok' }).items.find(x => x.id === id);

t('upsert 1.1 con lotti e scadenza vecchie su categoria attiva: i lotti non cambiano e la scadenza resta derivata', () => {
  const h = H.backend({ catScad: ['Latticini'] });
  H.post(h, [{ op: 'delta', id: P, delta: 2, lot: '2026-12-01', user: 'Mario' }]);          // materializza: 11-10 ×3, 12-01 ×2
  const stale = Object.assign({}, item(h, P), { lotti: '[{"d":"2030-01-01","q":99}]', scadenza: '2020-01-01', note: 'x' });
  H.post(h, [{ op: 'upsert', item: stale, qtyDelta: 0, user: 'Alba' }]);
  eq(H.lotsOf(h, P), [{ d: '2026-11-10', q: 3 }, { d: '2026-12-01', q: 2 }]);
  assert.strictEqual(H.rowOf(h, P).scadenza, '2026-11-10'); assert.strictEqual(H.rowOf(h, P).note, 'x'); assert.strictEqual(H.rowOf(h, P).qty, 5);
});
t('upsert su prodotto con lotti virtuali ignora i lotti del client e materializza quelli effettivi', () => {
  const h = H.backend({ catScad: ['Latticini'] });
  const stale = Object.assign({}, item(h, P), { lotti: '[{"d":"2030-01-01","q":99}]', scadenza: '2020-01-01' });
  H.post(h, [{ op: 'upsert', item: stale, qtyDelta: 0, user: 'Alba' }]);
  eq(H.lotsOf(h, P), [{ d: '2026-11-10', q: 3 }]); assert.strictEqual(H.rowOf(h, P).scadenza, '2026-11-10');
});
t('upsert del solo nome su categoria attiva è un tocco: lotti materializzata', () => {
  const h = H.backend({ catScad: ['Latticini'] });
  H.post(h, [{ op: 'upsert', item: Object.assign({}, item(h, P), { nome: 'Yogurt greco bio' }), qtyDelta: 0, user: 'Mario' }]);
  assert.strictEqual(H.rowOf(h, P).nome, 'Yogurt greco bio'); eq(H.lotsOf(h, P), [{ d: '2026-11-10', q: 3 }]);
});
t('upsert con variazione di quantità su categoria attiva segue delta senza lot', () => {
  const h = H.backend({ catScad: ['Latticini'] });
  H.post(h, [{ op: 'upsert', item: item(h, P), qtyDelta: 2, user: 'Mario' }]);
  eq(H.lotsOf(h, P), [{ d: '2026-11-10', q: 3 }, { d: '', q: 2 }]); assert.strictEqual(H.rowOf(h, P).qty, 5);
  H.post(h, [{ op: 'upsert', item: item(h, P), qtyDelta: -4, user: 'Mario' }]);
  eq(H.lotsOf(h, P), [{ d: '', q: 1 }]); assert.strictEqual(H.rowOf(h, P).qty, 1);
});
t('upsert di un prodotto nuovo con categoria attiva ignora lotti del client e crea il primo lotto da qty e scadenza', () => {
  const h = H.backend({ catScad: ['Latticini'] });
  H.post(h, [{ op: 'upsert', item: { id: 'pn1', nome: 'Burro', categoria: 'Latticini', qty: 2, scadenza: '2026-12-01', lotti: '[{"d":"2030-01-01","q":99}]', barcode: '77' }, user: 'Mario' }]);
  eq(H.lotsOf(h, 'pn1'), [{ d: '2026-12-01', q: 2 }]); assert.strictEqual(H.rowOf(h, 'pn1').scadenza, '2026-12-01');
});
t('upsert che cambia categoria verso una attiva: la scadenza del client è ignorata, lotto virtuale dalla scadenza esistente', () => {
  const h = H.backend({ catScad: ['Latticini'] });
  H.post(h, [{ op: 'upsert', item: Object.assign({}, item(h, 'p2def'), { categoria: 'Latticini', scadenza: '2020-01-01' }), qtyDelta: 0, user: 'Mario' }]);
  eq(H.lotsOf(h, 'p2def'), [{ d: '2027-03-01', q: 4 }]); assert.strictEqual(H.rowOf(h, 'p2def').scadenza, '2027-03-01');
});
t('upsert su categoria non attiva copia la scadenza come in v1.1 e non tocca lotti', () => {
  const h = H.backend({ catScad: ['Latticini'] });
  H.post(h, [{ op: 'upsert', item: Object.assign({}, item(h, 'p2def'), { scadenza: '2028-01-01', lotti: '[{"d":"2030-01-01","q":9}]' }), qtyDelta: 0, user: 'Mario' }]);
  assert.strictEqual(H.rowOf(h, 'p2def').scadenza, '2028-01-01'); assert.strictEqual(H.rowOf(h, 'p2def').lotti, '');
});
t('categoria spenta con lotti valorizzati: qty cambia, lotti no; riaccesa si riconcilia in memoria e al tocco si scrive', () => {
  const h = H.backend({ catScad: ['Latticini'] });
  H.post(h, [{ op: 'delta', id: P, delta: 0, user: 'Mario' }]);                       // materializza 11-10 ×3
  h.props.set('catScad', '[]');
  H.post(h, [{ op: 'delta', id: P, delta: 1, user: 'Mario' }]);                       // spenta: qty 4, lotti invariati
  assert.strictEqual(H.rowOf(h, P).qty, 4); eq(H.lotsOf(h, P), [{ d: '2026-11-10', q: 3 }]);
  h.props.set('catScad', '["Latticini"]');
  assert.strictEqual(item(h, P).lotti, '[{"d":"2026-11-10","q":3}]');                // lettura: nessuna scrittura
  H.post(h, [{ op: 'delta', id: P, delta: 0, user: 'Mario' }]);
  eq(H.lotsOf(h, P), [{ d: '2026-11-10', q: 3 }, { d: '', q: 1 }]);
});
t('con catScad=[] delta e upsert 1.1 non toccano mai lotti', () => {
  const h = H.backend({ catScad: [] });
  H.post(h, [{ op: 'delta', id: P, delta: -1, user: 'Mario' }, { op: 'delta', id: P, delta: 4, lot: '2026-12-01', user: 'Mario' }]);
  assert.strictEqual(H.rowOf(h, P).qty, 6); assert.strictEqual(H.rowOf(h, P).lotti, '');
});
t('lotti non valida (JSON rotto) è trattata come vuota: ricade sul lotto virtuale, mai bloccante', () => {
  const h = H.backend({ catScad: ['Latticini'], mutate: s => { s.Prodotti[0][15] = 'lotti'; s.Prodotti[1][15] = '{rotto'; } });
  const r = H.post(h, [{ op: 'delta', id: P, delta: -1, user: 'Mario' }]);
  eq(r.results, [{ ok: true, qty: 2 }]); eq(H.lotsOf(h, P), [{ d: '2026-11-10', q: 2 }]);
});
t('app 1.1 senza opId e senza lot: carico va in "senza data", scarico FEFO', () => {
  const h = H.backend({ catScad: ['Latticini'] });
  H.post(h, [{ op: 'delta', id: P, delta: 1, user: 'Mario' }]); eq(H.lotsOf(h, P), [{ d: '2026-11-10', q: 3 }, { d: '', q: 1 }]);
  H.post(h, [{ op: 'delta', id: P, delta: -3, user: 'Mario' }]); eq(H.lotsOf(h, P), [{ d: '', q: 1 }]);
});
console.log(n + ' test superati');
