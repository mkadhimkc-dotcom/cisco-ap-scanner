// The service worker must precache every file the app needs, and its BUILD hash must be current
// (run `node scripts/sw-build.mjs` after changing anything under site/).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { precacheList, buildHash } from '../../scripts/sw-build.mjs';

const site = new URL('../../site/', import.meta.url).pathname;
const sw = readFileSync(site + 'sw.js', 'utf8');
function walk(dir, base = '') {
  return readdirSync(dir).flatMap(n => statSync(dir + n).isDirectory() ? walk(dir + n + '/', base + n + '/') : [base + n]);
}
const NOT_NEEDED = /(^|\/)(LICENSE[^/]*|\.nojekyll|sw\.js)$/;

test('every app file is precached for offline use', () => {
  const list = new Set(precacheList(sw));
  const missing = walk(site).filter(p => !NOT_NEEDED.test(p) && !list.has(p));
  assert.deepEqual(missing, []);
  for (const p of list) if (p !== './') assert.ok(statSync(site + p).isFile(), p + ' exists');
});

test('sw.js BUILD hash matches the precached files', () => {
  assert.equal(/const BUILD = '([0-9a-f]*)'/.exec(sw)[1], buildHash(sw), 'run: node scripts/sw-build.mjs');
});

test('manifest: standalone, start URL, 192 and 512 icons', () => {
  const m = JSON.parse(readFileSync(site + 'manifest.webmanifest', 'utf8'));
  assert.equal(m.display, 'standalone');
  assert.equal(m.start_url, './');
  for (const size of ['192x192', '512x512']) assert.ok(m.icons.some(i => i.sizes === size), size);
  assert.ok(m.icons.some(i => i.purpose === 'maskable'));
});
