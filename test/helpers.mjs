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
