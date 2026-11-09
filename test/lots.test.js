'use strict';
const assert = require('assert'); const L = require('../lib/lots.js');
const eq = assert.deepStrictEqual;
let seed = 12345; const rnd = () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let x = Math.imul(seed ^ (seed >>> 15), 1 | seed); x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x; return ((x ^ (x >>> 14)) >>> 0) / 4294967296; };  // PRNG con seed: test riproducibile
let n = 0; const t = (name, f) => { f(); n++; console.log('ok -', name); };

t('lotto virtuale per prodotto legacy (colonna lotti vuota)', () => {
  eq(L.effectiveLots({ qty: 3, scadenza: '2026-11-10', lotti: '' }), [{ d: '2026-11-10', q: 3 }]);
  eq(L.effectiveLots({ qty: 0, scadenza: '2026-11-10', lotti: '' }), []);
});
t('carico con data aggiunge un lotto e aggiorna la prossima scadenza', () => {
  const r = L.applyDelta({ qty: 3, scadenza: '2026-11-10', lotti: '' }, 2, '2026-11-20');
  eq(L.parseLots(r.item.lotti), [{ d: '2026-11-10', q: 3 }, { d: '2026-11-20', q: 2 }]);
  assert.strictEqual(r.item.qty, 5); assert.strictEqual(r.item.scadenza, '2026-11-10');
});
t('carico con la stessa data unisce i lotti', () => {
  const r = L.applyDelta({ qty: 2, scadenza: '', lotti: '[{"d":"2026-11-20","q":2}]' }, 1, '2026-11-20');
  eq(L.parseLots(r.item.lotti), [{ d: '2026-11-20', q: 3 }]);
});
t('scarico consuma dal lotto che scade prima (FEFO)', () => {
  const r = L.applyDelta({ qty: 5, scadenza: '2026-11-10', lotti: '[{"d":"2026-11-10","q":3},{"d":"2026-11-20","q":2}]' }, -3);
  eq(r.taken, [{ d: '2026-11-10', q: 3 }]); eq(L.parseLots(r.item.lotti), [{ d: '2026-11-20', q: 2 }]);
  assert.strictEqual(r.item.scadenza, '2026-11-20');
});
t('i lotti senza data si consumano per ultimi', () => {
  const r = L.applyDelta({ qty: 3, scadenza: '', lotti: '[{"d":"","q":1},{"d":"2026-11-20","q":2}]' }, -2);
  eq(r.taken, [{ d: '2026-11-20', q: 2 }]); eq(L.parseLots(r.item.lotti), [{ d: '', q: 1 }]);
});
t('scarico oltre la giacenza si ferma a zero, senza errori', () => {
  const r = L.applyDelta({ qty: 1, scadenza: '', lotti: '[{"d":"","q":1}]' }, -5);
  assert.strictEqual(r.item.qty, 0); assert.strictEqual(r.item.lotti, ''); eq(r.taken, [{ d: '', q: 1 }]);
  const z = L.applyDelta({ qty: 0, scadenza: '', lotti: '' }, -1); assert.strictEqual(z.item.qty, 0); eq(z.taken, []);
});
t('riconciliazione: per difetto aggiunge senza data, per eccesso toglie dal più vecchio', () => {
  eq(L.reconcile([{ d: '2026-11-10', q: 2 }, { d: '2026-12-01', q: 2 }], 6), [{ d: '2026-11-10', q: 2 }, { d: '2026-12-01', q: 2 }, { d: '', q: 2 }]);
  eq(L.reconcile([{ d: '2026-11-10', q: 2 }, { d: '2026-12-01', q: 2 }], 3), [{ d: '2026-11-10', q: 1 }, { d: '2026-12-01', q: 2 }]);
});
t('moveUnits sposta al massimo quanto c\'è nel lotto di partenza', () => {
  eq(L.moveUnits([{ d: '2026-11-20', q: 2 }, { d: '', q: 1 }], '', '2026-12-05', 1), [{ d: '2026-11-20', q: 2 }, { d: '2026-12-05', q: 1 }]);
  eq(L.moveUnits([{ d: '', q: 1 }], '', '2026-12-05', 3), [{ d: '2026-12-05', q: 1 }]);
  eq(L.moveUnits([{ d: '2026-11-20', q: 2 }], '', '2026-12-05', 1), [{ d: '2026-11-20', q: 2 }]);
});
t('parseLots tollera valori non validi', () => {
  eq(L.parseLots('non json'), []); eq(L.parseLots('[{"d":"2026-11-10","q":0}]'), []); eq(L.parseLots(''), []);
});
t('scarico da un lotto preciso; se non basta o non esiste il resto va in FEFO', () => {
  const p = { qty: 5, scadenza: '2026-11-10', lotti: '[{"d":"2026-11-10","q":3},{"d":"2026-11-20","q":2}]' };
  let r = L.applyDelta(p, -1, '2026-11-20');
  eq(r.taken, [{ d: '2026-11-20', q: 1 }]); eq(L.parseLots(r.item.lotti), [{ d: '2026-11-10', q: 3 }, { d: '2026-11-20', q: 1 }]);
  r = L.applyDelta(p, -3, '2026-11-20');
  eq(r.taken, [{ d: '2026-11-20', q: 2 }, { d: '2026-11-10', q: 1 }]); eq(L.parseLots(r.item.lotti), [{ d: '2026-11-10', q: 2 }]);
  r = L.applyDelta(p, -1, '2026-11-12');
  eq(r.taken, [{ d: '2026-11-10', q: 1 }]); assert.strictEqual(r.item.qty, 4);
});
t('le date non ISO diventano "senza data" e non alterano l\'ordine', () => {
  eq(L.parseLots('[{"d":"05/01/2027","q":1},{"d":"2026-12-01","q":1}]'), [{ d: '', q: 1 }, { d: '2026-12-01', q: 1 }]);
  eq(L.addToLot([], 'domani', 1), [{ d: '', q: 1 }]);
});
t('delta zero su prodotto legacy materializza il lotto virtuale (il prodotto è toccato)', () => {
  const r = L.applyDelta({ qty: 2, scadenza: '2026-11-10', lotti: '' }, 0);
  assert.strictEqual(r.item.lotti, '[{"d":"2026-11-10","q":2}]');
});
t('invariante somma lotti = quantità su 20000 sequenze casuali', () => {
  const ds = ['', '2026-11-15', '2026-12-01']; let bad = 0;
  for (let i = 0; i < 20000; i++) {
    let p = { qty: Math.floor(rnd() * 4), scadenza: rnd() < .5 ? '2026-11-05' : '', lotti: '' };
    for (let k = 0; k < 8; k++) {
      const q = 1 + Math.floor(rnd() * 3);
      p = L.applyDelta(p, rnd() < .5 ? q : -q, ds[Math.floor(rnd() * 3)]).item;
      if (L.total(L.parseLots(p.lotti)) !== p.qty) bad++;
    }
  }
  assert.strictEqual(bad, 0);
});
t('il totale non dipende dall\'ordine delle operazioni', () => {
  const ops = [2, -1, 1, -2], s0 = { qty: 3, scadenza: '2026-11-10', lotti: '' };
  const run = (o) => o.reduce((p, d) => L.applyDelta(p, d, d > 0 ? '2026-12-01' : undefined).item, s0).qty;
  assert.strictEqual(run(ops), run([...ops].reverse()));
});
console.log(n + ' test superati');
