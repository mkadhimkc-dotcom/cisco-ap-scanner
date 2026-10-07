/* Barcode region finder: stripe-pattern blocks grouped into candidate regions with an estimated tilt. */
import { fitLongSide, grayOf } from './image.js';

/* Finds stripe-pattern blocks (strong gradient along one axis, weak along the other) and groups them.
   Returns [{x,y,w,h,orient:'h'|'v',n,pts:[[cx,cy]...],fix}] in the coordinates of `img`. */
export function findBarcodeRegions(img, opts) {
  opts = opts || {};
  const base = fitLongSide(img, 2600), fb = base.width / img.width;
  const W = base.width, H = base.height, g = grayOf(base);
  const B = Math.max(8, Math.round(Math.max(W, H) / 215));
  const bw = Math.floor(W / B), bh = Math.floor(H / B);
  if (bw < 10 || bh < 4) return [];
  const nb = bw * bh, ex = new Float32Array(nb), ey = new Float32Array(nb);
  const xmax = bw * B, ymax = bh * B;
  for (let y = 1; y < ymax - 1; y++) {
    const row = y * W, brow = ((y / B) | 0) * bw;
    for (let x = 1; x < xmax - 1; x++) {
      const i = row + x, dx = g[i + 1] - g[i - 1], dy = g[i + W] - g[i - W], bi = brow + ((x / B) | 0);
      ex[bi] += dx < 0 ? -dx : dx; ey[bi] += dy < 0 ? -dy : dy;
    }
  }
  const norm = 1 / (B * B);
  for (let i = 0; i < nb; i++) { ex[i] *= norm; ey[i] *= norm; }
  const T = opts.minEnergy || 11, ratio = opts.ratio || 0.5;
  const regions = [];
  for (const orient of ['h', 'v']) {
    const mask = new Uint8Array(nb);
    for (let i = 0; i < nb; i++) {
      mask[i] = orient === 'h' ? (ex[i] > T && ey[i] < ratio * ex[i]) : (ey[i] > T && ex[i] < ratio * ey[i]);
    }
    const dm = new Uint8Array(nb);
    for (let by = 0; by < bh; by++) for (let bx = 0; bx < bw; bx++) {
      if (!mask[by * bw + bx]) continue;
      for (let yy = Math.max(0, by - 1); yy <= Math.min(bh - 1, by + 1); yy++)
        for (let xx = Math.max(0, bx - 1); xx <= Math.min(bw - 1, bx + 1); xx++) dm[yy * bw + xx] = 1;
    }
    const seen = new Uint8Array(nb);
    for (let s0 = 0; s0 < nb; s0++) {
      if (!dm[s0] || seen[s0]) continue;
      const stack = [s0]; seen[s0] = 1;
      let minX = bw, maxX = -1, minY = bh, maxY = -1, n = 0; const pts = [], blocks = [];
      while (stack.length) {
        const cur = stack.pop(), cx = cur % bw, cy = (cur / bw) | 0;
        if (mask[cur]) {
          n++; pts.push([(cx + 0.5) * B / fb, (cy + 0.5) * B / fb]); blocks.push(cx, cy);
          if (cx < minX) minX = cx; if (cx > maxX) maxX = cx; if (cy < minY) minY = cy; if (cy > maxY) maxY = cy;
        }
        if (cx > 0 && dm[cur - 1] && !seen[cur - 1]) { seen[cur - 1] = 1; stack.push(cur - 1); }
        if (cx < bw - 1 && dm[cur + 1] && !seen[cur + 1]) { seen[cur + 1] = 1; stack.push(cur + 1); }
        if (cy > 0 && dm[cur - bw] && !seen[cur - bw]) { seen[cur - bw] = 1; stack.push(cur - bw); }
        if (cy < bh - 1 && dm[cur + bw] && !seen[cur + bw]) { seen[cur + bw] = 1; stack.push(cur + bw); }
      }
      const spanX = maxX - minX + 1, spanY = maxY - minY + 1;
      const major = orient === 'h' ? spanX : spanY, minor = orient === 'h' ? spanY : spanX;
      if (n < (opts.minBlocks || 20) || major < 10 || minor < 2) continue;
      const pad = Math.max(2 * B, 0.1 * Math.max(spanX, spanY) * B);
      const x0 = Math.max(0, (minX * B - pad) / fb), y0 = Math.max(0, (minY * B - pad) / fb);
      const x1 = Math.min(img.width, ((maxX + 1) * B + pad) / fb), y1 = Math.min(img.height, ((maxY + 1) * B + pad) / fb);
      regions.push({ x: x0, y: y0, w: x1 - x0, h: y1 - y0, orient, n, pts, fix: estimateFix(g, W, B, blocks, orient) });
    }
  }
  regions.sort((a, b) => b.n - a.n);
  return regions.slice(0, opts.maxRegions || 6);
}

/* Angle (degrees, transformGray convention, relative to the 0 or 90 base rotation) that makes the bars
   in these blocks upright, from the dominant gradient direction (structure tensor). */
export function estimateFix(g, W, B, blocks, orient) {
  let sxx = 0, syy = 0, sxy = 0;
  for (let k = 0; k < blocks.length; k += 2) {
    const x0 = blocks[k] * B, y0 = blocks[k + 1] * B;
    for (let y = y0; y < y0 + B; y++) for (let x = x0; x < x0 + B; x++) {
      const i = y * W + x, dx = g[i + 1] - g[i - 1], dy = g[i + W] - g[i - W];
      sxx += dx * dx; syy += dy * dy; sxy += dx * dy;
    }
  }
  const th = orient === 'h' ? 0.5 * Math.atan2(2 * sxy, sxx - syy) : 0.5 * Math.atan2(-2 * sxy, syy - sxx);
  const deg = -th * 180 / Math.PI;
  return Math.max(-20, Math.min(20, deg));
}

/* Axis-aligned box around a decoded symbol's corner points, padded for the quiet zone. */
export function posBox(pos) {
  if (!pos || !pos.length) return null;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of pos) { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); }
  const px = (x1 - x0) * 0.08 + 6, py = (y1 - y0) * 0.25 + 6;
  return [x0 - px, y0 - py, x1 + px, y1 + py];
}
