/* Still-photo scan pipeline: whole image, barcode-like regions with a tilt sweep, then blanket tiles. */
import { crop, scaleTo, autoContrast, tileRects, grayOf, grayStretch } from './image.js';
import { findBarcodeRegions, posBox } from './regions.js';
import { transformGray } from './deskew.js';

const tick = () => new Promise(r => setTimeout(r, 0));

export const range = (from, to, step) => { const o = []; for (let v = from; v <= to + 1e-9; v += step) o.push(Math.round(v * 100) / 100); return o; };

/* decode(img) -> Promise<[{format, text, pos?}]> where pos is [{x,y}*4] in img pixels.
   Stage A: whole photo, unrotated.  Stage B: barcode-like regions that stage A did not fully explain
   get a small rotation sweep with upscaling and contrast stretch.  Stage C: blanket tiles, only when
   little was found.  Returns [{format, text, count, pos?}] (pos in img pixels, when known). */
export async function scanImage(img, decode, opts) {
  opts = opts || {};
  const quick = !!opts.quick;
  const hits = new Map(), boxes = [];
  const add = (list, map) => {
    for (const r of list || []) {
      const text = String(r.text || '').replace(/\u0000/g, '').trim();
      if (!text) continue;
      const key = r.format + '|' + text;
      const pos = map && r.pos ? r.pos.map(map) : null;
      const h = hits.get(key);
      if (h) { h.count++; if (!h.pos && pos) h.pos = pos; } else hits.set(key, { format: r.format, text, count: 1, pos });
      if (pos) { const b = posBox(pos); if (b) boxes.push(b); }
    }
  };
  const jobs = [];   // () => {img, ox, oy, s}   x_orig = ox + x / s
  const fitJob = (src, ox, oy, maxSide, post) => () => {
    const f = Math.min(1, maxSide / Math.max(src.width, src.height));
    let im = f < 1 ? scaleTo(src, src.width * f, src.height * f) : src;
    if (post) im = post(im);
    return { img: im, ox, oy, s: f };
  };
  jobs.push(fitJob(img, 0, 0, quick ? 1920 : 2400));
  if (!quick) {
    for (const [x, y, w, h] of tileRects(img.width, img.height, 3, 3, 0.3))
      jobs.push(() => fitJob(crop(img, x, y, w, h), x, y, 1800)());
    for (const [x, y, w, h] of tileRects(img.width, img.height, 2, 3, 0.3))
      jobs.push(() => {
        const t = crop(img, x, y, w, h), f = Math.min(2, 2200 / Math.max(t.width, t.height));
        const up = f > 1.05 ? scaleTo(t, t.width * f, t.height * f) : t;
        return { img: autoContrast(up), ox: x, oy: y, s: f > 1.05 ? f : 1 };
      });
    for (const [x, y, w, h] of tileRects(img.width, img.height, 3, 2, 0.3))
      jobs.push(() => fitJob(crop(img, x, y, w, h), x, y, 2000, autoContrast)());
  }
  const tileJobs = jobs.splice(1);   // blanket tile passes: run last, only if the targeted passes found little
  // each sweep: zoom, angle offsets around the estimated tilt, and the largest region side it applies to
  const sweeps = quick
    ? [{ s: 1, offs: range(-3, 3, 1), max: 1e9 }, { s: 2, offs: [-2, 0, 2], max: 450 }]
    : [{ s: 1, offs: range(-4, 4, 0.5), max: 1e9 }, { s: 2, offs: range(-3, 3, 1), max: 1100 }, { s: 3, offs: range(-3, 3, 1), max: 450 }];
  let regions = [];
  try { regions = findBarcodeRegions(img, {}); } catch (e) { if (opts.onError) opts.onError(e); }
  const perRegion = sweeps.reduce((n, w) => n + w.offs.length, 0);
  const total = jobs.length + (opts.noTiles ? 0 : tileJobs.length) + regions.length * perRegion;
  let done = 0;
  const progress = () => { if (opts.onProgress) opts.onProgress(done, total, hits.size); };

  for (const job of jobs) {
    progress(); await tick();
    try {
      const j = job();
      add(await decode(j.img), p => ({ x: j.ox + p.x / j.s, y: j.oy + p.y / j.s }));
    } catch (e) { if (opts.onError) opts.onError(e); }
    done++;
  }
  for (const r of regions) {
    if (regionCovered(r, boxes)) { done += perRegion; continue; }
    await sweepRegion(img, r, sweeps, decode, list => add(list), () => { done++; progress(); }, opts.onError);
  }
  if (hits.size < 3 && !opts.noTiles) {
    for (const job of tileJobs) {
      progress(); await tick();
      try {
        const j = job();
        add(await decode(j.img), p => ({ x: j.ox + p.x / j.s, y: j.oy + p.y / j.s }));
      } catch (e) { if (opts.onError) opts.onError(e); }
      done++;
    }
  }
  done = total; progress();
  return Array.from(hits.values());
}

/* True when the codes found so far already account for nearly all of a region's stripe blocks. */
export function regionCovered(r, boxes) {
  let covered = 0;
  for (const [px, py] of r.pts) if (boxes.some(b => px >= b[0] && px <= b[2] && py >= b[1] && py <= b[3])) covered++;
  return covered / r.pts.length >= 0.85;
}

/* Rotation + zoom sweep over one region. onFound(list) gets raw decoder results (positions dropped:
   they are in the transformed image). Stops early once the region yields a code. */
export async function sweepRegion(img, r, sweeps, decode, onFound, onStep, onError, stopOnHit = false) {
  let gray, stretch;
  try {
    const sub = crop(img, r.x, r.y, r.w, r.h);
    gray = { g: grayOf(sub), width: sub.width, height: sub.height };
    stretch = grayStretch(gray.g);
  } catch (e) { if (onError) onError(e); return 0; }
  const long = Math.max(gray.width, gray.height);
  let found = 0;
  for (const sw of sweeps) {
    if (long > sw.max) { for (let i = 0; i < sw.offs.length; i++) onStep && onStep(); continue; }
    const scale = Math.max(1, Math.min(sw.s, 2400 / long));
    for (const off of sw.offs) {
      await tick();
      try {
        const list = (await decode(transformGray(gray, (r.orient === 'v' ? 90 : 0) + r.fix + off, scale, stretch))).map(x => ({ format: x.format, text: x.text }));
        if (list.length) { found += list.length; onFound(list); }
      } catch (e) { if (onError) onError(e); }
      if (onStep) onStep();
      if (stopOnHit && found) return found;
    }
  }
  return found;
}
