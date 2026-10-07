/* Staged live pipeline (runs in the worker).
   Every frame: one cheap decode of the crop.  Only on steady (sharp) frames: the expensive region + tilt
   sweep, run on the sharpest of the last few frames, once per region. Results are cached by region position:
   a region that decoded remembers the angle and zoom that worked, so later frames re-read it with a single
   targeted decode (a cheap confirming vote); a region that did not decode is not swept again for a while.
   Frames live only in memory and are dropped as soon as a newer one replaces them. */
import { fitLongSide, laplacianVariance } from './image.js';
import { findBarcodeRegions, posBox } from './regions.js';
import { regionCovered, sweepRegion, prepRegion, decodeTransformed } from './scan.js';

const LIVE_SWEEPS = [{ s: 1, offs: [-2, 0, 2], max: 1e9 }, { s: 2, offs: [-2, 0, 2], max: 700 }];
export const MIN_SHARP = 20;          // Laplacian variance below this is blur or a blank wall
const CHEAP_MAX_SIDE = 2600;          // cheap pass decodes at native resolution up to this size

export class LivePipeline {
  constructor(decode, opts = {}) {
    this.decode = decode;
    this.window = opts.window || 6;            // "sharpest of the last N frames"
    this.ttl = opts.ttl || 4000;               // do not re-sweep the same region position for this long
    this.maxRegions = opts.maxRegions || 2;    // bound per-frame latency
    this.reset();
  }

  reset() {
    this.scores = [];
    this.best = null;
    this.cache = [];   // [{orient, cx, cy, size, t, hit, fix}] in frame fractions
    this.frameNo = 0;
    this.lastSweep = -99;
  }

  /* img = {data, width, height} -> {codes:[{format,text,pos}], sharp, steady, swept, ms} (pos in img px) */
  async frame(img, now = Date.now()) {
    const t0 = Date.now();
    this.frameNo++;
    const sharp = laplacianVariance(img, 640);
    this.scores.push(sharp);
    if (this.scores.length > 24) this.scores.shift();
    const ref = [...this.scores].sort((a, b) => a - b)[Math.floor(this.scores.length * 0.8)];
    const steady = sharp >= MIN_SHARP && sharp >= 0.6 * ref;

    // stage 1: cheap whole-crop decode
    const s = Math.min(1, CHEAP_MAX_SIDE / Math.max(img.width, img.height));
    const small = s < 1 ? fitLongSide(img, CHEAP_MAX_SIDE) : img;
    const codes = [];
    try {
      for (const r of await this.decode(small, true))
        codes.push({ format: r.format, text: r.text, pos: r.pos ? r.pos.map(p => ({ x: p.x / s, y: p.y / s })) : null });
    } catch (e) { /* a bad frame is skipped */ }
    const boxes = codes.map(c => posBox(c.pos)).filter(Boolean);

    // remember the sharpest recent frame (with what the cheap pass already explained)
    if (steady && (!this.best || sharp >= this.best.sharp || this.frameNo - this.best.frameNo >= this.window))
      this.best = { img, sharp, frameNo: this.frameNo, boxes };
    else if (this.best && this.frameNo - this.best.frameNo >= this.window) this.best = null;

    // stage 2: region + tilt sweep on the best steady frame, at most every other frame
    let swept = 0;
    if (steady && this.best && this.frameNo - this.lastSweep >= 2) {
      const b = this.best; this.best = null; this.lastSweep = this.frameNo;
      let regions = [];
      try { regions = findBarcodeRegions(b.img, {}); } catch (e) { regions = []; }
      for (const r of regions) {
        if (swept >= this.maxRegions) break;
        if (regionCovered(r, b.boxes)) continue;
        const seen = findCached(this.cache, r, b.img);
        const corners = [{ x: r.x, y: r.y }, { x: r.x + r.w, y: r.y }, { x: r.x + r.w, y: r.y + r.h }, { x: r.x, y: r.y + r.h }];
        const onFound = list => {
          for (const c of list) if (!codes.some(o => o.format === c.format && o.text === c.text)) codes.push({ format: c.format, text: c.text, pos: corners });
        };
        if (seen && seen.hit) {
          // known good transform: one targeted decode (does not count against the sweep budget)
          const prep = prepRegion(b.img, r);
          if (prep && await decodeTransformed(prep, seen.hit.deg - seen.fix + r.fix, seen.hit.scale, img2 => this.decode(img2, false), onFound)) seen.t = now;
          continue;
        }
        if (seen && now - seen.t < this.ttl) continue;
        swept++;
        const res = await sweepRegion(b.img, r, LIVE_SWEEPS, img2 => this.decode(img2, false), onFound, null, null, true);
        this.cache.push(Object.assign(regionSpot(r, b.img), { t: now, hit: res.hit, fix: r.fix }));
      }
      this.cache = this.cache.filter(v => now - v.t <= this.ttl * 3);
    }
    return { codes, sharp: Math.round(sharp), steady, swept, ms: Date.now() - t0 };
  }
}

/* Where a region sits, as fractions of the frame, so the same barcode seen a few pixels away (hand shake)
   matches its cache entry. */
export function regionSpot(r, img) {
  return { orient: r.orient, cx: (r.x + r.w / 2) / img.width, cy: (r.y + r.h / 2) / img.height, size: Math.max(r.w, r.h) / Math.max(img.width, img.height) };
}
export function sameSpot(a, b) {
  return a.orient === b.orient && Math.abs(a.cx - b.cx) < 0.04 && Math.abs(a.cy - b.cy) < 0.04 && a.size / b.size > 0.75 && a.size / b.size < 1.33;
}
export function findCached(cache, r, img) {
  const spot = regionSpot(r, img);
  return cache.find(c => sameSpot(c, spot)) || null;
}
