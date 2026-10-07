import { readFileSync } from 'node:fs';
import jpeg from 'jpeg-js';
import { createDecoder } from '../site/src/decoder.js';

export const root = new URL('..', import.meta.url).pathname;
export const fixture = name => root + 'test/fixtures/' + name;

export function loadJpeg(path) {
  const { data, width, height } = jpeg.decode(readFileSync(path), { useTArray: true, maxMemoryUsageInMB: 1024 });
  return { data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.byteLength), width, height };
}

let decoder;
export async function nodeDecoder() {
  if (!decoder) decoder = await createDecoder({ wasmBinary: readFileSync(root + 'site/vendor/zxing-wasm/reader/zxing_reader.wasm'), native: false });
  return decoder;
}

/* Reads a 4:2:0 YUV4MPEG2 file into RGBA frames. */
export function readY4m(path, maxFrames = Infinity) {
  const buf = readFileSync(path);
  const nl = buf.indexOf(10);
  const header = buf.subarray(0, nl).toString();
  const W = Number(/ W(\d+)/.exec(header)[1]), H = Number(/ H(\d+)/.exec(header)[1]);
  const frames = [];
  let p = nl + 1;
  const ySize = W * H, cSize = (W >> 1) * (H >> 1);
  while (p < buf.length && frames.length < maxFrames) {
    p = buf.indexOf(10, p) + 1;   // skip "FRAME...\n"
    const Y = buf.subarray(p, p + ySize), U = buf.subarray(p + ySize, p + ySize + cSize), V = buf.subarray(p + ySize + cSize, p + ySize + 2 * cSize);
    p += ySize + 2 * cSize;
    const data = new Uint8ClampedArray(W * H * 4);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const yy = Y[y * W + x] - 16, ci = (y >> 1) * (W >> 1) + (x >> 1), u = U[ci] - 128, v = V[ci] - 128, o = (y * W + x) * 4;
      data[o] = 1.164 * yy + 1.596 * v; data[o + 1] = 1.164 * yy - 0.392 * u - 0.813 * v; data[o + 2] = 1.164 * yy + 2.017 * u; data[o + 3] = 255;
    }
    frames.push({ data, width: W, height: H });
  }
  return frames;
}
