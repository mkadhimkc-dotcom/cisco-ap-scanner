// Copies the pinned zxing-wasm reader (ES module build + wasm) and the IBM Plex fonts into site/.
// Run after `npm ci` when bumping a version: node scripts/vendor.mjs
import { cpSync, mkdirSync, readFileSync } from 'node:fs';
const root = new URL('..', import.meta.url).pathname;
const nm = root + 'node_modules/';
const pkg = JSON.parse(readFileSync(nm + 'zxing-wasm/package.json', 'utf8'));
const z = nm + 'zxing-wasm/dist/';
const out = root + 'site/vendor/zxing-wasm/';
mkdirSync(out + 'reader', { recursive: true });
cpSync(z + 'es/share.js', out + 'share.js');
cpSync(z + 'es/reader/index.js', out + 'reader/index.js');
cpSync(z + 'reader/zxing_reader.wasm', out + 'reader/zxing_reader.wasm');
console.log('zxing-wasm', pkg.version, '->', out);
