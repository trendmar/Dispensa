'use strict';
// Fixture anonimizzata. I dati grezzi passano UNA volta da toItem/writeTable della v1.1:
// è il punto fisso a cui il foglio reale è già arrivato (§6.5). Righe a 15 colonne, come nel foglio 1.1.
const path = require('path'); const { loadBackend } = require('./harness.js');
const LEGACY = path.join(__dirname, 'legacy/Code-v1.1.gs');

const PHEAD = ['id', 'barcode', 'nome', 'marca', 'formato', 'categoria', 'posizione', 'qty', 'scortaMin', 'scadenza', 'note', 'img', 'updated', 'updatedBy', 'stato'];
const SHEAD = ['id', 'nome', 'stato', 'quando', 'utente'];
const MHEAD = ['quando', 'id', 'nome', 'op', 'delta', 'qtyDopo', 'utente'];

function raw(h) {
  const d = h.eval('new Date(2026, 10, 12)'); // data "grezza" come Date: la 1.1 la converte in testo ISO
  return [
    ['p1abc', '0012345678905', 'Yogurt greco', 'Fage', '150 g', 'Latticini', 'Frigo', 3, 2, '2026-11-10', '', '', '2026-11-01T10:00:00.000Z', 'Mario', ''],
    ['p2def', 8001234567890, 'Biscotti', 'Mulino', '500 g', 'Colazione', 'Dispensa', 4, 1, '2027-03-01', 'aperti', '', '', '', ''],
    ['p3ghi', '3017620422003', 'Spaghetti n.5', 'Barilla', '500 g', 'Pasta e riso', 'Dispensa', '5', '', '', '', '', '', 'Alba', ''],
    ['p4jkl', '5000112637922', 'Latte', '', '1 L', 'Latticini', 'Frigo', 0, 1, d, '', '', '', '', 'comprare'],
    ['p5mno', '4056489012345', 'Petto di pollo', '', '400 g', 'Carne e pesce', 'Frigo', 2, 0, '2026-11-09', '', '', '', 'Mario', ''],
    ['p6pqr', '', 'Mele', '', '', 'Frutta e verdura', 'Dispensa', 6, 0, '', '', '', '', '', ''],
    ['p7stu', '', 'Carta igienica', '', '', 'Casa e pulizia', '', 8, 2, '', '', '', '', '', ''],
  ];
}

function makeFixture() {
  const h = loadBackend(LEGACY);
  h.setSheet('Prodotti', [PHEAD].concat(raw(h)));
  h.setSheet('Spesa', [SHEAD, ['x1', 'Candele', '', '2026-11-01T09:00:00.000Z', 'Alba']]);
  h.setSheet('Movimenti', [MHEAD]);
  const db = h.fn.openDb(); db.dirtyP = true; db.dirtyS = true; h.fn.saveDb(db);
  return { Prodotti: h.values('Prodotti'), Spesa: h.values('Spesa'), Movimenti: h.values('Movimenti') };
}
module.exports = { makeFixture, PHEAD, SHEAD, MHEAD };
