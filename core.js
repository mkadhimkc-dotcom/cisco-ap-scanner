/* Label Scanner core: image passes, label classification, device merging, CSV.
   Plain JS, no DOM. Runs in the page and in Node tests. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Core = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ---------- image helpers (img = {data: Uint8ClampedArray RGBA, width, height}) ---------- */

  function crop(img, x, y, w, h) {
    x = Math.max(0, Math.round(x)); y = Math.max(0, Math.round(y));
    w = Math.min(img.width - x, Math.round(w)); h = Math.min(img.height - y, Math.round(h));
    const out = new Uint8ClampedArray(w * h * 4);
    for (let r = 0; r < h; r++) {
      const s = ((y + r) * img.width + x) * 4;
      out.set(img.data.subarray(s, s + w * 4), r * w * 4);
    }
    return { data: out, width: w, height: h };
  }

  function scaleTo(img, nw, nh) {
    nw = Math.max(1, Math.round(nw)); nh = Math.max(1, Math.round(nh));
    if (nw === img.width && nh === img.height) return img;
    const out = new Uint8ClampedArray(nw * nh * 4);
    const sx = img.width / nw, sy = img.height / nh, src = img.data, W = img.width, H = img.height;
    if (sx > 1 || sy > 1) {
      // downscale: box average (keeps thin bars from vanishing)
      for (let y = 0; y < nh; y++) {
        const y0 = Math.floor(y * sy), y1 = Math.max(y0 + 1, Math.min(H, Math.floor((y + 1) * sy)));
        for (let x = 0; x < nw; x++) {
          const x0 = Math.floor(x * sx), x1 = Math.max(x0 + 1, Math.min(W, Math.floor((x + 1) * sx)));
          let r = 0, g = 0, b = 0, n = 0;
          for (let yy = y0; yy < y1; yy++) {
            let i = (yy * W + x0) * 4;
            for (let xx = x0; xx < x1; xx++, i += 4) { r += src[i]; g += src[i + 1]; b += src[i + 2]; n++; }
          }
          const o = (y * nw + x) * 4;
          out[o] = r / n; out[o + 1] = g / n; out[o + 2] = b / n; out[o + 3] = 255;
        }
      }
    } else {
      // upscale: bilinear
      for (let y = 0; y < nh; y++) {
        const fy = Math.max(0, (y + 0.5) * sy - 0.5), y0 = Math.floor(fy), y1 = Math.min(H - 1, y0 + 1), wy = fy - y0;
        for (let x = 0; x < nw; x++) {
          const fx = Math.max(0, (x + 0.5) * sx - 0.5), x0 = Math.floor(fx), x1 = Math.min(W - 1, x0 + 1), wx = fx - x0;
          const a = (y0 * W + x0) * 4, b = (y0 * W + x1) * 4, c = (y1 * W + x0) * 4, d = (y1 * W + x1) * 4, o = (y * nw + x) * 4;
          for (let k = 0; k < 3; k++) {
            const top = src[a + k] * (1 - wx) + src[b + k] * wx, bot = src[c + k] * (1 - wx) + src[d + k] * wx;
            out[o + k] = top * (1 - wy) + bot * wy;
          }
          out[o + 3] = 255;
        }
      }
    }
    return { data: out, width: nw, height: nh };
  }

  function fitLongSide(img, maxSide) {
    const long = Math.max(img.width, img.height);
    if (long <= maxSide) return img;
    const f = maxSide / long;
    return scaleTo(img, img.width * f, img.height * f);
  }

  function autoContrast(img) {
    const n = img.width * img.height, src = img.data, hist = new Uint32Array(256);
    const gray = new Uint8Array(n);
    for (let i = 0, p = 0; i < n; i++, p += 4) {
      const g = (src[p] * 77 + src[p + 1] * 150 + src[p + 2] * 29) >> 8;
      gray[i] = g; hist[g]++;
    }
    const lo = percentile(hist, n, 0.01), hi = percentile(hist, n, 0.99), span = Math.max(1, hi - lo);
    const out = new Uint8ClampedArray(n * 4);
    for (let i = 0, p = 0; i < n; i++, p += 4) {
      const v = ((gray[i] - lo) * 255) / span;
      out[p] = out[p + 1] = out[p + 2] = v; out[p + 3] = 255;
    }
    return { data: out, width: img.width, height: img.height };
  }
  function percentile(hist, n, q) {
    let acc = 0; const t = n * q;
    for (let i = 0; i < 256; i++) { acc += hist[i]; if (acc >= t) return i; }
    return 255;
  }

  function rotate90(img) {
    const W = img.width, H = img.height, out = new Uint8ClampedArray(W * H * 4);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const s = (y * W + x) * 4, d = (x * H + (H - 1 - y)) * 4;
      out[d] = img.data[s]; out[d + 1] = img.data[s + 1]; out[d + 2] = img.data[s + 2]; out[d + 3] = 255;
    }
    return { data: out, width: H, height: W };
  }

  function tileRects(w, h, cols, rows, overlap) {
    const tw = w / (cols - (cols - 1) * overlap), th = h / (rows - (rows - 1) * overlap), out = [];
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      out.push([c * tw * (1 - overlap), r * th * (1 - overlap), tw, th]);
    }
    return out;
  }

  /* ---------- barcode region finder + deskew transform ---------- */

  function grayOf(img) {
    const n = img.width * img.height, g = new Uint8Array(n), d = img.data;
    for (let i = 0, p = 0; i < n; i++, p += 4) g[i] = (d[p] * 77 + d[p + 1] * 150 + d[p + 2] * 29) >> 8;
    return g;
  }

  function grayStretch(g) {
    const hist = new Uint32Array(256);
    for (let i = 0; i < g.length; i++) hist[g[i]]++;
    const lo = percentile(hist, g.length, 0.01), hi = percentile(hist, g.length, 0.99);
    return { lo, span: Math.max(1, hi - lo) };
  }

  function cubicW(t, w) {   // Catmull-Rom weights for the 4 taps around fractional offset t
    const t2 = t * t, t3 = t2 * t;
    w[0] = -0.5 * t3 + t2 - 0.5 * t;
    w[1] = 1.5 * t3 - 2.5 * t2 + 1;
    w[2] = -1.5 * t3 + 2 * t2 + 0.5 * t;
    w[3] = 0.5 * t3 - 0.5 * t2;
  }

  /* Rotate by deg and scale in one bicubic pass; output is grayscale RGBA, contrast stretched,
     padded with white (a barcode's quiet zone is light). `src` is {g, width, height}.
     Positive deg rotates the picture by (X,Y) -> (cX - sY, sX + cY) in image coordinates (y down). */
  function transformGray(src, deg, scale, stretch) {
    const rad = deg * Math.PI / 180, c = Math.cos(rad), s = Math.sin(rad);
    const W = src.width, H = src.height, g = src.g;
    const ow = Math.max(1, Math.ceil((Math.abs(W * c) + Math.abs(H * s)) * scale));
    const oh = Math.max(1, Math.ceil((Math.abs(W * s) + Math.abs(H * c)) * scale));
    const out = new Uint8ClampedArray(ow * oh * 4);
    const lo = stretch.lo, k = 255 / stretch.span, inv = 1 / scale;
    const cx = W / 2, cy = H / 2, ox = ow / 2, oy = oh / 2;
    const wx = new Float32Array(4), wy = new Float32Array(4);
    for (let y = 0; y < oh; y++) {
      const uy = (y + 0.5 - oy) * inv;
      for (let x = 0; x < ow; x++) {
        const ux = (x + 0.5 - ox) * inv;
        const sx = c * ux + s * uy + cx - 0.5, sy = -s * ux + c * uy + cy - 0.5;
        let v = 255;
        if (sx >= 1 && sy >= 1 && sx < W - 2 && sy < H - 2) {
          const x0 = Math.floor(sx), y0 = Math.floor(sy);
          cubicW(sx - x0, wx); cubicW(sy - y0, wy);
          let acc = 0;
          for (let j = 0; j < 4; j++) {
            const r = (y0 - 1 + j) * W + x0 - 1;
            acc += wy[j] * (wx[0] * g[r] + wx[1] * g[r + 1] + wx[2] * g[r + 2] + wx[3] * g[r + 3]);
          }
          v = (acc - lo) * k;
        }
        const o = (y * ow + x) * 4;
        out[o] = out[o + 1] = out[o + 2] = v; out[o + 3] = 255;
      }
    }
    return { data: out, width: ow, height: oh };
  }

  /* Finds stripe-pattern blocks (strong gradient along one axis, weak along the other) and groups them.
     Returns [{x,y,w,h,orient:'h'|'v',n,pts:[[cx,cy]...]}] in the coordinates of `img`. */
  function findBarcodeRegions(img, opts) {
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
  function estimateFix(g, W, B, blocks, orient) {
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

  function posBox(pos) {
    if (!pos || !pos.length) return null;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of pos) { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); }
    const px = (x1 - x0) * 0.08 + 6, py = (y1 - y0) * 0.25 + 6;
    return [x0 - px, y0 - py, x1 + px, y1 + py];
  }

  /* ---------- scanning ---------- */

  const tick = () => new Promise(r => setTimeout(r, 0));

  /* decode(img) -> Promise<[{format, text, pos?}]> where pos is [{x,y}*4] in img pixels.
     Stage A: whole photo and tiles, unrotated.  Stage B: barcode-like regions that stage A did not
     fully explain get a small rotation sweep with upscaling and contrast stretch.
     Returns [{format, text, count}]. */
  async function scanImage(img, decode, opts) {
    opts = opts || {};
    const quick = !!opts.quick;
    const hits = new Map(), boxes = [];
    const add = (list, map) => {
      for (const r of list || []) {
        const text = String(r.text || '').replace(/\u0000/g, '').trim();
        if (!text) continue;
        const key = r.format + '|' + text;
        const h = hits.get(key);
        if (h) h.count++; else hits.set(key, { format: r.format, text, count: 1 });
        if (map && r.pos) { const b = posBox(r.pos.map(map)); if (b) boxes.push(b); }
      }
    };
    const jobs = [];   // {make: () => img', ox, oy, s}   x_orig = ox + x / s
    const fitJob = (src, ox, oy, maxSide, post) => () => {
      const f = Math.min(1, maxSide / Math.max(src.width, src.height));
      let im = f < 1 ? scaleTo(src, src.width * f, src.height * f) : src, s = f;
      if (post) im = post(im);
      return { img: im, ox, oy, s };
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
    const range = (from, to, step) => { const o = []; for (let v = from; v <= to + 1e-9; v += step) o.push(Math.round(v * 100) / 100); return o; };
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
      // skip a region when the codes found so far already account for nearly all of its stripe blocks
      let covered = 0;
      for (const [px, py] of r.pts) if (boxes.some(b => px >= b[0] && px <= b[2] && py >= b[1] && py <= b[3])) covered++;
      if (covered / r.pts.length >= 0.85) { done += perRegion; continue; }
      let gray, stretch;
      try {
        const sub = crop(img, r.x, r.y, r.w, r.h);
        gray = { g: grayOf(sub), width: sub.width, height: sub.height };
        stretch = grayStretch(gray.g);
      } catch (e) { if (opts.onError) opts.onError(e); done += perRegion; continue; }
      const long = Math.max(gray.width, gray.height);
      for (const sw of sweeps) {
        if (long > sw.max) { done += sw.offs.length; continue; }
        const scale = Math.max(1, Math.min(sw.s, 2400 / long));
        for (const off of sw.offs) {
          progress(); await tick();
          try { add(await decode(transformGray(gray, (r.orient === 'v' ? 90 : 0) + r.fix + off, scale, stretch))); }
          catch (e) { if (opts.onError) opts.onError(e); }
          done++;
        }
      }
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

  function sharpness(img) {
    const s = fitLongSide(img, 640), g = grayOf(s), W = s.width, H = s.height;
    let sum = 0;
    for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
      const i = y * W + x, dx = g[i + 1] - g[i - 1], dy = g[i + W] - g[i - W];
      sum += (dx < 0 ? -dx : dx) + (dy < 0 ? -dy : dy);
    }
    return sum / ((W - 2) * (H - 2));
  }

  /* Video: src = {duration, grab(t) -> Promise<img|null>}. Samples frames, keeps the sharpest, decodes them
     best-first and stops once the result stops changing, isComplete(codes) says so, or time runs out. */
  async function scanVideo(src, decode, opts) {
    opts = opts || {};
    const maxMs = opts.maxMs || 60000, t0 = Date.now();
    const nCand = opts.candidates || 16, keep = opts.keep || 8, d = src.duration;
    const progress = (phase, f, found) => { if (opts.onProgress) opts.onProgress(phase, f, found); };
    const pool = [];
    for (let i = 0; i < nCand; i++) {
      progress('sample', i / nCand, 0); await tick();
      let im = null;
      try { im = await src.grab(d * (0.04 + 0.92 * (nCand === 1 ? 0.5 : i / (nCand - 1)))); } catch (e) { if (opts.onError) opts.onError(e); }
      if (!im) continue;
      pool.push({ score: sharpness(im), img: im });
      pool.sort((a, b) => b.score - a.score);
      if (pool.length > keep) pool.pop();
    }
    const hits = new Map(); let stable = 0, last = '', used = 0;
    for (let k = 0; k < pool.length; k++) {
      if (Date.now() - t0 > maxMs) break;
      progress('read', k / pool.length, hits.size);
      let list = [];
      try { list = await scanImage(pool[k].img, decode, { quick: true, onError: opts.onError }); } catch (e) { if (opts.onError) opts.onError(e); }
      used++;
      for (const c of list) { const key = c.format + '|' + c.text, h = hits.get(key); if (h) h.count += c.count; else hits.set(key, { format: c.format, text: c.text, count: c.count }); }
      const sig = Array.from(hits.keys()).sort().join('\n');
      stable = sig === last ? stable + 1 : 0; last = sig;
      const codes = Array.from(hits.values());
      if (opts.isComplete && codes.length && opts.isComplete(codes)) break;
      if (codes.length && stable >= 3) break;
    }
    progress('read', 1, hits.size);
    return { codes: Array.from(hits.values()), frames: pool.length, used };
  }

  /* ---------- classification ---------- */

  const DEFAULT_ASSET_RE = '^\\d{4,9}$';
  const FIELD_ORDER = ['assetTag', 'mac', 'serial', 'meraki', 'pid', 'partNo', 'clei'];
  const FIELD_LABEL = {
    assetTag: 'Asset tag', mac: 'MAC address', serial: 'Serial number', meraki: 'Meraki serial',
    pid: 'Model (PID)', partNo: 'Part number', clei: 'CLEI'
  };
  const TYPES = ['Switch', 'AP', 'Other'];
  /* fields a label of this type is expected to carry (drives "read X of Y" and which fields show first) */
  const EXPECTED = {
    Switch: ['assetTag', 'mac', 'serial', 'pid', 'partNo', 'clei'],
    AP: ['assetTag', 'mac', 'serial', 'meraki', 'pid'],
    Other: ['assetTag', 'mac', 'serial', 'pid']
  };

  function normalizeMac(s) {
    const hex = String(s).replace(/[^0-9a-fA-F]/g, '').toUpperCase();
    return hex.length === 12 ? hex : '';
  }
  function formatMac(s, style) {
    const hex = normalizeMac(s);
    if (!hex) return String(s || '');
    const pairs = hex.match(/.{2}/g);
    if (style === 'plain') return hex;
    if (style === 'dashes') return pairs.join('-');
    if (style === 'cisco') return [hex.slice(0, 4), hex.slice(4, 8), hex.slice(8)].join('.').toLowerCase();
    return pairs.join(':');
  }

  const SERIAL_RE = /^[A-Z]{3}\d{4}[A-Z0-9]{4}$/;
  const MAC_RE = /^([0-9A-F]{12}|([0-9A-F]{2}[:\-.]){5}[0-9A-F]{2})$/i;
  const PARTNO_RE = /^\d{2,3}-\d{4,6}-\d{2}(\s+[A-Z0-9]{1,3})?$/;
  const PID_RE = /^[A-Z][A-Z0-9]*[-\/][A-Z0-9][A-Z0-9\-\/.]*(\s+V\d{2})?$/;
  const CLEI_RE = /^[A-Z0-9]{10}$/;
  const MERAKI_RE = /^Q[A-Z0-9]{3}-[A-Z0-9]{4}-[A-Z0-9]{4}$/;
  const AP_PID_RE = /^(CW\d{4}|MR\d{2}|AIR-|C91\d\d)/;
  const SWITCH_PID_RE = /^(C9[2-6]\d\d|C1[0-9]{3}|WS-C|MS\d{3}|CBS|SG\d|SF\d|N\dK|IE-)/;

  function detectType(dev) {
    const pid = String(dev.pid || '').toUpperCase();
    if (AP_PID_RE.test(pid)) return 'AP';
    if (SWITCH_PID_RE.test(pid)) return 'Switch';
    if (dev.meraki) return 'AP';
    if (dev.clei && dev.partNo) return 'Switch';
    return 'Other';
  }

  const GS = '\u001d', RS = '\u001e', EOT = '\u0004';
  function unsymbol(t) {
    return String(t).replace(/␝/g, GS).replace(/␞/g, RS).replace(/␄/g, EOT);
  }

  /* ISO/IEC 15434 format 06 payload (Cisco Data Matrix): [)>RS06 GS 11P<CLEI> GS S<serial> RS EOT */
  function parse15434(text) {
    const t = unsymbol(text);
    if (t.indexOf('[)>') !== 0) return null;
    const body = t.replace(/^\[\)>\u001e?\d{0,2}/, '');
    const out = {};
    for (let f of body.split(GS)) {
      f = f.replace(/[\u001e\u0004]/g, '').trim();
      if (!f) continue;
      if (/^11P/.test(f)) out.clei = f.slice(3);
      else if (/^1P/.test(f)) out.pid = f.slice(2);
      else if (/^S/.test(f)) out.serial = f.slice(1);
      else if (/^P/.test(f)) out.pid = f.slice(1);
    }
    return Object.keys(out).length ? out : null;
  }

  /* One decoded code -> list of {field, value} or [] (unrecognized). */
  function classify(code, opts) {
    opts = opts || {};
    const assetRe = new RegExp(opts.assetRe || DEFAULT_ASSET_RE);
    const text = String(code.text).trim();
    const fmt = code.format;
    if (fmt === 'DataMatrix' || fmt === 'QRCode') {
      const p = parse15434(text);
      if (!p) return [];
      const res = [];
      if (p.clei && CLEI_RE.test(p.clei)) res.push({ field: 'clei', value: p.clei });
      if (p.serial && /^[A-Z0-9]{8,14}$/.test(p.serial)) res.push({ field: 'serial', value: p.serial });
      if (p.pid) res.push({ field: 'pid', value: p.pid });
      return res;
    }
    if (fmt !== 'Code128' && fmt !== 'Code39') return [];
    const up = text.toUpperCase();
    const bare = up.replace(/[:\-.]/g, '');
    if (MAC_RE.test(up) && (up !== bare || /[A-F]/.test(bare) || !assetRe.test(up)))
      return [{ field: 'mac', value: normalizeMac(up) }];
    if (MERAKI_RE.test(up)) return [{ field: 'meraki', value: up }];
    if (SERIAL_RE.test(up)) return [{ field: 'serial', value: up }];
    if (PARTNO_RE.test(up)) return [{ field: 'partNo', value: up }];
    if (assetRe.test(text)) return [{ field: 'assetTag', value: text }];
    if (PID_RE.test(up) && /[A-Z]/.test(up) && up.length >= 6) return [{ field: 'pid', value: up }];
    return [];
  }

  /* codes -> device record. Majority value wins per field; conflicts become warnings. */
  function buildDevice(codes, opts) {
    const votes = {}; const other = [];
    for (const c of codes) {
      const hit = classify(c, opts);
      if (!hit.length) { other.push({ format: c.format, text: unsymbol(c.text).replace(/[\u0000-\u001f]/g, '·'), count: c.count }); continue; }
      for (const h of hit) {
        const m = votes[h.field] || (votes[h.field] = new Map());
        m.set(h.value, (m.get(h.value) || 0) + c.count);
      }
    }
    const dev = { assetTag: '', mac: '', serial: '', meraki: '', pid: '', partNo: '', clei: '', type: 'Other', warnings: [], other: other };
    for (const f of FIELD_ORDER) {
      const m = votes[f]; if (!m) continue;
      const ranked = Array.from(m.entries()).sort((a, b) => b[1] - a[1]);
      dev[f] = ranked[0][0];
      if (ranked.length > 1)
        dev.warnings.push(FIELD_LABEL[f] + ': found ' + ranked.map(r => r[0]).join(' and ') + '. Kept ' + ranked[0][0] + '.');
    }
    dev.type = detectType(dev);
    // serial cross-check: Code128 label vs Data Matrix
    const serials = codes.flatMap(c => classify(c, opts).filter(h => h.field === 'serial').map(h => h.value));
    dev.serialAgrees = new Set(serials).size === 1 && serials.length >= 2;
    return dev;
  }

  /* Fill empty fields of an existing row from a new scan; report disagreements. */
  function mergeDevice(row, dev) {
    for (const f of FIELD_ORDER) {
      if (!dev[f]) continue;
      if (!row[f]) row[f] = dev[f];
      else if (row[f] !== dev[f]) row.warnings.push(FIELD_LABEL[f] + ': a new photo read ' + dev[f] + ' (kept ' + row[f] + ').');
    }
    if ((!row.type || row.type === 'Other') && dev.type) row.type = dev.type;
    row.other = (row.other || []).concat(dev.other || []);
    row.warnings = (row.warnings || []).concat((dev.warnings || []));
    row.serialAgrees = row.serialAgrees || dev.serialAgrees;
    row.photos = (row.photos || 1) + 1;
    return row;
  }

  /* ---------- CSV ---------- */

  const TEMPLATES = {
    full: {
      label: 'All fields',
      cols: [['Type', 'type'], ['Asset Tag', 'assetTag'], ['MAC Address', 'mac'], ['Serial Number', 'serial'],
        ['Meraki Serial', 'meraki'], ['Model (PID)', 'pid'], ['Part Number', 'partNo'], ['CLEI', 'clei'],
        ['Note', 'note'], ['Scanned At', 'scannedAt']]
    },
    short: {
      label: 'Asset tag, MAC, serial',
      cols: [['Asset Tag', 'assetTag'], ['MAC Address', 'mac'], ['Serial Number', 'serial']]
    }
  };

  function csvCell(v) {
    let s = v == null ? '' : String(v);
    if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = "'" + s;
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  /* opts: {macStyle, apSerial: 'cisco'|'meraki'} (a bare string is taken as macStyle) */
  function toCsv(rows, templateKey, opts) {
    if (typeof opts === 'string') opts = { macStyle: opts };
    opts = opts || {};
    const t = TEMPLATES[templateKey] || TEMPLATES.full;
    const lines = [t.cols.map(c => csvCell(c[0])).join(',')];
    for (const r of rows) {
      lines.push(t.cols.map(([_, key]) => {
        if (key === 'mac') return csvCell(formatMac(r.mac, opts.macStyle));
        if (key === 'serial' && templateKey === 'short' && opts.apSerial === 'meraki' && r.type === 'AP' && r.meraki) return csvCell(r.meraki);
        return csvCell(r[key]);
      }).join(','));
    }
    return lines.join('\r\n') + '\r\n';
  }

  return {
    crop, scaleTo, fitLongSide, autoContrast, rotate90, tileRects, grayOf, transformGray, findBarcodeRegions, sharpness,
    scanImage, scanVideo, classify, buildDevice, mergeDevice, parse15434, detectType,
    normalizeMac, formatMac, toCsv, csvCell,
    TEMPLATES, FIELD_ORDER, FIELD_LABEL, TYPES, EXPECTED, DEFAULT_ASSET_RE
  };
});
