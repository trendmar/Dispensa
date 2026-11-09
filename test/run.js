'use strict';
// Esegue ogni test/*.test.js in un processo separato; esce con 1 al primo fallimento.
const { spawnSync } = require('child_process'); const fs = require('fs'); const path = require('path');
let failed = 0, total = 0;
for (const f of fs.readdirSync(__dirname).filter(f => f.endsWith('.test.js')).sort()) {
  const r = spawnSync(process.execPath, [path.join(__dirname, f)], { encoding: 'utf8' });
  total++;
  if (r.status === 0) console.log('PASS', f, '-', (r.stdout.trim().split('\n').pop()));
  else { failed++; console.log('FAIL', f + '\n' + r.stdout + r.stderr); }
}
console.log(failed ? `${failed}/${total} file di test FALLITI` : `${total}/${total} file di test superati`);
process.exit(failed ? 1 : 0);
