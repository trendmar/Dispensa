/**
 * DISPENSA — backend Google Apps Script su Google Sheet          v1.1
 *
 * Fogli:
 *   Prodotti  — inventario (una riga per prodotto)
 *   Spesa     — voci libere della lista spesa (non legate a un prodotto)
 *   Movimenti — storico azioni (pulito in automatico oltre STORICO_MESI)
 *
 * Primo setup: vedi LEGGIMI.md.
 * Aggiornamento da v1.0: incolla questo file, esegui setup() una volta,
 * poi Gestisci deployment → modifica → Versione: Nuova versione.
 */

const VERSION = '1.1';
const TOKEN = 'CAMBIA-QUESTO-TOKEN';
const STORICO_MESI = 12;

const SH_P = 'Prodotti', SH_S = 'Spesa', SH_M = 'Movimenti';
const COLS = ['id', 'barcode', 'nome', 'marca', 'formato', 'categoria', 'posizione',
              'qty', 'scortaMin', 'scadenza', 'note', 'img', 'updated', 'updatedBy', 'stato'];
const SCOLS = ['id', 'nome', 'stato', 'quando', 'utente'];
const MCOLS = ['quando', 'id', 'nome', 'op', 'delta', 'qtyDopo', 'utente'];
const TEXT_COLS = ['id', 'barcode', 'scadenza', 'updated']; // testo: zeri iniziali, date ISO

/* ================= SETUP (idempotente: si può rieseguire) ================= */

function setup() {
  const ss = SpreadsheetApp.getActive();
  const p = getOrCreate(ss, SH_P);
  header(p, COLS);
  TEXT_COLS.forEach(c => p.getRange(1, COLS.indexOf(c) + 1, p.getMaxRows()).setNumberFormat('@'));

  const s = getOrCreate(ss, SH_S);
  header(s, SCOLS);
  s.getRange(1, 1, s.getMaxRows()).setNumberFormat('@');

  header(getOrCreate(ss, SH_M), MCOLS);

  const def = ss.getSheetByName('Foglio1') || ss.getSheetByName('Sheet1');
  if (def && def.getLastRow() === 0 && ss.getSheets().length > 3) ss.deleteSheet(def);

  // trigger mensile di pulizia storico (il 1° del mese alle 3)
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'pulisciStorico')
    .forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('pulisciStorico').timeBased().onMonthDay(1).atHour(3).create();
}

function getOrCreate(ss, name) { return ss.getSheetByName(name) || ss.insertSheet(name); }
function header(sh, cols) {
  sh.getRange(1, 1, 1, cols.length).setValues([cols]).setFontWeight('bold');
  sh.setFrozenRows(1);
}

/* ================= HTTP ================= */

function doGet(e) {
  if ((e.parameter.token || '') !== TOKEN) return out({ ok: false, error: 'token' });
  const db = openDb();
  return out({ ok: true, version: VERSION, items: db.items, extras: db.extras });
}

function doPost(e) {
  let req;
  try { req = JSON.parse(e.postData.contents); } catch (x) { return out({ ok: false, error: 'json' }); }
  if ((req.token || e.parameter.token) !== TOKEN) return out({ ok: false, error: 'token' });

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const db = openDb();
    if (req.action === 'alexaSync') {
      const res = alexaSync(db, req.alexa || []);
      saveDb(db);
      return out(Object.assign({ ok: true }, res));
    }
    const results = (req.ops || []).map(op => {
      try { return applyOp(db, op); } catch (err) { return { ok: false, error: String(err) }; }
    });
    saveDb(db);
    return out({ ok: true, version: VERSION, results, items: db.items, extras: db.extras });
  } finally {
    lock.releaseLock();
  }
}

function out(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/* ================= DB in memoria: 1 lettura + 1 scrittura per richiesta ================= */

function openDb() {
  const ss = SpreadsheetApp.getActive();
  const p = ss.getSheetByName(SH_P), s = ss.getSheetByName(SH_S);
  const pn = Math.max(0, p.getLastRow() - 1), sn = Math.max(0, s.getLastRow() - 1);
  const tz = Session.getScriptTimeZone();
  const prow = pn ? p.getRange(2, 1, pn, COLS.length).getValues() : [];
  const srow = sn ? s.getRange(2, 1, sn, SCOLS.length).getValues() : [];
  return {
    ss, p, s, pn, sn, logs: [], dirtyP: false, dirtyS: false,
    items: prow.filter(r => r[0] !== '').map(r => toItem(r, tz)),
    extras: srow.filter(r => r[0] !== '').map(r => toObj(r, SCOLS, tz)),
  };
}

function toObj(r, cols, tz) {
  const o = {};
  cols.forEach((c, i) => {
    let v = r[i];
    if (v instanceof Date) v = Utilities.formatDate(v, tz, c === 'scadenza' ? 'yyyy-MM-dd' : "yyyy-MM-dd'T'HH:mm:ss");
    o[c] = v;
  });
  o.id = String(o.id);
  if ('stato' in o) o.stato = String(o.stato || '');
  return o;
}
function toItem(r, tz) {
  const o = toObj(r, COLS, tz);
  o.barcode = String(o.barcode || '');
  o.qty = Number(o.qty) || 0;
  o.scortaMin = Number(o.scortaMin) || 0;
  return o;
}

function saveDb(db) {
  if (db.dirtyP) writeTable(db.p, db.items, COLS, db.pn);
  if (db.dirtyS) writeTable(db.s, db.extras, SCOLS, db.sn);
  if (db.logs.length) {
    const m = db.ss.getSheetByName(SH_M);
    m.getRange(m.getLastRow() + 1, 1, db.logs.length, MCOLS.length).setValues(db.logs);
  }
}
function writeTable(sh, objs, cols, oldN) {
  const vals = objs.map(o => cols.map(c => (o[c] === undefined || o[c] === null) ? '' : o[c]));
  if (vals.length) sh.getRange(2, 1, vals.length, cols.length).setValues(vals);
  if (oldN > vals.length) sh.getRange(2 + vals.length, 1, oldN - vals.length, cols.length).clearContent();
}

function log(db, it, op, delta, user) {
  db.logs.push([new Date(), it.id, it.nome, op, delta, it.qty === undefined ? '' : it.qty, user || '']);
}
function touch(it, user) { it.updated = new Date().toISOString(); it.updatedBy = user || ''; }

/* ================= Operazioni dall'app ================= */

function applyOp(db, op) {
  const user = op.user || '';
  const byId = id => db.items.find(i => i.id === String(id));

  switch (op.op) {
    case 'upsert': {
      const it = op.item;
      if (!it || !it.id) return { ok: false, error: 'item senza id' };
      const ex = byId(it.id);
      if (ex) {
        // la quantità si aggiorna SOLO per differenza: non annulla le modifiche
        // fatte in parallelo da un altro telefono
        const d = Number(op.qtyDelta) || 0;
        COLS.forEach(c => {
          if (['id', 'qty', 'updated', 'updatedBy', 'stato'].indexOf(c) < 0 && it[c] !== undefined) ex[c] = it[c];
        });
        ex.scortaMin = Number(ex.scortaMin) || 0;
        ex.qty = Math.max(0, ex.qty + d);
        if (d > 0) { ex.stato = ''; chiudiVociLibere(db, ex); }
        touch(ex, user);
        log(db, ex, 'modifica', d, user);
      } else {
        const n = {};
        COLS.forEach(c => n[c] = it[c] === undefined ? '' : it[c]);
        n.id = String(n.id); n.barcode = String(n.barcode || '');
        n.qty = Math.max(0, Number(n.qty) || 0); n.scortaMin = Number(n.scortaMin) || 0;
        n.stato = '';
        touch(n, user);
        db.items.push(n);
        log(db, n, 'nuovo', n.qty, user);
        if (n.qty > 0) chiudiVociLibere(db, n);
      }
      db.dirtyP = true;
      return { ok: true };
    }
    case 'delta': {
      const ex = byId(op.id);
      if (!ex) return { ok: false, error: 'non trovato' };
      const d = Number(op.delta) || 0;
      ex.qty = Math.max(0, ex.qty + d);
      if (d > 0) { ex.stato = ''; chiudiVociLibere(db, ex); } // caricato → esce dalla lista
      touch(ex, user);
      log(db, ex, d > 0 ? 'carico' : 'scarico', d, user);
      db.dirtyP = true;
      return { ok: true, qty: ex.qty };
    }
    case 'stato': {                       // '' | 'comprare' | 'preso'
      const ex = byId(op.id);
      if (!ex) return { ok: false, error: 'non trovato' };
      ex.stato = ['comprare', 'preso'].indexOf(op.stato) >= 0 ? op.stato : '';
      touch(ex, user);
      db.dirtyP = true;
      return { ok: true };
    }
    case 'delete': {
      const ex = byId(op.id);
      if (!ex) return { ok: true };
      db.items = db.items.filter(i => i !== ex);
      log(db, ex, 'eliminato', 0, user);
      db.dirtyP = true;
      return { ok: true };
    }
    case 'extraAdd': {
      if (!op.id || !op.nome) return { ok: false, error: 'voce vuota' };
      if (!db.extras.some(x => x.id === String(op.id)))
        db.extras.push({ id: String(op.id), nome: String(op.nome), stato: '', quando: new Date().toISOString(), utente: user });
      db.dirtyS = true;
      return { ok: true };
    }
    case 'extraSet': {
      const x = db.extras.find(x => x.id === String(op.id));
      if (x) { x.stato = op.stato === 'preso' ? 'preso' : ''; db.dirtyS = true; }
      return { ok: true };
    }
    case 'extraDel': {
      const ids = [].concat(op.id).map(String);
      db.extras = db.extras.filter(x => ids.indexOf(x.id) < 0);
      db.dirtyS = true;
      return { ok: true };
    }
  }
  return { ok: false, error: 'op sconosciuta' };
}

/* ================= Lista spesa + sincronizzazione Alexa ================= */

const isLow = i => i.scortaMin > 0 && i.qty < i.scortaMin;
const inSpesa = i => (isLow(i) || i.stato === 'comprare') && i.stato !== 'preso';

function norm(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ').trim();
}

/** cosa deve stare sulla lista spesa adesso: { chiaveNormalizzata: nomeVisualizzato } */
function desired(db) {
  const w = {};
  db.items.filter(inSpesa).forEach(i => { const k = norm(i.nome); if (k && !w[k]) w[k] = i.nome; });
  db.extras.filter(x => x.stato !== 'preso').forEach(x => { const k = norm(x.nome); if (k && !w[k]) w[k] = x.nome; });
  return w;
}

/** "latte" → prodotto "Latte parzialmente scremato" (match esatto, poi per parole) */
function matchProduct(db, name) {
  const k = norm(name);
  const exact = db.items.find(i => norm(i.nome) === k);
  if (exact) return exact;
  const kw = k.split(' ');
  const cand = db.items.filter(i => {
    const iw = norm(i.nome).split(' ');
    return kw.every(w => iw.indexOf(w) >= 0) || iw.every(w => kw.indexOf(w) >= 0);
  });
  cand.sort((a, b) => Math.abs(norm(a.nome).length - k.length) - Math.abs(norm(b.nome).length - k.length));
  return cand[0] || null;
}

/** carico di un prodotto → rimuove le voci libere con nome corrispondente ("candele" ↔ "Candele profumate") */
function chiudiVociLibere(db, it) {
  const iw = norm(it.nome).split(' ');
  const before = db.extras.length;
  db.extras = db.extras.filter(x => {
    const xw = norm(x.nome).split(' ');
    if (!xw[0]) return true;
    return !(xw.every(w => iw.indexOf(w) >= 0) || iw.every(w => xw.indexOf(w) >= 0));
  });
  if (db.extras.length !== before) db.dirtyS = true;
}

/**
 * Chiamata da Home Assistant con la lista Alexa (todo.get_items).
 * Restituisce cosa fare su Alexa: { add: [nomi], complete: [uid] }.
 * Memoria: chiavi già allineate al giro precedente (ScriptProperties).
 */
function alexaSync(db, alexa) {
  const props = PropertiesService.getScriptProperties();
  const prev = new Set(JSON.parse(props.getProperty('alexaSynced') || '[]'));
  const active = {}, done = {};
  alexa.forEach(a => {
    const k = norm(a.summary); if (!k) return;
    const bag = a.status === 'completed' ? done : active;
    (bag[k] = bag[k] || []).push(a);
  });
  const complete = [], completedKeys = new Set();
  const completeAll = k => { active[k].forEach(a => complete.push(a.uid || a.summary)); completedKeys.add(k); };

  // 1) spuntati sull'app Alexa → "nel carrello" nella Dispensa
  Object.keys(done).forEach(k => {
    if (!prev.has(k) || active[k]) return;
    db.items.filter(i => norm(i.nome) === k && inSpesa(i)).forEach(i => {
      i.stato = 'preso'; touch(i, 'Alexa'); log(db, i, 'preso (Alexa)', 0, 'Alexa'); db.dirtyP = true;
    });
    const before = db.extras.length;
    db.extras = db.extras.filter(x => !(norm(x.nome) === k && x.stato !== 'preso'));
    if (db.extras.length !== before) db.dirtyS = true;
  });

  // 2) voci attive su Alexa
  const want = desired(db);
  Object.keys(active).forEach(k => {
    if (want[k]) return;                         // già allineata
    if (prev.has(k)) { completeAll(k); return; } // tolta/comprata nella Dispensa → spunta su Alexa
    // voce nuova detta ad Alexa
    const name = active[k][0].summary;
    const p = matchProduct(db, name);
    if (p) {
      if (!inSpesa(p)) { p.stato = 'comprare'; touch(p, 'Alexa'); log(db, p, 'da comprare (Alexa)', 0, 'Alexa'); db.dirtyP = true; }
      if (norm(p.nome) !== k) completeAll(k);    // "latte" sostituito dal nome del prodotto
    } else {
      db.extras.push({ id: 'x' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
                       nome: name, stato: '', quando: new Date().toISOString(), utente: 'Alexa' });
      db.dirtyS = true;
    }
  });

  // 3) voci da aggiungere su Alexa
  const want2 = desired(db);
  const add = Object.keys(want2).filter(k => !active[k] || completedKeys.has(k)).map(k => want2[k]);
  props.setProperty('alexaSynced', JSON.stringify(Object.keys(want2)));
  return { add, complete };
}

/* ================= Pulizia storico (trigger mensile) ================= */

function pulisciStorico() {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const m = SpreadsheetApp.getActive().getSheetByName(SH_M);
    const n = m.getLastRow();
    if (n < 2) return;
    const lim = new Date(); lim.setMonth(lim.getMonth() - STORICO_MESI);
    const d = m.getRange(2, 1, n - 1, 1).getValues();
    let k = 0;
    while (k < d.length && d[k][0] instanceof Date && d[k][0] < lim) k++;
    if (k === d.length) m.getRange(2, 1, k, MCOLS.length).clearContent(); // tutto vecchio
    else if (k) m.deleteRows(2, k);
  } finally {
    lock.releaseLock();
  }
}
