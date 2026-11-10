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
// operazioni generate dall'app dall'inizio del test: già inviate (POST) + ancora in coda (la sync può svuotare `pending`)
const opsMade = h => h.calls.filter(c => c.opts && c.opts.method === 'POST').reduce((s, c) => s + JSON.parse(c.opts.body).ops.length, 0) + h.app.pending.length;
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
  const ids = h.plain(h.app.pending.map(o => o.opId));
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
  const n = opsMade(h); h.advance(5000);
  await h.app.onCode('789');
  eq(flashes(h), ['go out', 'go warn']); assert.strictEqual(msg(h), '⚠︎ Pasta · già a 0'); assert.strictEqual(opsMade(h), n);
});
t('onCode: stesso codice tenuto 3 s → un solo carico, un solo flash, messaggio invariato', async () => {
  const h = await mk(); h.app.openScanner(); await h.app.onCode('123');
  const m = msg(h);
  for (let i = 0; i < 30; i++) { h.advance(100); await h.app.onCode('123'); }
  assert.strictEqual(opsMade(h), 1); eq(flashes(h), ['go in']); assert.strictEqual(msg(h), m);
});
t('onCode: codice tolto 1 s e riinquadrato entro 2,5 s → flash grigio, "Già letto", nessuna operazione', async () => {
  const h = await mk(); h.app.openScanner(); await h.app.onCode('123');
  h.advance(300); await h.app.onCode('123'); h.advance(1000);
  await h.app.onCode('123');
  eq(flashes(h), ['go in', 'go dup']); assert.strictEqual(msg(h), 'Già letto, attendi un attimo'); assert.strictEqual(opsMade(h), 1);
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

/* ---------- Task 6: scadenze per lotti (R1) ---------- */
const TR = { version: '1.2.0', config: { catScad: ['Latticini'] } };
const LITEMS = () => { const a = ITEMS(); Object.assign(a[0], { qty: 4, scadenza: '2026-11-12', lotti: JSON.stringify([{ d: '2026-11-12', q: 1 }, { d: '2026-11-20', q: 3 }]) }); return a; };
const trFetch = (u, o) => (o && o.method === 'POST' ? hang(u, o) : Promise.resolve({ json: async () => ({ ok: true, version: '1.2.0', items: LITEMS(), extras: [], config: { catScad: ['Latticini'] } }) }));
const mkT = (o = {}) => mk(Object.assign({ fetchImpl: trFetch, ls: { 'disp.cfg': CFG, 'disp.items': LITEMS(), 'disp.mode': 'in', 'disp.srv': TR } }, o));
const ops = h => h.plain(h.app.pending);
const p1 = h => h.app.items.find(i => i.id === 'p1');
const lotsOf = it => JSON.parse(it.lotti || '[]');
const dayStr = (h, off) => { const d = new Date(h.clock.t); d.setDate(d.getDate() + off); const p = n => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; };

t('lotsEnabled: falso senza config o con backend 1.1, vero con 1.10 e catScad vuoto (R1.15)', async () => {
  const { app } = await mk();
  app.noteSrv({ version: '1.2.0' }); assert.strictEqual(app.lotsEnabled(), false);
  app.noteSrv({ version: '1.1', config: { catScad: [] } }); assert.strictEqual(app.lotsEnabled(), false);
  app.noteSrv({ version: '1.10', config: { catScad: [] } }); assert.strictEqual(app.lotsEnabled(), true);
});
t('expiry: prodotto tracciato → prossima data tra i lotti; non tracciato → scadenza', async () => {
  const h = await mkT(); const a = p1(h);
  a.qty = 3; a.lotti = JSON.stringify([{ d: '', q: 1 }, { d: '2026-11-20', q: 2 }]); a.scadenza = '';
  assert.strictEqual(h.app.expiry(a), '2026-11-20');
  const pasta = h.app.items.find(i => i.id === 'p3'); pasta.scadenza = '2026-12-01';
  assert.strictEqual(h.app.isTracked(a), true); assert.strictEqual(h.app.isTracked(pasta), false);
  assert.strictEqual(h.app.expiry(pasta), '2026-12-01');
});
t('expTag: con più lotti aggiunge · ×N se il lotto vicino è inferiore al totale', async () => {
  const h = await mkT(); const a = p1(h); const d3 = dayStr(h, 3), d9 = dayStr(h, 9);
  a.qty = 5; a.lotti = JSON.stringify([{ d: d3, q: 2 }, { d: d9, q: 3 }]);
  assert.ok(h.app.expTag(a).includes('scade tra 3 gg · ×2'), h.app.expTag(a));
  a.qty = 2; a.lotti = JSON.stringify([{ d: d3, q: 2 }]);
  const one = h.app.expTag(a); assert.ok(one.includes('scade tra 3 gg') && !one.includes('×'), one);
});
t('consumo: messaggio con la data del lotto consumato e "poi" il prossimo; nessun lot nell\'operazione', async () => {
  const h = await mkT({ ls: { 'disp.cfg': CFG, 'disp.items': LITEMS(), 'disp.mode': 'out', 'disp.srv': TR } }); h.app.openScanner();
  await h.app.onCode('123');
  assert.strictEqual(msg(h), '− Yogurt greco · 4 → 3 · scade 12/11 · poi 20/11');
  eq(ops(h).map(o => [o.op, o.delta, 'lot' in o]), [['delta', -1, false]]);
  eq(lotsOf(p1(h)), [{ d: '2026-11-20', q: 3 }]); assert.strictEqual(p1(h).scadenza, '2026-11-20'); assert.strictEqual(h.app.lp, null);
});
t('carico su categoria attiva: unità subito registrata senza data e pannello Scadenza? con contatore', async () => {
  const h = await mkT(); h.app.openScanner(); await h.app.onCode('123');
  eq(ops(h).map(o => [o.op, o.delta, 'lot' in o]), [['delta', 1, false]]);
  assert.strictEqual(h.app.lp.id, 'p1'); assert.strictEqual(h.app.lp.n, 1); assert.strictEqual(h.app.lp.host, 'panel');
  assert.ok(h.el('#lotpanel').rec.innerHTML.includes('Scadenza?') && h.el('#lotpanel').rec.innerHTML.includes('+7 g') && h.el('#lotpanel').rec.innerHTML.includes('Senza data'));
});
t('6 unità dello stesso prodotto prima della scelta → un solo lotMove con q = 6', async () => {
  const h = await mkT(); h.app.openScanner();
  for (let i = 0; i < 6; i++) { await h.app.onCode('123'); h.advance(3000); }
  assert.strictEqual(h.app.lp.n, 6);
  h.app.lotChoose('2026-12-01');
  const o = ops(h); eq(o.filter(x => x.op === 'delta').length, 6); eq(o.filter(x => x.op === 'lotMove').map(x => [x.id, x.from, x.to, x.q]), [['p1', '', '2026-12-01', 6]]);
  eq(lotsOf(p1(h)), [{ d: '2026-11-12', q: 1 }, { d: '2026-11-20', q: 3 }, { d: '2026-12-01', q: 6 }].sort((a, b) => a.d < b.d ? -1 : 1));
  assert.strictEqual(p1(h).qty, 10); assert.strictEqual(h.app.lp, null); eq(h.app.lastExp.p1, '2026-12-01');
});
t('scelta dopo la prima unità: le successive vanno nel lotto scelto (delta con lot, nessun pannello) per 90 s', async () => {
  const h = await mkT(); h.app.openScanner();
  await h.app.onCode('123'); h.app.lotChoose('2026-12-01'); h.advance(3000);
  await h.app.onCode('123');
  eq(ops(h).map(o => [o.op, 'lot' in o ? o.lot : undefined]), [['delta', undefined], ['lotMove', undefined], ['delta', '2026-12-01']]);
  assert.strictEqual(h.app.lp, null); assert.strictEqual(msg(h), '＋ Yogurt greco · 5 → 6 · scade 01/12');
  h.advance(91000); await h.app.onCode('123');
  assert.strictEqual(h.app.lp && h.app.lp.n, 1); assert.strictEqual('lot' in ops(h).slice(-1)[0], false);
});
t('"Senza data" è una scelta esplicita: nessun lotMove, ma le unità successive seguono (lot vuoto)', async () => {
  const h = await mkT(); h.app.openScanner();
  await h.app.onCode('123'); h.app.lotChoose(''); h.advance(3000); await h.app.onCode('123');
  eq(ops(h).map(o => o.op), ['delta', 'delta']); assert.strictEqual(ops(h)[1].lot, ''); assert.strictEqual(h.app.lp, null);
});
t('pannello scaduto senza scelta (15 s): niente lotMove, ricompare alla scansione successiva; un altro prodotto lo sostituisce', async () => {
  const h = await mkT(); h.app.openScanner();
  await h.app.onCode('123'); h.advance(14999); assert.ok(h.app.lp); h.advance(2); assert.strictEqual(h.app.lp, null);
  eq(ops(h).map(o => o.op), ['delta']); assert.strictEqual(h.app.inherit, null);
  h.advance(3000); await h.app.onCode('123'); assert.strictEqual(h.app.lp.n, 1);
  h.advance(3000); await h.app.onCode('456'); assert.strictEqual(h.app.lp.id, 'p2'); assert.strictEqual(h.app.lp.n, 1);
  assert.ok(!ops(h).some(o => o.op === 'lotMove'));
});
t('tasto + in lista (fuori dallo scanner): pannello #lotbar; chiusura con scelta → lotMove', async () => {
  const h = await mkT(); h.app.plusOne('p1');
  assert.strictEqual(h.app.lp.host, 'bar'); assert.ok(h.el('#lotbar').rec.innerHTML.includes('Scadenza?'));
  h.app.lotChoose('2026-12-05');
  eq(ops(h).map(o => o.op), ['delta', 'lotMove']); assert.ok(h.el('#lotbar').classList.contains('hidden'));
});
t('upsert su prodotto tracciato: lotti e scadenza derivati, qty per differenza sui lotti senza data', async () => {
  const h = await mkT(); const out = Object.assign({}, p1(h), { nome: 'Yogurt', scadenza: '1999-01-01', lotti: '[]' });
  h.app.upsert(out, 2);
  assert.strictEqual(p1(h).qty, 6); assert.strictEqual(p1(h).scadenza, '2026-11-12');
  eq(lotsOf(p1(h)), [{ d: '2026-11-12', q: 1 }, { d: '2026-11-20', q: 3 }, { d: '', q: 2 }]);
  assert.strictEqual(h.app.lp, null);
});
t('setCatScad: applica in locale, salva disp.srv e accoda cfgSet', async () => {
  const h = await mkT(); h.app.setCatScad(['Latticini', 'Carne e pesce', 'Latticini']);
  eq(h.plain(h.app.srv.config), { catScad: ['Latticini', 'Carne e pesce'] }); eq(h.store('disp.srv').config.catScad, ['Latticini', 'Carne e pesce']);
  eq(ops(h), [{ op: 'cfgSet', key: 'catScad', value: ['Latticini', 'Carne e pesce'], user: 'Mario', opId: ops(h)[0].opId }]);
});
t('gating spento (backend 1.1): comportamento 1.1, mai lot, lotMove, cfgSet né pannello', async () => {
  const old = (u, o) => Promise.resolve({ json: async () => ({ ok: true, version: '1.1', items: LITEMS(), extras: [] }) });
  const h = await mk({ fetchImpl: old, ls: { 'disp.cfg': CFG, 'disp.items': LITEMS(), 'disp.mode': 'in', 'disp.srv': { version: '1.1', config: null } } });
  h.app.openScanner(); await h.app.onCode('123'); h.app.plusOne('p1'); h.app.setCatScad(['Latticini']); h.app.moveLot(p1(h), '', '2026-12-01', 1);
  assert.ok(ops(h).length >= 2 && ops(h).every(o => o.op === 'delta' && !('lot' in o)), JSON.stringify(ops(h)));
  assert.strictEqual(h.app.lp, null); assert.strictEqual(h.app.lotsEnabled(), false); assert.strictEqual(p1(h).qty, 6);
});

t('scheda, form, Impostazioni e filtro "Da datare" con prodotti tracciati: HTML coerente, nessun errore', async () => {
  const h = await mkT(); const { app } = h; const a = p1(h); a.lotti = JSON.stringify([{ d: '', q: 1 }, { d: '2026-11-20', q: 3 }]);
  app.render(); const main = h.el('#main').rec.innerHTML; assert.ok(main.includes('Yogurt greco'));
  assert.ok(h.el('#chips').rec.innerHTML.includes('Da datare'), 'chip Da datare');
  const sheet = () => h.el('#sheet-root').rec.innerHTML;
  app.openDetail('p1'); assert.ok(sheet().includes('id="d-lots"') && sheet().includes('Prossima scadenza'));
  app.openDetail('p3'); assert.ok(!sheet().includes('id="d-lots"'));
  app.openForm(a); assert.ok(sheet().includes('id="f-scad-ro"') && sheet().includes('Prossima scadenza') && sheet().includes('2 lotti'));
  assert.ok(sheet().includes('id="f-scad-wrap" class="hidden"'));
  app.openForm(app.items.find(i => i.id === 'p3')); assert.ok(sheet().includes('id="f-scad-wrap" class=""') && sheet().includes('id="f-scad-ro" class="hidden"'));
  app.openForm(null); assert.ok(!sheet().includes('f-scad-ro') && sheet().includes('id="f-scad-wrap" class=""'));
  app.openSettings(); assert.ok(sheet().includes('Scadenze per categoria') && sheet().includes('Attiva le tre categorie consigliate') && sheet().includes('data-cat="Latticini" checked'));
  const old = await mk({ fetchImpl: async () => ({ json: async () => ({ ok: true, version: '1.1', items: ITEMS(), extras: [] }) }), ls: { 'disp.cfg': CFG, 'disp.items': ITEMS(), 'disp.srv': { version: '1.1', config: null } } });
  old.app.openSettings(); assert.ok(!old.el('#sheet-root').rec.innerHTML.includes('Scadenze per categoria'));
  old.app.openDetail('p1'); assert.ok(!old.el('#sheet-root').rec.innerHTML.includes('d-lots'));
});

t('lotto ereditato: un altro prodotto in mezzo lo annulla, lo stesso codice richiede di nuovo la data', async () => {
  const h = await mkT(); h.app.openScanner();
  await h.app.onCode('123'); h.app.lotChoose('2026-12-01'); assert.ok(h.app.inherit);
  h.advance(3000); await h.app.onCode('456'); assert.strictEqual(h.app.inherit, null); h.app.lotChoose('');
  h.advance(3000); await h.app.onCode('123');
  assert.strictEqual(h.app.lp.id, 'p1'); assert.strictEqual('lot' in ops(h).slice(-1)[0], false);
});

t('selettore data aperto: il pannello non si chiude per timeout e le letture sono ignorate; dopo 20 s senza scelta si chiude', async () => {
  const h = await mkT(); h.app.openScanner(); await h.app.onCode('123');
  h.advance(7000); h.app.lotPickStart();                    // tap su "📅 Scegli" (iOS non invia focus)
  h.advance(18000); assert.ok(h.app.lp, 'ancora aperto dopo 25 s dalla scansione');
  h.advance(1000); await h.app.onCode('456'); assert.strictEqual(h.app.lp.id, 'p1'); assert.strictEqual(ops(h).length, 1, 'lettura ignorata col selettore aperto');
  h.advance(20000); assert.strictEqual(h.app.lp, null);
  h.advance(3000); await h.app.onCode('456'); assert.strictEqual(h.app.lp.id, 'p2');   // poi lo scanner torna libero
});
t('selettore data: la scelta chiude il pannello, registra un solo lotMove e libera lo scanner', async () => {
  const h = await mkT(); h.app.openScanner(); await h.app.onCode('123'); h.app.lotPickStart(); h.app.lotChoose('2026-12-24');
  assert.strictEqual(h.app.lp, null); eq(ops(h).map(o => o.op), ['delta', 'lotMove']);
  h.advance(3000); await h.app.onCode('456'); assert.strictEqual(h.app.lp.id, 'p2');
});

(async () => {
  let n = 0;
  for (const [name, f] of tests) { await f(); n++; console.log('ok -', name); }
  console.log(n + ' test superati');
})().catch(e => { console.error(e); process.exit(1); });
