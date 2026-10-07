/* Deskew: rotate + scale a grayscale region in one bicubic pass. */

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
export function transformGray(src, deg, scale, stretch) {
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
