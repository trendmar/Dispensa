'use strict';
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
module.exports = { isoOrEmpty, parseLots, serializeLots, addToLot, consumeFefo, consumeFromLot, moveUnits, reconcile, effectiveLots, nextExpiry, applyDelta, total };
