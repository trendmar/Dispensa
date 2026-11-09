'use strict';
// Carica un Code.gs in Node con `vm`, con stub minimi di Apps Script e un foglio finto.
// Nessun framework. Attenzione: gli oggetti creati dal codice caricato appartengono a un altro "realm":
// per confrontarli con assert.deepStrictEqual passarli da h.plain().
const fs = require('fs'); const vm = require('vm');

class FakeSheet {
  constructor(name, rows, maxCols) {
    this.name = name; this.rows = (rows || []).map(r => r.slice()); this.maxCols = maxCols || 26;
    this.maxRows = 1000; this.formats = []; this.ss = null;
  }
  cell(r, c) { const v = (this.rows[r - 1] || [])[c - 1]; return v === undefined ? '' : v; }
  set(r, c, v) {
    while (this.rows.length < r) this.rows.push([]);
    const row = this.rows[r - 1]; while (row.length < c) row.push(''); row[c - 1] = v;
  }
  getName() { return this.name; }
  setName(n) {
    if (this.ss.sheets.some(s => s !== this && s.name === n)) throw new Error('nome foglio già usato: ' + n);
    this.name = n; return this;
  }
  getLastRow() { for (let r = this.rows.length; r >= 1; r--) if (this.rows[r - 1].some(v => v !== '' && v !== undefined)) return r; return 0; }
  getLastColumn() { let m = 0; this.rows.forEach(r => r.forEach((v, i) => { if (v !== '' && v !== undefined) m = Math.max(m, i + 1); })); return m; }
  getMaxRows() { return this.maxRows; }
  getMaxColumns() { return this.maxCols; }
  insertColumnsAfter(pos, n) { if (pos !== this.maxCols) throw new Error('solo in coda'); this.maxCols += n; }
  setFrozenRows() {}
  deleteRows(r, n) { this.rows.splice(r - 1, n); }
  clear() { this.rows = []; this.formats = []; return this; }
  copyTo(ss) {
    const c = new FakeSheet('Copy of ' + this.name, this.rows, this.maxCols);
    c.formats = this.formats.map(f => ({ ...f })); c.ss = ss; ss.sheets.push(c); return c;
  }
  getRange(r, c, nr = 1, nc = 1) {
    const s = this;
    if (c + nc - 1 > s.maxCols) throw new Error('range fuori dal foglio (colonne): ' + s.name);
    return {
      getValues() { const o = []; for (let i = 0; i < nr; i++) { const row = []; for (let j = 0; j < nc; j++) row.push(s.cell(r + i, c + j)); o.push(row); } return o; },
      setValues(v) {
        if (v.length !== nr || v.some(x => x.length !== nc)) throw new Error('setValues: dimensioni errate');
        v.forEach((row, i) => row.forEach((x, j) => s.set(r + i, c + j, x))); return this;
      },
      getValue() { return s.cell(r, c); },
      setValue(v) { s.set(r, c, v); return this; },
      clearContent() { for (let i = 0; i < nr; i++) for (let j = 0; j < nc; j++) if (s.rows[r + i - 1]) s.set(r + i, c + j, ''); return this; },
      setNumberFormat(f) { s.formats.push({ r, c, nr, nc, f }); return this; },
      setFontWeight() { return this; },
    };
  }
}

const pad = n => String(n).padStart(2, '0');
function formatDate(d, tz, fmt) {
  const m = { yyyy: d.getFullYear(), MM: pad(d.getMonth() + 1), dd: pad(d.getDate()), HH: pad(d.getHours()), mm: pad(d.getMinutes()), ss: pad(d.getSeconds()) };
  return fmt.replace(/yyyy|MM|dd|HH|mm|ss/g, k => m[k]).replace(/'/g, '');
}

// opts: { sheets: {Prodotti: [[...]]}, props: {TOKEN:'t'}, cache: {}, maxCols: {Prodotti: 15} }
function loadBackend(file, opts = {}) {
  const ss = { sheets: [] };
  ss.getSheetByName = n => ss.sheets.find(s => s.name === n) || null;
  ss.getSheets = () => ss.sheets.slice();
  ss.insertSheet = n => { const s = new FakeSheet(n, [], 26); s.ss = ss; ss.sheets.push(s); return s; };
  ss.deleteSheet = s => { ss.sheets = ss.sheets.filter(x => x !== s); };
  const setSheet = (name, rows, maxCols) => {
    const old = ss.getSheetByName(name); if (old) ss.deleteSheet(old);
    const s = new FakeSheet(name, rows, maxCols || (opts.maxCols || {})[name]); s.ss = ss; ss.sheets.push(s); return s;
  };
  Object.keys(opts.sheets || {}).forEach(n => setSheet(n, opts.sheets[n]));

  const props = new Map(Object.entries(opts.props || {}));
  const propsApi = {
    getProperty: k => (props.has(k) ? props.get(k) : null),
    setProperty: (k, v) => { props.set(k, String(v)); return propsApi; },
    deleteProperty: k => { props.delete(k); return propsApi; },
  };
  const cache = new Map(Object.entries(opts.cache || {})); const cachePuts = [];
  const cacheApi = {
    getAll: keys => { const o = {}; keys.forEach(k => { if (cache.has(k)) o[k] = cache.get(k); }); return o; },
    putAll: (o, ttl) => { cachePuts.push({ keys: Object.keys(o), ttl }); Object.keys(o).forEach(k => cache.set(k, o[k])); },
  };
  const triggers = [];
  const ScriptApp = {
    WeekDay: { SUNDAY: 'SUNDAY' },
    getProjectTriggers: () => triggers.slice(),
    deleteTrigger: t => { const i = triggers.indexOf(t); if (i >= 0) triggers.splice(i, 1); },
    newTrigger: fn => {
      const t = { fn, spec: [], getHandlerFunction: () => fn };
      const b = {
        timeBased: () => b, onMonthDay: d => (t.spec.push('month' + d), b), onWeekDay: d => (t.spec.push('week' + d), b),
        atHour: x => (t.spec.push('h' + x), b), create: () => { triggers.push(t); return t; },
      };
      return b;
    },
  };
  const lock = { waits: 0, releases: 0 };
  const logs = [];
  const context = vm.createContext({
    SpreadsheetApp: { getActive: () => ss },
    PropertiesService: { getScriptProperties: () => propsApi },
    CacheService: { getScriptCache: () => cacheApi },
    LockService: { getScriptLock: () => ({ waitLock: () => { lock.waits++; }, releaseLock: () => { lock.releases++; } }) },
    Session: { getScriptTimeZone: () => 'Europe/Rome' },
    Utilities: { formatDate },
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: s => ({ body: s, setMimeType() { return this; } }) },
    ScriptApp, console: { log: (...a) => logs.push(a.join(' ')) },
  });
  const src = fs.readFileSync(file, 'utf8');
  const names = [...new Set([...src.matchAll(/^function (\w+)/gm)].map(m => m[1]).concat(['VERSION', 'COLS', 'TEXT_COLS']))];
  const exp = names.map(n => `${n}: typeof ${n} === 'undefined' ? undefined : ${n}`).join(',');
  const fn = vm.runInContext(src + `\n;({${exp}})`, context, { filename: file });

  const h = {
    fn, ss, setSheet, props, cache, cachePuts, triggers, lock, logs,
    eval: code => vm.runInContext(code, context),
    plain: x => (x === undefined ? undefined : JSON.parse(JSON.stringify(x))),
    values: name => {
      const s = ss.getSheetByName(name); const n = s.getLastRow(), w = s.getLastColumn();
      return Array.from({ length: n }, (_, i) => Array.from({ length: w }, (_, j) => s.cell(i + 1, j + 1)));
    },
    formats: name => ss.getSheetByName(name).formats.map(f => ({ ...f })),
    sheetNames: () => ss.sheets.map(s => s.name),
    get: params => JSON.parse(fn.doGet({ parameter: params || {} }).body),
    post: (req, params) => JSON.parse(fn.doPost({ postData: { contents: typeof req === 'string' ? req : JSON.stringify(req) }, parameter: params || {} }).body),
  };
  return h;
}
module.exports = { loadBackend, FakeSheet };
