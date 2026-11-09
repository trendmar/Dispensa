'use strict';
// Integrazione: due client simulati con richieste interallacciate; invariante somma lotti = qty sul foglio.
const assert = require('assert'); const H = require('./helpers.js');
let n = 0; const t = (name, f) => { f(); n++; console.log('ok -', name); };
let seed = 777; const rnd = () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let x = Math.imul(seed ^ (seed >>> 15), 1 | seed); x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x; return ((x ^ (x >>> 14)) >>> 0) / 4294967296; };
const pick = a => a[Math.floor(rnd() * a.length)];
const DATES = ['', '2026-11-10', '2026-11-12', '2026-11-20', '2026-12-05', 'non-una-data'];

t('due telefoni scaricano insieme lo stesso prodotto: FEFO sul server, somma lotti = qty', () => {
  const h = H.backend({ catScad: ['Latticini'] });                      // p1abc: qty 3, lotto virtuale 11-10
  H.post(h, [{ op: 'delta', id: 'p1abc', delta: 2, lot: '2026-11-20', user: 'Mario', opId: 'a1' }]);
  H.post(h, [{ op: 'delta', id: 'p1abc', delta: -1, user: 'Mario', opId: 'a2' }]);
  H.post(h, [{ op: 'delta', id: 'p1abc', delta: -1, user: 'Alba', opId: 'b1' }]);
  assert.strictEqual(H.rowOf(h, 'p1abc').qty, 3);
  assert.deepStrictEqual(H.lotsOf(h, 'p1abc'), [{ d: '2026-11-10', q: 1 }, { d: '2026-11-20', q: 2 }]);
});

t('1000 richieste casuali di due client: somma lotti = qty, qty ≥ 0, scadenza = prima data non vuota', () => {
  const h = H.backend({ catScad: ['Latticini', 'Carne e pesce'] });
  const ids = ['p1abc', 'p4jkl', 'p5mno'];
  let k = 0;
  for (let i = 0; i < 1000; i++) {
    const user = i % 2 ? 'Mario' : 'Alba'; const id = pick(ids);
    const r = rnd(); let op;
    if (r < .35) op = { op: 'delta', id, delta: 1, lot: pick(DATES), user };
    else if (r < .65) op = { op: 'delta', id, delta: -1 - Math.floor(rnd() * 2), lot: rnd() < .4 ? pick(DATES) : undefined, user };
    else if (r < .85) op = { op: 'lotMove', id, from: pick(DATES), to: pick(DATES), q: 1 + Math.floor(rnd() * 3), user };
    else if (r < .93) op = { op: 'delta', id, delta: 0, user };
    else op = { op: 'upsert', item: Object.assign({}, h.get({ token: 'tok' }).items.find(x => x.id === id), { note: 'n' + i, scadenza: '2001-01-01', lotti: '[{"d":"2001-01-01","q":50}]' }), qtyDelta: Math.floor(rnd() * 5) - 2, user };
    op.opId = 'r' + (k++);
    const res = H.post(h, [op]);
    assert.strictEqual(res.ok, true);
    ids.forEach(pid => {
      const row = H.rowOf(h, pid), lots = H.lotsOf(h, pid);
      assert.ok(row.qty >= 0, 'qty negativa');
      if (row.lotti !== '') {                                              // prodotto toccato: lotti scritti e coerenti
        assert.strictEqual(lots.reduce((s, l) => s + l.q, 0), row.qty, `somma≠qty ${pid} dopo ${JSON.stringify(op)}`);
        assert.ok(lots.every(l => l.q > 0 && (l.d === '' || /^\d{4}-\d{2}-\d{2}$/.test(l.d))));
        const first = lots.map(l => l.d).filter(Boolean).sort()[0] || '';
        assert.strictEqual(row.scadenza, first, 'scadenza derivata ' + pid);
      }
    });
  }
});
console.log(n + ' test superati');
