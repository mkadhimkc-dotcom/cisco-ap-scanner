import { test } from 'node:test';
import assert from 'node:assert/strict';
import { splitStack, findBarcodeRegions } from '../../site/src/regions.js';
import { regionSpot, sameSpot, LivePipeline, MIN_SHARP } from '../../site/src/live.js';
import { laplacianVariance } from '../../site/src/image.js';

function canvas(w, h, fill = 255) {
  const data = new Uint8ClampedArray(w * h * 4).fill(fill);
  return { data, width: w, height: h };
}
function bars(img, x0, y0, w, h, period = 6) {
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) {
    const v = Math.floor((x - x0) / (period / 2)) % 2 ? 255 : 0, o = (y * img.width + x) * 4;
    img.data[o] = img.data[o + 1] = img.data[o + 2] = v;
  }
}

function boxBlur(img, r) {
  const { width: W, height: H } = img, out = new Uint8ClampedArray(img.data.length);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let sum = 0, n = 0;
    for (let yy = Math.max(0, y - r); yy <= Math.min(H - 1, y + r); yy++) for (let xx = Math.max(0, x - r); xx <= Math.min(W - 1, x + r); xx++) { sum += img.data[(yy * W + xx) * 4]; n++; }
    const o = (y * W + x) * 4; out[o] = out[o + 1] = out[o + 2] = sum / n; out[o + 3] = 255;
  }
  return { data: out, width: W, height: H };
}

test('splitStack: separates bands of blocks with an empty row between them', () => {
  const blocks = [];
  for (const y of [0, 1, 2, 6, 7, 8]) for (let x = 0; x < 12; x++) blocks.push(x, y);
  for (let x = 0; x < 2; x++) blocks.push(x, 4);   // a thin "text" bridge
  const parts = splitStack(blocks, 'h');
  assert.equal(parts.length, 2);
  assert.equal(parts[0].length / 2, 36);
  assert.equal(parts[1].length / 2, 36);
  assert.equal(splitStack(blocks.slice(0, 72), 'h').length, 1, 'one band stays whole');
});

test('findBarcodeRegions: two stacked barcodes become two regions', () => {
  const img = canvas(1200, 700);
  bars(img, 200, 120, 700, 110);
  bars(img, 200, 330, 700, 110);   // 100 px gap (a text line in real labels)
  const r = findBarcodeRegions(img, {}).filter(x => x.orient === 'h');
  assert.equal(r.length, 2);
  assert.ok(r.every(x => x.h < 320), 'each region is one symbol tall (plus quiet-zone padding)');
});

test('region cache matching: same symbol under hand shake, not a neighbour or another orientation', () => {
  const img = { width: 1600, height: 1000 };
  const a = { x: 400, y: 300, w: 500, h: 140, orient: 'h' };
  const spot = regionSpot(a, img);
  for (const [dx, dy] of [[10, 6], [-20, -12], [40, 25]]) assert.ok(sameSpot(spot, regionSpot({ ...a, x: a.x + dx, y: a.y + dy }, img)), `${dx},${dy}`);
  assert.ok(!sameSpot(spot, regionSpot({ ...a, y: 470 }, img)), 'the barcode below');
  assert.ok(!sameSpot(spot, regionSpot({ ...a, orient: 'v' }, img)));
  assert.ok(!sameSpot(spot, regionSpot({ ...a, w: 250 }, img)), 'much smaller symbol');
});

test('laplacianVariance: blur lowers the score; flat image scores ~0', () => {
  const sharp = canvas(400, 300); bars(sharp, 50, 50, 300, 200, 4);
  const blurred = boxBlur(boxBlur(sharp, 4), 4);
  assert.ok(laplacianVariance(sharp) > 1000);
  assert.ok(laplacianVariance(canvas(400, 300)) < 1);
  assert.ok(laplacianVariance(blurred) < laplacianVariance(sharp) / 20, 'blur cuts the score sharply');
});

test('LivePipeline: skips the expensive sweep on blurry frames, runs it on steady ones', async () => {
  const calls = [];
  const decode = async (img, quick) => { calls.push(quick ? 'quick' : 'sweep'); return []; };
  const pipe = new LivePipeline(decode);
  const steady = canvas(900, 600); bars(steady, 100, 200, 600, 120, 6);
  const flat = canvas(900, 600, 128);
  const a = await pipe.frame(flat);
  assert.equal(a.steady, false);
  assert.equal(a.swept, 0);
  assert.deepEqual(calls, ['quick']);
  calls.length = 0;
  const b = await pipe.frame(steady);
  assert.equal(b.steady, true);
  assert.ok(b.swept >= 1 && calls.includes('sweep'), 'sweep ran on the sharp frame');
  calls.length = 0;
  await pipe.frame(steady); await pipe.frame(steady);
  assert.ok(!calls.includes('sweep') || calls.filter(c => c === 'sweep').length < 3, 'same region not fully re-swept within the cache TTL');
});
