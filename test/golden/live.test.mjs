// Live pipeline on the fake-camera feeds (test/fixtures/*.y4m, built by `npm run fixtures:video`):
// every expected field must be read and confirmed by two or more frames.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { LivePipeline } from '../../site/src/live.js';
import { buildDevice } from '../../site/src/device.js';
import { formatMac } from '../../site/src/classify.js';
import { crop } from '../../site/src/image.js';
import { fixture, readY4m, nodeDecoder } from '../helpers.mjs';

const expected = JSON.parse(readFileSync(fixture('expected.json'), 'utf8'));
for (const name of ['ap', 'switch']) {
  test(`live feed: ${name}.y4m`, { skip: !existsSync(fixture(name + '.y4m')) && 'run npm run fixtures:video', timeout: 120000 }, async () => {
    const decode = await nodeDecoder();
    const pipe = new LivePipeline(decode);
    const acc = new Map(); let ms = 0;
    for (const f of readY4m(fixture(name + '.y4m'), 24)) {
      // the app's guide box (inset 9% / 6%) on a full-frame preview
      const r = await pipe.frame(crop(f, f.width * 0.06, f.height * 0.09, f.width * 0.88, f.height * 0.82));
      ms += r.ms;
      for (const c of new Map(r.codes.map(c => [c.format + '|' + c.text, c])).values()) {
        const k = c.format + '|' + c.text; acc.set(k, (acc.get(k) || { format: c.format, text: c.text, count: 0 })); acc.get(k).count++;
      }
    }
    const dev = buildDevice([...acc.values()], {});
    const want = expected[name + '.jpg'];
    for (const [k, v] of Object.entries(want)) {
      if (k === 'type') { assert.equal(dev.type, v); continue; }
      assert.equal(k === 'mac' ? formatMac(dev[k], 'colons') : dev[k], v, k);
      assert.ok(dev.votes[k] >= 2, `${k} confirmed (${dev.votes[k]} reads)`);
    }
    console.log(`  ${name}: 24 frames, ${ms} ms decode, votes ${JSON.stringify(dev.votes)}`);
  });
}
