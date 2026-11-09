'use strict';
// Utilità condivise dai test del backend.
const path = require('path');
const { loadBackend } = require('./harness.js'); const { makeFixture } = require('./fixture.js');
const CODE = path.join(__dirname, '../backend/Code.gs');
const LEGACY = path.join(__dirname, 'legacy/Code-v1.1.gs');
const fx = makeFixture();
const clone = x => JSON.parse(JSON.stringify(x));

// Backend 1.2 sulla fixture, con setup() già eseguito. catScad = categorie con scadenza attiva.
function backend({ catScad, mutate, setup = true } = {}) {
  const sheets = clone(fx); if (mutate) mutate(sheets);
  const props = { TOKEN: 'tok' }; if (catScad) props.catScad = JSON.stringify(catScad);
  const h = loadBackend(CODE, { sheets, props });
  if (setup) h.fn.setup();
  return h;
}
function legacy() { return loadBackend(LEGACY, { sheets: clone(fx) }); }

const rowOf = (h, id) => {
  const v = h.values('Prodotti'), hd = v[0]; const r = v.find((x, i) => i && String(x[0]) === id);
  if (!r) return null;
  const o = {}; hd.forEach((c, i) => { o[c] = r[i] === undefined ? '' : r[i]; }); if (o.lotti === undefined) o.lotti = ''; return o;
};
const lotsOf = (h, id) => { const r = rowOf(h, id); return r.lotti ? JSON.parse(r.lotti) : []; };
const post = (h, ops) => h.post({ token: 'tok', ops });
module.exports = { backend, legacy, rowOf, lotsOf, post, clone, CODE, LEGACY, fx };
