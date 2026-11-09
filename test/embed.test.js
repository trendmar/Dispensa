'use strict';
// P-5: le copie di lib/lots.js in Code.gs e index.html devono essere identiche al file della libreria.
const assert = require('assert'); const fs = require('fs'); const path = require('path');
const E = require('./embed.js');
const root = path.join(__dirname, '..');
const lib = fs.readFileSync(path.join(root, 'lib/lots.js'), 'utf8');
const block = E.libBlock(lib);
let n = 0; const t = (name, f) => { f(); n++; console.log('ok -', name); };

t('libBlock toglie use strict e module.exports', () => {
  assert.ok(!/use strict/.test(block)); assert.ok(!/module\.exports/.test(block));
  assert.ok(/function applyDelta/.test(block));
});
t('extractBlock senza marcatori restituisce null', () => assert.strictEqual(E.extractBlock('niente'), null));
t('replaceBlock e extractBlock fanno il giro completo', () => {
  const src = 'a\n// BEGIN lots.js\nvecchio\n// END lots.js\nb';
  const r = E.replaceBlock(src, 'nuovo');
  assert.strictEqual(E.extractBlock(r), 'nuovo'); assert.ok(r.startsWith('a\n') && r.endsWith('\nb'));
});
t('replaceBlock senza marcatori lancia', () => assert.throws(() => E.replaceBlock('niente', 'x')));
for (const f of ['backend/Code.gs', 'index.html']) {
  t(`${f} contiene una copia identica di lib/lots.js`, () => {
    const got = E.extractBlock(fs.readFileSync(path.join(root, f), 'utf8'));
    assert.notStrictEqual(got, null, 'marcatori mancanti in ' + f);
    assert.strictEqual(got, block, 'copia diversa da lib/lots.js in ' + f);
  });
}
console.log(n + ' test superati');
