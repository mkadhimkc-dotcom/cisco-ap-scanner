// Renders synthetic stand-in label photos for the golden tests (test/fixtures/switch.jpg, ap.jpg).
// Barcodes are real symbols (bwip-js); scripts/compose_labels.py lays them out on a label, then adds
// tilt, perspective, blur, sensor noise, uneven light and JPEG compression, like a phone photo.
// Real photos can replace the .jpg files; test/fixtures/expected.json holds the ground truth.
import bwipjs from 'bwip-js';
import { mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const root = new URL('..', import.meta.url).pathname;
const tmp = root + 'test/fixtures/.build/';
mkdirSync(tmp, { recursive: true });

const GS = '\x1d', RS = '\x1e', EOT = '\x04';
const codes = {
  ap: [
    ['pid', 'code128', 'CW9166I-B V06'],
    ['serial', 'code128', 'FJC295016BD'],
    ['meraki', 'code128', 'Q5AP-9XMF-374L'],
    ['mac', 'code128', '780F810A68B0'],
  ],
  switch: [
    ['asset', 'code39', '298366'],
    ['mac', 'code39', 'F4B82188DE00'],
    ['serial', 'code128', 'FJC302010KM'],
    ['pid', 'code128', 'C9300-48UN-A V10'],
    ['partno', 'code128', '800-107831-05 D0'],
    ['dm', 'datamatrix', '[)>' + RS + '06' + GS + '11PINMGV10CRE' + GS + 'SFJC302010KM' + RS + EOT],
  ],
};
for (const [label, list] of Object.entries(codes)) {
  for (const [name, bcid, text] of list) {
    const opts = { bcid, text, scale: 3, includetext: false, paddingwidth: 0, paddingheight: 0 };
    if (bcid === 'datamatrix') { opts.parse = false; opts.scale = 4; }
    else { opts.height = 9; }
    writeFileSync(`${tmp}${label}-${name}.png`, await bwipjs.toBuffer(opts));
  }
}
writeFileSync(tmp + 'codes.json', JSON.stringify(codes));
execFileSync('python3', [root + 'scripts/compose_labels.py', tmp, root + 'test/fixtures/'], { stdio: 'inherit' });
