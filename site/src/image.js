/* Image helpers. img = {data: Uint8ClampedArray RGBA, width, height}. No DOM; runs in page, worker and Node. */

export function crop(img, x, y, w, h) {
  x = Math.max(0, Math.round(x)); y = Math.max(0, Math.round(y));
  w = Math.min(img.width - x, Math.round(w)); h = Math.min(img.height - y, Math.round(h));
  const out = new Uint8ClampedArray(w * h * 4);
  for (let r = 0; r < h; r++) {
    const s = ((y + r) * img.width + x) * 4;
    out.set(img.data.subarray(s, s + w * 4), r * w * 4);
  }
  return { data: out, width: w, height: h };
}

export function scaleTo(img, nw, nh) {
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

export function fitLongSide(img, maxSide) {
  const long = Math.max(img.width, img.height);
  if (long <= maxSide) return img;
  const f = maxSide / long;
  return scaleTo(img, img.width * f, img.height * f);
}

export function percentile(hist, n, q) {
  let acc = 0; const t = n * q;
  for (let i = 0; i < 256; i++) { acc += hist[i]; if (acc >= t) return i; }
  return 255;
}

export function autoContrast(img) {
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

export function rotate90(img) {
  const W = img.width, H = img.height, out = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const s = (y * W + x) * 4, d = (x * H + (H - 1 - y)) * 4;
    out[d] = img.data[s]; out[d + 1] = img.data[s + 1]; out[d + 2] = img.data[s + 2]; out[d + 3] = 255;
  }
  return { data: out, width: H, height: W };
}

export function tileRects(w, h, cols, rows, overlap) {
  const tw = w / (cols - (cols - 1) * overlap), th = h / (rows - (rows - 1) * overlap), out = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    out.push([c * tw * (1 - overlap), r * th * (1 - overlap), tw, th]);
  }
  return out;
}

export function grayOf(img) {
  const n = img.width * img.height, g = new Uint8Array(n), d = img.data;
  for (let i = 0, p = 0; i < n; i++, p += 4) g[i] = (d[p] * 77 + d[p + 1] * 150 + d[p + 2] * 29) >> 8;
  return g;
}

export function grayStretch(g) {
  const hist = new Uint32Array(256);
  for (let i = 0; i < g.length; i++) hist[g[i]]++;
  const lo = percentile(hist, g.length, 0.01), hi = percentile(hist, g.length, 0.99);
  return { lo, span: Math.max(1, hi - lo) };
}

/* Mean absolute gradient on a 640 px copy (cheap focus score, higher = sharper). */
export function sharpness(img) {
  const s = fitLongSide(img, 640), g = grayOf(s), W = s.width, H = s.height;
  let sum = 0;
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    const i = y * W + x, dx = g[i + 1] - g[i - 1], dy = g[i + W] - g[i - W];
    sum += (dx < 0 ? -dx : dx) + (dy < 0 ? -dy : dy);
  }
  return sum / ((W - 2) * (H - 2));
}

/* Variance of the 4-neighbour Laplacian on a copy whose long side is at most maxSide.
   Standard focus measure: blur removes high frequencies, so the variance drops. */
export function laplacianVariance(img, maxSide = 800) {
  const s = fitLongSide(img, maxSide), g = grayOf(s), W = s.width, H = s.height;
  let sum = 0, sum2 = 0, n = 0;
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    const i = y * W + x, l = g[i - 1] + g[i + 1] + g[i - W] + g[i + W] - 4 * g[i];
    sum += l; sum2 += l * l; n++;
  }
  if (!n) return 0;
  const m = sum / n;
  return sum2 / n - m * m;
}
