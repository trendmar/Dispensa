'use strict';
// Frontend (index.html) con DOM finto e orologio finto: R2 (conferma visiva, doppia lettura, indicatore), Q1, Q2, Q7.
const assert = require('assert'); const { loadApp } = require('./app-harness.js');
const eq = assert.deepStrictEqual;
const tests = []; const t = (name, f) => tests.push([name, f]);

const CFG = { user: 'Mario', url: 'https://script.google.com/macros/s/X/exec', token: 't', pos: ['Dispensa', 'Frigo'] };
const ITEMS = () => [
  { id: 'p1', barcode: '123', nome: 'Yogurt greco', qty: 3, scortaMin: 2, scadenza: '', categoria: 'Latticini', posizione: 'Frigo', stato: '', marca: '' },
  { id: 'p2', barcode: '456', nome: 'Latte', qty: 2, scortaMin: 2, scadenza: '', categoria: 'Latticini', posizione: 'Frigo', stato: '', marca: '' },
  { id: 'p3', barcode: '789', nome: 'Pasta', qty: 0, scortaMin: 0, scadenza: '', categoria: 'Pasta e riso', posizione: 'Dispensa', stato: '', marca: '' },
];
async function mk(o = {}) {
  const h = loadApp(Object.assign({ ls: { 'disp.cfg': CFG, 'disp.items': ITEMS(), 'disp.mode': 'in' } }, o));
  await h.flush(); h.calls.length = 0; return h;
}
const hang = (url, opts) => new Promise((res, rej) => opts.signal.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' }))));
const okResp = items => ({ json: async () => ({ ok: true, version: '1.2.0', items, extras: [], config: { catScad: [] } }) });
const msg = h => h.el('#scan-msg').rec.textContent;
const flashes = h => h.el('#flash').rec.classNames.filter(c => c.startsWith('go'));

t('decideRead: stesso codice inquadrato 3 s → una sola lettura, poi silenzio', () => {
  const { app } = loadApp({}); const st = { code: '', seenAt: 0, at: 0 };
  eq(app.decideRead(st, '123', 1000), 'process');
  const r = []; for (let ms = 1100; ms <= 4000; ms += 100) r.push(app.decideRead(st, '123', ms));
  assert.ok(r.every(x => x === 'silent'));
});
t('decideRead: dopo almeno 700 ms di assenza ed entro 2,5 s dall\'ultima operazione → dup; oltre → process', () => {
  const { app } = loadApp({}); const st = { code: '', seenAt: 0, at: 0 };
  app.decideRead(st, '123', 0); app.decideRead(st, '123', 300);
  eq(app.decideRead(st, '123', 1300), 'dup');          // assente 1000 ms, a 1300 ms dall'operazione
  eq(app.decideRead(st, '123', 1500), 'silent');       // di nuovo inquadrato in continuo
  eq(app.decideRead(st, '123', 2600), 'process');      // assente >700 ms e oltre 2,5 s dall'operazione
});
t('decideRead: codice diverso → process; callback a meno di 700 ms restano silenziosi anche entro 2,5 s', () => {
  const { app } = loadApp({}); const st = { code: '', seenAt: 0, at: 0 };
  app.decideRead(st, '123', 0); eq(app.decideRead(st, '456', 200), 'process'); eq(app.decideRead(st, '456', 600), 'silent');
});
t('syncLabel: ✓, ⟳, · N, ⚠︎ N, offline · N', () => {
  const { app } = loadApp({});
  const L = o => app.syncLabel(Object.assign({ syncing: false, pending: 0, err: '', online: true }, o));
  eq(L({}), '✓'); eq(L({ syncing: true, pending: 2 }), '⟳'); eq(L({ pending: 3 }), '· 3'); eq(L({ pending: 2, err: 'x' }), '⚠︎ 2');
  eq(L({ online: false, pending: 4 }), 'offline · 4'); eq(L({ online: false, pending: 0 }), 'offline · 0');
});
t('cmpVersion confronta per componenti numerici', () => {
  const { app } = loadApp({});
  assert.ok(app.cmpVersion('1.10', '1.2') > 0); assert.strictEqual(app.cmpVersion('1.2.0', '1.2'), 0); assert.ok(app.cmpVersion('1.1', '1.2') < 0);
});
t('scanText: formati dei messaggi (R2.1)', () => {
  const { app } = loadApp({});
  eq(app.scanText('in', 'Yogurt greco', 3, 4, ''), '＋ Yogurt greco · 3 → 4');
  eq(app.scanText('out', 'Yogurt greco', 4, 3, ' · scade 12/11'), '− Yogurt greco · 4 → 3 · scade 12/11');
  eq(app.scanText('out', 'Latte', 2, 1, ' · in lista spesa'), '− Latte · 2 → 1 · in lista spesa');
  eq(app.scanText('warn', 'Latte'), '⚠︎ Latte · già a 0'); eq(app.scanText('dup'), 'Già letto, attendi un attimo');
});

t('fetchJson: senza risposta entro 45 s rigetta con AbortError', async () => {
  const h = await mk({ fetchImpl: hang });
  const p = h.app.fetchJson('http://x', {}, 45000); let err; p.catch(e => { err = e; });
  h.advance(44999); await h.flush(); assert.strictEqual(err, undefined);
  h.advance(1); await h.flush(); assert.strictEqual(err && err.name, 'AbortError');
});
t('sync: dopo un timeout syncing torna false, la coda resta e si riprova dopo 30 s', async () => {
  let n = 0; const h = await mk({ fetchImpl: (u, o) => (n++ === 0 ? okResp(ITEMS()).json && Promise.resolve(okResp(ITEMS())) : hang(u, o)) });
  h.app.queue({ op: 'delta', id: 'p1', delta: 1 }); h.advance(0); await h.flush();    // invio in volo, nessuna risposta
  assert.strictEqual(h.app.syncing, true);
  h.advance(45000); await h.flush();
  assert.strictEqual(h.app.syncing, false); assert.strictEqual(h.app.syncErr, 'timeout'); assert.strictEqual(h.app.pending.length, 1);
  const before = h.calls.length; h.advance(30000); await h.flush();
  assert.strictEqual(h.calls.length, before + 1, 'nuovo tentativo dopo 30 s');
});
t('queue assegna opId univoci e la coda mantiene l\'ordine; la POST li invia', async () => {
  let post;
  const h = await mk({ fetchImpl: async (u, o) => { if (o && o.method === 'POST') post = JSON.parse(o.body); return okResp(ITEMS()); } });
  h.app.queue({ op: 'delta', id: 'p1', delta: 1 }); h.app.queue({ op: 'delta', id: 'p2', delta: -1 });
  const ids = h.app.pending.map(o => o.opId);
  assert.ok(ids.every(Boolean) && new Set(ids).size === ids.length);
  eq(h.store('disp.pend').map(o => o.id), ['p1', 'p2']);
  await h.flush(); eq(post.ops.map(o => o.opId), ids); eq(post.ops.map(o => o.id), ['p1', 'p2']);
});

t('onCode: carico → flash verde prima di ogni operazione asincrona e messaggio da → a', async () => {
  const h = await mk(); h.app.openScanner();
  const p = h.app.onCode('123');                                  // niente await: tutto sincrono
  eq(flashes(h), ['go in']); assert.strictEqual(msg(h), '＋ Yogurt greco · 3 → 4');
  assert.strictEqual(h.app.items.find(i => i.id === 'p1').qty, 4); await p;
});
t('onCode: scarico sotto scorta → flash corallo e "in lista spesa"; già a zero → ambra senza operazione', async () => {
  const h = await mk({ ls: { 'disp.cfg': CFG, 'disp.items': ITEMS(), 'disp.mode': 'out' } }); h.app.openScanner();
  await h.app.onCode('456');
  eq(flashes(h), ['go out']); assert.strictEqual(msg(h), '− Latte · 2 → 1 · in lista spesa');
  const n = h.app.pending.length; h.advance(5000);
  await h.app.onCode('789');
  eq(flashes(h), ['go out', 'go warn']); assert.strictEqual(msg(h), '⚠︎ Pasta · già a 0'); assert.strictEqual(h.app.pending.length, n);
});
t('onCode: stesso codice tenuto 3 s → un solo carico, un solo flash, messaggio invariato', async () => {
  const h = await mk(); h.app.openScanner(); await h.app.onCode('123');
  const m = msg(h);
  for (let i = 0; i < 30; i++) { h.advance(100); await h.app.onCode('123'); }
  assert.strictEqual(h.app.pending.length, 1); eq(flashes(h), ['go in']); assert.strictEqual(msg(h), m);
});
t('onCode: codice tolto 1 s e riinquadrato entro 2,5 s → flash grigio, "Già letto", nessuna operazione', async () => {
  const h = await mk(); h.app.openScanner(); await h.app.onCode('123');
  h.advance(300); await h.app.onCode('123'); h.advance(1000);
  await h.app.onCode('123');
  eq(flashes(h), ['go in', 'go dup']); assert.strictEqual(msg(h), 'Già letto, attendi un attimo'); assert.strictEqual(h.app.pending.length, 1);
});
t('onCode: 10 codici diversi in 10 s → ogni flash riparte pulito (classe tolta e riaggiunta)', async () => {
  const h = await mk(); h.app.openScanner();
  for (let i = 0; i < 10; i++) { await h.app.onCode(i % 2 ? '456' : '123'); h.advance(1000); }
  const cn = h.el('#flash').rec.classNames;
  assert.strictEqual(cn.filter(c => c === '').length, 10); assert.strictEqual(cn.filter(c => c.startsWith('go')).length, 10);
  assert.ok(cn.every((c, i) => i % 2 === 0 ? c === '' : c.startsWith('go')));
});
t('onCode: nuovo prodotto non fa nessun flash (si apre il form)', async () => {
  const h = await mk({ fetchImpl: async () => okResp(ITEMS()) }); h.app.openScanner();
  await h.app.onCode('999'); eq(flashes(h), []);
});
t('scanner aperto: queue() non ridisegna la lista, alla chiusura sì', async () => {
  const h = await mk(); const main = h.el('#main').rec;
  h.app.openScanner(); const s0 = main.sets;
  h.app.changeQty('p1', 1); h.app.changeQty('p1', 1);
  assert.strictEqual(main.sets, s0); assert.strictEqual(h.app.scanOpen, true);
  await h.app.closeScanner(); assert.ok(main.sets > s0); assert.strictEqual(h.app.scanOpen, false);
});

t('indicatore nello scanner: ⟳ in invio, ✓ a coda vuota, offline · N senza rete, ✓ alla ripresa', async () => {
  const h = await mk(); h.app.openScanner();
  const sy = () => h.el('#scan-sync').rec.textContent;
  h.navigator.onLine = false; h.app.queue({ op: 'delta', id: 'p1', delta: 1 }); h.app.updateSync();
  assert.strictEqual(sy(), 'offline · 1');
  h.navigator.onLine = true; h.app.updateSync(); await h.flush();
  assert.strictEqual(h.app.pending.length, 0); assert.strictEqual(sy(), '✓');
  const texts = h.el('#scan-sync').rec.texts; assert.ok(texts.includes('⟳'));
});

t('Impostazioni: "App v1.2.0 · Backend v1.2.0"; con backend 1.1 compare l\'avviso di aggiornamento incompleto', async () => {
  const h = await mk(); h.app.openSettings();
  assert.ok(h.el('#sheet-root').rec.innerHTML.includes('App v1.2.0 · Backend v1.2.0'));
  assert.ok(!h.el('#sheet-root').rec.innerHTML.includes('Aggiornamento incompleto'));
  const old = await mk({ fetchImpl: async () => ({ json: async () => ({ ok: true, version: '1.1', items: ITEMS(), extras: [] }) }), ls: { 'disp.cfg': CFG, 'disp.items': ITEMS() } });
  await old.app.sync(); old.app.openSettings();
  const html = old.el('#sheet-root').rec.innerHTML;
  assert.ok(html.includes('Backend v1.1') && html.includes('Aggiornamento incompleto'));
});
t('la versione e la config del backend si salvano in disp.srv a ogni risposta', async () => {
  const h = await mk(); eq(h.store('disp.srv'), { version: '1.2.0', config: { catScad: [] } });
});
t('VERSION è 1.2.0', async () => { assert.strictEqual((await mk()).app.VERSION, '1.2.0'); });

(async () => {
  let n = 0;
  for (const [name, f] of tests) { await f(); n++; console.log('ok -', name); }
  console.log(n + ' test superati');
})().catch(e => { console.error(e); process.exit(1); });
