// Golden-image tests: the still-photo pipeline must read every expected field from the fixtures.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { scanImage } from '../../site/src/scan.js';
import { buildDevice } from '../../site/src/device.js';
import { formatMac } from '../../site/src/classify.js';
import { fixture, loadJpeg, nodeDecoder } from '../helpers.mjs';

const expected = JSON.parse(readFileSync(fixture('expected.json'), 'utf8'));

for (const [file, want] of Object.entries(expected)) {
  test(`golden: ${file}`, { timeout: 180000 }, async () => {
    const decode = await nodeDecoder();
    const t0 = Date.now();
    const codes = await scanImage(loadJpeg(fixture(file)), decode);
    const dev = buildDevice(codes, {});
    const got = { type: dev.type };
    for (const k of Object.keys(want)) if (k !== 'type') got[k] = k === 'mac' ? formatMac(dev[k], 'colons') : dev[k];
    console.log(`  ${file}: ${codes.length} codes in ${Date.now() - t0} ms`);
    assert.deepEqual(got, want);
    assert.deepEqual(dev.warnings, [], 'no conflicting reads');
  });
}
