'use strict';
// R3.4 / §6.5: le righe dei prodotti NON toccati scritte dalla 1.2 sono identiche a quelle che scriverebbe la 1.1.
const assert = require('assert'); const H = require('./helpers.js');
let n = 0; const t = (name, f) => { f(); n++; console.log('ok -', name); };

const pad16 = r => r.concat(Array(16 - r.length).fill(''));
const byId = h => { const m = {}; h.values('Prodotti').slice(1).forEach(r => { m[String(r[0])] = pad16(r.slice(0, 16)); }); return m; };

function ops(h) {
  const it = h.get({ token: h.TOKEN }).items.find(x => x.id === 'p1abc');
  return [
    { op: 'delta', id: 'p1abc', delta: -1, user: 'Mario' },
    { op: 'delta', id: 'p2def', delta: 2, user: 'Alba' },
    { op: 'upsert', item: Object.assign({}, it, { note: 'aperto' }), qtyDelta: -1, user: 'Mario' },
    { op: 'stato', id: 'p2def', stato: 'comprare', user: 'Mario' },
    { op: 'delta', id: 'p1abc', delta: 3, user: 'Mario' },
    { op: 'upsert', item: { id: 'pnew', nome: 'Nuovo', categoria: 'Altro', qty: 2, scortaMin: 1, barcode: '0001', scadenza: '', note: '' }, user: 'Mario' },
    { op: 'delete', id: 'p2def', user: 'Mario' },
  ];
}
function run(catScad, touchedOnly) {
  const old = H.legacy(); old.TOKEN = 'CAMBIA-QUESTO-TOKEN';
  const now = H.backend({ catScad }); now.TOKEN = 'tok';
  const o = ops(old);
  old.post({ token: old.TOKEN, ops: o }); now.post({ token: 'tok', ops: o });
  return { old, now };
}

for (const cats of [[], ['Latticini', 'Carne e pesce']]) {
  t(`golden con catScad=${JSON.stringify(cats)}: righe dei prodotti non toccati identiche cella per cella`, () => {
    const { old, now } = run(cats);
    const a = byId(old), b = byId(now);
    const untouched = ['p3ghi', 'p4jkl', 'p5mno', 'p6pqr', 'p7stu'];   // p5mno e p4jkl sono di categorie attive ma non toccati
    untouched.forEach(id => assert.deepStrictEqual(b[id], a[id], 'riga ' + id));
    assert.deepStrictEqual(h2(now, 'Spesa'), h2(old, 'Spesa'));
    assert.deepStrictEqual(Object.keys(b).sort(), Object.keys(a).sort());
  });
}
function h2(h, name) { return h.values(name); }

t('golden con catScad=[]: anche i prodotti toccati sono uguali alla 1.1 (tranne updated) e Movimenti uguale (tranne data)', () => {
  const { old, now } = run([]);
  const a = byId(old), b = byId(now);
  Object.keys(a).forEach(id => { const x = a[id].slice(), y = b[id].slice(); x[12] = y[12] = ''; assert.deepStrictEqual(y, x, 'riga ' + id); });
  const strip = v => v.slice(1).map(r => r.slice(1));
  assert.deepStrictEqual(strip(now.values('Movimenti')), strip(old.values('Movimenti')));
});

t('golden: nessuna scrittura di lotti virtuali per prodotti non toccati, nemmeno dopo molte operazioni su altri', () => {
  const { now } = run(['Latticini', 'Carne e pesce', 'Colazione', 'Frutta e verdura', 'Pasta e riso']);
  const b = byId(now);
  ['p3ghi', 'p5mno', 'p6pqr'].forEach(id => assert.strictEqual(b[id][15], '', id));
});
console.log(n + ' test superati');
