/**
 * DISPENSA — backend Google Apps Script su Google Sheet          v1.2
 *
 * Fogli:
 *   Prodotti  — inventario (una riga per prodotto)
 *   Spesa     — voci libere della lista spesa (non legate a un prodotto)
 *   Movimenti — storico azioni (pulito in automatico oltre STORICO_MESI)
 *
 * Primo setup: vedi LEGGIMI.md.
 * Aggiornamento: aggiungi la proprietà script TOKEN, incolla questo file, esegui auditDb() e setup(),
 * poi Gestisci deployment → modifica → Versione: Nuova versione (mai "Nuovo deployment"). Vedi docs/MIGRAZIONE-v1.2.md.
 */

const VERSION = '1.2.0';
const TOKEN = 'CAMBIA-QUESTO-TOKEN'; // segnaposto, non usato: il token vero sta nella proprietà script TOKEN
const STORICO_MESI = 12;

const SH_P = 'Prodotti', SH_S = 'Spesa', SH_M = 'Movimenti';
const COLS = ['id', 'barcode', 'nome', 'marca', 'formato', 'categoria', 'posizione',
              'qty', 'scortaMin', 'scadenza', 'note', 'img', 'updated', 'updatedBy', 'stato', 'lotti'];
const SCOLS = ['id', 'nome', 'stato', 'quando', 'utente'];
const MCOLS = ['quando', 'id', 'nome', 'op', 'delta', 'qtyDopo', 'utente'];
const TEXT_COLS = ['id', 'barcode', 'scadenza', 'updated', 'lotti']; // testo: zeri iniziali, date ISO, JSON dei lotti

// BEGIN lots.js
/* Riferimento per la rev. 1.2: logica pura dei lotti, identica lato app e lato Code.gs.
   Lotto = { d: 'YYYY-MM-DD' | '', q: intero > 0 }. d vuoto = senza data. */

// Data valida solo se YYYY-MM-DD, altrimenti 'senza data'.
const isoOrEmpty = d => (/^\d{4}-\d{2}-\d{2}$/.test(String(d || '')) ? String(d) : '');
const cmp = (a, b) => (a.d === b.d ? 0 : a.d === '' ? 1 : b.d === '' ? -1 : a.d < b.d ? -1 : 1);
const sorted = lots => lots.slice().sort(cmp);
const total = lots => lots.reduce((s, l) => s + l.q, 0);

function parseLots(raw) {
  if (!raw) return [];
  try {
    const a = JSON.parse(raw);
    if (!Array.isArray(a)) return [];
    return a.filter(l => l && Number(l.q) > 0).map(l => ({ d: isoOrEmpty(l.d), q: Math.floor(Number(l.q)) }));
  } catch (e) { return []; }
}
const serializeLots = lots => (lots.length ? JSON.stringify(sorted(lots).map(l => ({ d: l.d, q: l.q }))) : '');

function addToLot(lots, d, n) {
  d = isoOrEmpty(d);
  const out = lots.map(l => ({ ...l }));
  const f = out.find(l => l.d === d);
  if (f) f.q += n; else out.push({ d, q: n });
  return sorted(out);
}
function consumeFefo(lots, n) {
  const out = []; const taken = []; let left = n;
  for (const l of sorted(lots)) {
    if (left <= 0) { out.push({ ...l }); continue; }
    const t = Math.min(l.q, left); left -= t; taken.push({ d: l.d, q: t });
    if (l.q > t) out.push({ d: l.d, q: l.q - t });
  }
  return { lots: out, taken };
}
// Consumo da un lotto preciso; se non basta (o non esiste) il resto va in FEFO. Il totale scalato è sempre n.
function consumeFromLot(lots, d, n) {
  d = isoOrEmpty(d);
  const f = lots.find(l => l.d === d);
  const t = Math.min(n, f ? f.q : 0);
  const rest = lots.map(l => (l.d === d ? { d: l.d, q: l.q - t } : { ...l })).filter(l => l.q > 0);
  const taken = t ? [{ d, q: t }] : [];
  if (n - t <= 0) return { lots: sorted(rest), taken };
  const r = consumeFefo(rest, n - t);
  return { lots: r.lots, taken: taken.concat(r.taken) };
}
function moveUnits(lots, from, to, n) {
  from = isoOrEmpty(from);
  const f = lots.find(l => l.d === from);
  const t = Math.min(n, f ? f.q : 0);
  if (!t) return lots.map(l => ({ ...l }));
  const rest = lots.map(l => (l.d === from ? { d: l.d, q: l.q - t } : { ...l })).filter(l => l.q > 0);
  return addToLot(rest, to, t);
}
function reconcile(lots, qty) {
  const s = total(lots);
  if (s < qty) return addToLot(lots, '', qty - s);
  if (s > qty) return consumeFefo(lots, s - qty).lots;
  return sorted(lots);
}
// Lotti effettivi di un prodotto tracciato. Non scrive nulla: lotti virtuale se la colonna è vuota.
function effectiveLots(item) {
  const own = parseLots(item.lotti);
  if (own.length) return reconcile(own, item.qty);
  return item.qty > 0 ? [{ d: item.scadenza || '', q: item.qty }] : [];
}
const nextExpiry = lots => (sorted(lots).find(l => l.d !== '') || { d: '' }).d;

// Operazione delta su prodotto tracciato. Restituisce una copia del prodotto con lotti, qty, scadenza coerenti.
function applyDelta(item, delta, lotDate) {
  let lots = effectiveLots(item); let taken = [];
  const qty = Math.max(0, item.qty + delta);
  if (delta > 0) lots = addToLot(lots, lotDate || '', delta);
  else if (delta < 0) {
    const n = Math.min(-delta, item.qty);
    const r = lotDate ? consumeFromLot(lots, lotDate, n) : consumeFefo(lots, n);
    lots = r.lots; taken = r.taken;
  }
  return { item: { ...item, qty, lotti: serializeLots(lots), scadenza: nextExpiry(lots) }, taken };
}
// END lots.js

/* ================= SETUP (idempotente: si può rieseguire) ================= */

/** Il token sta SOLO nella proprietà script TOKEN (Q6): la costante qui sopra è un segnaposto. */
function getToken_() { return PropertiesService.getScriptProperties().getProperty('TOKEN') || ''; }
function tokenOk_(t) { const k = getToken_(); return k !== '' && String(t || '') === k; }

/**
 * Non modifica, sposta o cancella righe di dati (R3.1): aggiunge l'intestazione "lotti" in P1,
 * il formato testo della colonna 16 e i trigger. Tutti i controlli vengono PRIMA di qualsiasi scrittura (R3.3).
 */
function setup() {
  if (!getToken_()) throw new Error('Manca la proprietà script TOKEN: aggiungila (stesso valore del token attuale) e riesegui setup().');
  const ss = SpreadsheetApp.getActive();
  let p = ss.getSheetByName(SH_P);
  const nuovo = !p || p.getLastRow() === 0;
  if (!nuovo) checkProdotti_(p);

  if (nuovo) {
    p = getOrCreate(ss, SH_P);
    header(p, COLS);
    TEXT_COLS.forEach(c => p.getRange(1, COLS.indexOf(c) + 1, p.getMaxRows()).setNumberFormat('@'));
  } else {
    if (p.getMaxColumns() < COLS.length) p.insertColumnsAfter(p.getMaxColumns(), COLS.length - p.getMaxColumns());
    p.getRange(1, COLS.length).setValue('lotti').setFontWeight('bold');
    p.getRange(1, COLS.length, p.getMaxRows()).setNumberFormat('@');
  }
  const s = getOrCreate(ss, SH_S);
  if (s.getLastRow() === 0) { header(s, SCOLS); s.getRange(1, 1, s.getMaxRows()).setNumberFormat('@'); }
  const m = getOrCreate(ss, SH_M);
  if (m.getLastRow() === 0) header(m, MCOLS);

  const def = ss.getSheetByName('Foglio1') || ss.getSheetByName('Sheet1');
  if (def && def.getLastRow() === 0 && ss.getSheets().length > 3) ss.deleteSheet(def);

  // trigger: pulizia storico (il 1° del mese alle 3) e copia di sicurezza settimanale (domenica alle 4)
  ScriptApp.getProjectTriggers()
    .filter(t => ['pulisciStorico', 'snapshot'].indexOf(t.getHandlerFunction()) >= 0)
    .forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('pulisciStorico').timeBased().onMonthDay(1).atHour(3).create();
  ScriptApp.newTrigger('snapshot').timeBased().onWeekDay(ScriptApp.WeekDay.SUNDAY).atHour(4).create();
}

/** Lancia un errore (senza aver scritto nulla) se il foglio Prodotti non è nello stato atteso. */
function checkProdotti_(p) {
  const w = Math.min(COLS.length, p.getMaxColumns());
  const head = p.getRange(1, 1, 1, w).getValues()[0];
  if (w === COLS.length && head[w - 1] !== '' && head[w - 1] !== 'lotti')
    throw new Error('La cella P1 contiene "' + head[w - 1] + '": setup si ferma. Libera la colonna 16 o controlla il foglio.');
  for (let i = 0; i < COLS.length - 1; i++)
    if (head[i] !== '' && head[i] !== COLS[i]) throw new Error('Prodotti: intestazione inattesa in colonna ' + (i + 1) + ' ("' + head[i] + '", attesa "' + COLS[i] + '").');
  const n = p.getLastRow() - 1;
  if (n < 1) return;
  p.getRange(2, 1, n, w).getValues().forEach((r, i) => {
    if (String(r[0]) === '' && r.some(v => v !== '')) throw new Error('Prodotti riga ' + (i + 2) + ': celle valorizzate ma id vuoto (riga senza id). Correggi o elimina la riga, poi riesegui setup().');
  });
}

function getOrCreate(ss, name) { return ss.getSheetByName(name) || ss.insertSheet(name); }
function header(sh, cols) {
  sh.getRange(1, 1, 1, cols.length).setValues([cols]).setFontWeight('bold');
  sh.setFrozenRows(1);
}

/* ================= HTTP ================= */

function doGet(e) {
  if (!tokenOk_(e.parameter.token)) return out({ ok: false, error: 'token' });
  const db = openDb();
  return out({ ok: true, version: VERSION, items: db.items, extras: db.extras, config: getConfig_() });
}

function doPost(e) {
  let req;
  try { req = JSON.parse(e.postData.contents); } catch (x) { return out({ ok: false, error: 'json' }); }
  if (!tokenOk_(req.token || e.parameter.token)) return out({ ok: false, error: 'token' });

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const db = openDb();
    if (req.action === 'alexaSync') {
      const res = alexaSync(db, req.alexa || []);
      saveDb(db);
      return out(Object.assign({ ok: true }, res));
    }
    const t0 = Date.now();
    const ops = req.ops || [];
    // idempotenza (Q7): un'operazione con opId già visto non si riapplica. Una getAll e una putAll per richiesta.
    const keyOf = op => (op && op.opId ? 'op:' + op.opId : '');
    const keys = ops.map(keyOf).filter(Boolean);
    const cache = CacheService.getScriptCache();
    const seen = keys.length ? cache.getAll(keys) : {};
    const fresh = {};
    const results = ops.map(op => {
      const k = keyOf(op);
      if (k && (seen[k] || fresh[k])) return { ok: true, dup: true };
      let res;
      try { res = applyOp(db, op); } catch (err) { return { ok: false, error: String(err) }; }
      if (k) fresh[k] = '1';
      return res;
    });
    saveDb(db);
    if (Object.keys(fresh).length) cache.putAll(fresh, 21600);
    console.log(JSON.stringify({ ops: ops.map(o => o && o.op), ms: Date.now() - t0 }));
    return out({ ok: true, version: VERSION, results, items: db.items, extras: db.extras, config: getConfig_() });
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
    ss, p, s, pn, sn, logs: [], dirtyP: false, dirtyS: false, catScad: getCatScad_(),
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
        // R1.4a: lotti non si copia mai dal client; scadenza non si copia se la categoria (dopo l'aggiornamento) è attiva
        const attiva = db.catScad.indexOf(it.categoria !== undefined ? it.categoria : ex.categoria) >= 0;
        COLS.forEach(c => {
          if (['id', 'qty', 'updated', 'updatedBy', 'stato', 'lotti'].indexOf(c) >= 0 || it[c] === undefined) return;
          if (c === 'scadenza' && attiva) return;
          ex[c] = it[c];
        });
        ex.scortaMin = Number(ex.scortaMin) || 0;
        if (attiva) applyTracked_(ex, d, ''); // anche con d = 0: è un tocco, i lotti si materializzano (R1.3)
        else ex.qty = Math.max(0, ex.qty + d);
        if (d > 0) { ex.stato = ''; chiudiVociLibere(db, ex); }
        touch(ex, user);
        log(db, ex, 'modifica', d, user);
      } else {
        const n = {};
        COLS.forEach(c => n[c] = it[c] === undefined ? '' : it[c]);
        n.id = String(n.id); n.barcode = String(n.barcode || '');
        n.qty = Math.max(0, Number(n.qty) || 0); n.scortaMin = Number(n.scortaMin) || 0;
        n.stato = ''; n.lotti = '';
        if (isTracked_(db, n)) { // categoria attiva: il primo lotto nasce da qty e scadenza (il client non invia lotti)
          const lots = n.qty > 0 ? [{ d: isoOrEmpty(n.scadenza), q: n.qty }] : [];
          n.lotti = serializeLots(lots); n.scadenza = nextExpiry(lots);
        }
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
      if (isTracked_(db, ex)) applyTracked_(ex, d, op.lot);
      else ex.qty = Math.max(0, ex.qty + d);
      if (d > 0) { ex.stato = ''; chiudiVociLibere(db, ex); } // caricato → esce dalla lista
      touch(ex, user);
      log(db, ex, d > 0 ? 'carico' : 'scarico', d, user);
      db.dirtyP = true;
      return { ok: true, qty: ex.qty };
    }
    case 'lotMove': {                     // sposta unità tra lotti; qty non cambia, nessuna riga in Movimenti
      const ex = byId(op.id);
      if (!ex) return { ok: false, error: 'non trovato' };
      if (!isTracked_(db, ex)) return { ok: true };
      const lots = moveUnits(effectiveLots(ex), op.from, op.to, Math.max(0, Math.floor(Number(op.q)) || 0));
      ex.lotti = serializeLots(lots); ex.scadenza = nextExpiry(lots);
      touch(ex, user);
      db.dirtyP = true;
      return { ok: true };
    }
    case 'cfgSet': {                      // configurazione condivisa: oggi solo catScad (array di nomi di categoria)
      if (op.key !== 'catScad') return { ok: false, error: 'chiave non valida' };
      if (!Array.isArray(op.value) || op.value.some(v => typeof v !== 'string')) return { ok: false, error: 'valore non valido' };
      db.catScad = op.value.map(v => v.trim()).filter((v, i, a) => v && a.indexOf(v) === i);
      PropertiesService.getScriptProperties().setProperty('catScad', JSON.stringify(db.catScad));
      return { ok: true };
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

/* ================= Lotti e configurazione (R1) ================= */

function getCatScad_() {
  try {
    const a = JSON.parse(PropertiesService.getScriptProperties().getProperty('catScad') || '[]');
    return Array.isArray(a) ? a.filter(v => typeof v === 'string') : [];
  } catch (e) { return []; }
}
const getConfig_ = () => ({ catScad: getCatScad_() });
const isTracked_ = (db, it) => db.catScad.indexOf(it.categoria) >= 0;

/** delta su prodotto con scadenza attiva: aggiorna qty, lotti e scadenza derivata (R1.6) con l'algoritmo di lots.js */
function applyTracked_(it, delta, lot) {
  const r = applyDelta(it, delta, isoOrEmpty(lot));
  it.qty = r.item.qty; it.lotti = r.item.lotti; it.scadenza = r.item.scadenza;
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

/* ================= Strumenti di sicurezza dati (§6.4) ================= */

const ISO_ = /^\d{4}-\d{2}-\d{2}$/;

/** Sola lettura di Prodotti: elenco di anomalie [tipo, riga, id, nome, dettaglio]. */
function auditFindings_(rows) {
  const f = [], ids = {}, codes = {};
  const add = (tipo, riga, r, det) => f.push([tipo, riga, String(r[0]), String(r[2]), det || '']);
  rows.forEach((r, i) => {
    const riga = i + 2;
    if (r.every(v => v === '')) return;
    if (String(r[0]) === '') { add('riga senza id', riga, r); return; }
    const id = String(r[0]);
    if (ids[id]) add('id duplicato', riga, r, 'già alla riga ' + ids[id]); else ids[id] = riga;
    const bc = String(r[1] || '');
    if (bc) { if (codes[bc]) add('barcode duplicato', riga, r, 'già alla riga ' + codes[bc]); else codes[bc] = riga; }
    if (typeof r[2] === 'number') add('nome numerico', riga, r);
    if (r[7] !== '' && isNaN(Number(r[7]))) add('qty non numerica', riga, r, String(r[7]));
    if (r[8] !== '' && isNaN(Number(r[8]))) add('scortaMin non numerica', riga, r, String(r[8]));
    const sc = r[9];
    if (sc instanceof Date) add('data non ISO', riga, r, 'scadenza è una Date (verrà convertita in testo)');
    else if (sc !== '' && !ISO_.test(String(sc))) add('data non ISO', riga, r, 'scadenza "' + sc + '"');
    const lotti = r[15];
    if (lotti !== '' && lotti !== undefined) {
      let a = null;
      try { a = JSON.parse(lotti); } catch (e) { a = null; }
      if (!Array.isArray(a)) add('lotti non valida', riga, r, String(lotti).slice(0, 60));
      else {
        const tot = a.reduce((s2, l) => s2 + (Number(l && l.q) || 0), 0);
        if (tot !== (Number(r[7]) || 0)) add('lotti somma diversa da qty', riga, r, 'lotti ' + tot + ', qty ' + (Number(r[7]) || 0));
        a.forEach(l => { if (l && l.d && !ISO_.test(String(l.d))) add('data non ISO', riga, r, 'lotto "' + l.d + '"'); });
      }
    }
  });
  return f;
}

function auditDb() {
  const ss = SpreadsheetApp.getActive();
  const p = ss.getSheetByName(SH_P);
  const n = Math.max(0, p.getLastRow() - 1);
  const w = Math.min(COLS.length, p.getMaxColumns());
  const rows = n ? p.getRange(2, 1, n, w).getValues().map(r => r.concat(Array(COLS.length - w).fill(''))) : [];
  const f = auditFindings_(rows);
  const a = getOrCreate(ss, 'Audit');
  a.clear();
  const res = [['tipo', 'riga', 'id', 'nome', 'dettaglio']].concat(f);
  a.getRange(1, 1, res.length, 5).setValues(res);
  console.log('auditDb: ' + f.length + ' anomalie su ' + rows.length + ' righe');
  return f.length;
}

/** Copia Prodotti e Spesa in fogli _bak_*. Non cancella mai nulla: i backup si eliminano a mano. */
function snapshot() {
  const ss = SpreadsheetApp.getActive();
  const stamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyyMMdd_HHmm');
  [SH_P, SH_S].forEach(name => {
    const base = '_bak_' + stamp + '_' + name;
    let nm = base, k = 2;
    while (ss.getSheetByName(nm)) nm = base + '_' + k++;
    ss.getSheetByName(name).copyTo(ss).setName(nm);
  });
}

/** Prima di riportare il backend alla 1.1: svuota la sola colonna lotti. Restituisce i prodotti coinvolti. */
function prepareRollback() {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const p = SpreadsheetApp.getActive().getSheetByName(SH_P);
    const n = p.getLastRow() - 1;
    if (n < 1 || p.getMaxColumns() < COLS.length) return 0;
    const r = p.getRange(2, COLS.length, n, 1);
    const k = r.getValues().filter(v => v[0] !== '').length;
    r.clearContent();
    console.log('prepareRollback: ' + k + ' prodotti con lotti svuotati');
    return k;
  } finally {
    lock.releaseLock();
  }
}
