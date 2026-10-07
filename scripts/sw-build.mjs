// Recomputes BUILD in site/sw.js: a hash over every precached file, so any change to the app makes the
// service worker byte-different and installs as an update. Run after changing anything under site/:
//   node scripts/sw-build.mjs          (or --check to only verify; used by the unit tests)
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const site = new URL('../site/', import.meta.url).pathname;
export function precacheList(swText) {
  const m = /const PRECACHE = \[([\s\S]*?)\];/.exec(swText);
  return [...m[1].matchAll(/'([^']+)'/g)].map(x => x[1]);
}
export function buildHash(swText) {
  const h = createHash('sha256');
  for (const p of precacheList(swText)) {
    if (p === './') continue;
    h.update(p + '\0'); h.update(readFileSync(site + p));
  }
  return h.digest('hex').slice(0, 12);
}
if (import.meta.url === `file://${process.argv[1]}`) {
  const sw = readFileSync(site + 'sw.js', 'utf8');
  const want = buildHash(sw), have = /const BUILD = '([0-9a-f]*)'/.exec(sw)[1];
  if (process.argv.includes('--check')) { console.log(want === have ? 'BUILD up to date' : `BUILD stale: ${have} != ${want}`); process.exit(want === have ? 0 : 1); }
  writeFileSync(site + 'sw.js', sw.replace(/const BUILD = '[0-9a-f]*'/, `const BUILD = '${want}'`));
  console.log('BUILD', want);
}
