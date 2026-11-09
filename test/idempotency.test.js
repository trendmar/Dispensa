'use strict';
// Q7: idempotenza delle operazioni con opId (CacheService, 6 ore).
const assert = require('assert'); const H = require('./helpers.js');
const eq = assert.deepStrictEqual;
let n = 0; const t = (name, f) => { f(); n++; console.log('ok -', name); };
const P = 'p1abc';
const o1 = { op: 'delta', id: P, delta: 1, user: 'Mario', opId: 'o1' };
const o2 = { op: 'delta', id: P, delta: 1, user: 'Mario', opId: 'o2' };
const o3 = { op: 'delta', id: P, delta: 1, user: 'Mario', opId: 'o3' };

t('stesso blocco inviato due volte: la seconda risposta è dup e qty non cambia', () => {
  const h = H.backend({ catScad: ['Latticini'] });
  H.post(h, [o1, o2]); assert.strictEqual(H.rowOf(h, P).qty, 5);
  const r = H.post(h, [o1, o2]);
  eq(r.results, [{ ok: true, dup: true }, { ok: true, dup: true }]); assert.strictEqual(H.rowOf(h, P).qty, 5);
  assert.strictEqual(r.ok, true); assert.ok(Array.isArray(r.items));
});
t('blocco misto (o1 già vista, o3 nuova): si applica solo o3', () => {
  const h = H.backend({ catScad: [] });
  H.post(h, [o1]); const r = H.post(h, [o1, o3]);
  eq(r.results[0], { ok: true, dup: true }); assert.strictEqual(r.results[1].qty, 5); assert.strictEqual(H.rowOf(h, P).qty, 5);
});
t('lo stesso opId due volte nello stesso blocco si applica una volta', () => {
  const h = H.backend({ catScad: [] });
  const r = H.post(h, [o1, o1]); eq(r.results[1], { ok: true, dup: true }); assert.strictEqual(H.rowOf(h, P).qty, 4);
});
t('una getAll e una putAll per richiesta, scadenza 6 ore, chiavi op:<opId>', () => {
  const h = H.backend({ catScad: [] }); const g0 = h.cacheCalls.getAll;
  H.post(h, [o1, o2, o3]);
  assert.strictEqual(h.cacheCalls.getAll - g0, 1); assert.strictEqual(h.cachePuts.length, 1);
  assert.strictEqual(h.cachePuts[0].ttl, 21600); eq(h.cachePuts[0].keys.sort(), ['op:o1', 'op:o2', 'op:o3']);
});
t('operazioni senza opId (app 1.1) si applicano ogni volta e non toccano la cache', () => {
  const h = H.backend({ catScad: [] }); const op = { op: 'delta', id: P, delta: 1, user: 'Mario' };
  const g0 = h.cacheCalls.getAll;
  H.post(h, [op]); H.post(h, [op]); assert.strictEqual(H.rowOf(h, P).qty, 5);
  assert.strictEqual(h.cacheCalls.getAll, g0); assert.strictEqual(h.cachePuts.length, 0);
});
t('lotMove e cfgSet duplicati non si riapplicano', () => {
  const h = H.backend({ catScad: ['Latticini'] });
  const mv = { op: 'lotMove', id: P, from: '2026-11-10', to: '2026-12-01', q: 1, user: 'Mario', opId: 'm1' };
  H.post(h, [mv]); const r = H.post(h, [mv]); eq(r.results, [{ ok: true, dup: true }]);
  eq(H.lotsOf(h, P), [{ d: '2026-11-10', q: 2 }, { d: '2026-12-01', q: 1 }]);
});
t('alexaSync resta invariato: nessuna idempotenza e nessun config nella risposta', () => {
  const h = H.backend({ catScad: [] });
  const r = h.post({ token: 'tok', action: 'alexaSync', alexa: [] });
  assert.strictEqual(r.ok, true); assert.ok(Array.isArray(r.add)); assert.strictEqual(r.config, undefined);
});
console.log(n + ' test superati');
