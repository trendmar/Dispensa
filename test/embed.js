'use strict';
// Copia lib/lots.js tra i marcatori "// BEGIN lots.js" / "// END lots.js" di Code.gs e index.html.
// Uso: node test/embed.js          riscrive i blocchi
//      node test/embed.js --check  non scrive, esce con 1 se una copia differisce
const fs = require('fs'); const path = require('path');
const BEGIN = '// BEGIN lots.js', END = '// END lots.js';
const TARGETS = ['backend/Code.gs', 'index.html'];

// Il file della libreria senza 'use strict' e senza module.exports (restano solo nel file della libreria).
const lf = s => s.replace(/\r\n/g, '\n');
const libBlock = src => lf(src).replace(/^'use strict';\n/, '').replace(/^module\.exports = .*\n?$/m, '').replace(/\s+$/, '');

function bounds(src) {
  const b = src.indexOf(BEGIN), e = src.indexOf(END);
  if (b < 0 || e < b) return null;
  return { from: b + BEGIN.length, to: e };
}
function extractBlock(src) {
  src = lf(src);
  const r = bounds(src);
  return r ? src.slice(r.from, r.to).replace(/^\n/, '').replace(/\n$/, '') : null;
}
function replaceBlock(src, block) {
  const r = bounds(src);
  if (!r) throw new Error('marcatori mancanti');
  return src.slice(0, r.from) + '\n' + block + '\n' + src.slice(r.to);
}

module.exports = { libBlock, extractBlock, replaceBlock };

if (require.main === module) {
  const root = path.join(__dirname, '..');
  const block = libBlock(fs.readFileSync(path.join(root, 'lib/lots.js'), 'utf8'));
  let bad = 0;
  for (const f of TARGETS) {
    const p = path.join(root, f), src = fs.readFileSync(p, 'utf8');
    if (extractBlock(src) === block) continue;
    if (process.argv.includes('--check')) { console.error('copia diversa:', f); bad++; }
    else { fs.writeFileSync(p, replaceBlock(src, block)); console.log('aggiornato', f); }
  }
  process.exit(bad ? 1 : 0);
}
