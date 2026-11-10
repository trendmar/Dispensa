'use strict';
// Carica lo <script> di index.html in Node con `vm`, un DOM finto che registra le scritture,
// un orologio finto (setTimeout/Date) e un fetch pilotabile. Nessun framework.
const fs = require('fs'); const path = require('path'); const vm = require('vm');

function makeEl(sel) {
  const rec = { sel, innerHTML: '', textContent: '', className: '', value: '', onclick: null, sets: 0, classNames: [], texts: [], handlers: {}, dataset: {}, style: {} };
  const classes = new Set(); let kids = {};   // figli stabili finché il genitore non riscrive innerHTML
  const classList = { add: c => classes.add(c), remove: c => classes.delete(c), toggle: (c, on) => { if (on === undefined ? !classes.has(c) : on) classes.add(c); else classes.delete(c); }, contains: c => classes.has(c) };
  return new Proxy(rec, {
    get(t, k) {
      if (k === 'classList') return classList;
      if (k === 'rec') return rec;
      if (k === 'offsetWidth') return 0;
      if (k === 'closest') return () => null;
      if (k === 'querySelector') return s => kids[s] || (kids[s] = makeEl(s));
      if (k === 'firstChild') return kids.__first || (kids.__first = makeEl('child'));
      if (k === 'querySelectorAll') return () => [];
      if (k === 'addEventListener') return (ev, f) => { (t.handlers[ev] = t.handlers[ev] || []).push(f); };
      if (typeof k === 'symbol') return undefined;
      if (k in t) return t[k];
      return () => {};
    },
    set(t, k, v) {
      if (k === 'innerHTML') { t.sets++; t.innerHTML = v; kids = {}; return true; }
      if (k === 'textContent') { t.texts.push(v); t.textContent = v; return true; }
      if (k === 'className') { t.classNames.push(v); t.className = v; return true; }
      t[k] = v; return true;
    },
  });
}

function loadApp({ ls = {}, fetchImpl, now = 1.7e12, online = true } = {}) {
  const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
  const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
  const store = new Map(Object.entries(ls).map(([k, v]) => [k, JSON.stringify(v)]));
  const timers = []; let tid = 0; const clock = { t: now };
  const els = {}; const el = sel => els[sel] || (els[sel] = makeEl(sel));
  const calls = [];
  const fetchStub = (url, opts) => { calls.push({ url, opts }); return (fetchImpl || (async () => ({ json: async () => ({ ok: true, version: '1.2.0', items: JSON.parse(JSON.stringify(ls['disp.items'] || [])), extras: [], config: { catScad: [] } }) })))(url, opts); };
  class FakeDate extends Date { constructor(...a) { if (a.length) super(...a); else super(clock.t); } static now() { return clock.t; } }
  const navigator = { onLine: online };
  const sandbox = {
    document: { querySelector: el, querySelectorAll: () => [], addEventListener() {}, createElement: () => makeEl('created'), hidden: false, activeElement: null, body: makeEl('body') },
    window: { innerWidth: 390, innerHeight: 844, addEventListener() {}, scrollTo() {} },
    localStorage: { getItem: k => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) },
    navigator, location: { hash: '', protocol: 'http:', pathname: '/', origin: 'http://x', href: 'http://x/' }, history: { replaceState() {} },
    fetch: fetchStub, AbortController, MutationObserver: class { observe() {} }, URL, URLSearchParams, Blob, console,
    scrollTo() {}, confirm: () => true, prompt: () => null, Date: FakeDate,
    setTimeout: (f, ms) => { timers.push({ id: ++tid, at: clock.t + (ms || 0), f }); return tid; },
    clearTimeout: id => { const i = timers.findIndex(x => x.id === id); if (i >= 0) timers.splice(i, 1); },
  };
  const ctx = vm.createContext(sandbox);
  const names = ['queue', 'sync', 'onCode', 'decideRead', 'syncLabel', 'cmpVersion', 'scanText', 'fetchJson', 'openSettings', 'openScanner', 'closeScanner',
    'changeQty', 'render', 'VERSION', 'rd', 'flash', 'updateSync', 'noteSrv', 'byCode',
    'lotsEnabled', 'isTracked', 'expiry', 'expTag', 'lotChoose', 'lotClose', 'setCatScad', 'plusOne', 'moveLot', 'upsert', 'lotPickStart', 'useFix', 'useClose', 'minusOne', 'onScan', 'confirmRead', 'openDetail', 'openForm', 'exportCsv'];
  const exp = names.map(n => `${n}: typeof ${n} === 'undefined' ? undefined : ${n}`).join(',');
  const getters = 'get items(){return items}, set items(v){items=v}, get pending(){return pending}, get syncing(){return syncing}, get syncErr(){return syncErr}, get srv(){return srv}, get cfg(){return cfg}, get scanOpen(){return scanOpen}, get lp(){return lp}, get us(){return us}, get lastExp(){return lastExp}';
  const app = vm.runInContext(script + `\n;({${exp}, ${getters}})`, ctx, { filename: 'index.html' });
  const h = {
    app, calls, els, el, clock, navigator, sandbox,
    store: k => (store.has(k) ? JSON.parse(store.get(k)) : undefined),
    advance(ms) {
      const end = clock.t + ms;
      for (;;) {
        timers.sort((a, b) => a.at - b.at);
        const n = timers[0]; if (!n || n.at > end) break;
        timers.shift(); clock.t = Math.max(clock.t, n.at); n.f();
      }
      clock.t = end;
    },
    flush: async () => { for (let i = 0; i < 5; i++) await new Promise(r => setImmediate(r)); },
    plain: x => (x === undefined ? undefined : JSON.parse(JSON.stringify(x))),
  };
  return h;
}
module.exports = { loadApp };
