/* zxing-wasm wrapper. Works in a worker, the page, and Node (pass wasmBinary there).
   Native BarcodeDetector, where present, is only an extra pass; zxing always runs. */
import { prepareZXingModule, readBarcodes, ZXING_WASM_VERSION } from '../vendor/zxing-wasm/reader/index.js';

export const READER_OPTS = {
  formats: ['Code128', 'Code39', 'DataMatrix', 'QRCode'],
  tryHarder: true, tryRotate: true, tryInvert: true, tryDownscale: true, maxNumberOfSymbols: 20
};
export const QUICK_OPTS = Object.assign({}, READER_OPTS, { tryInvert: false });
export { ZXING_WASM_VERSION };

const NATIVE_FORMAT = { code_128: 'Code128', code_39: 'Code39', data_matrix: 'DataMatrix', qr_code: 'QRCode' };

/* -> async decode(img, quick?) => [{format, text, pos: [{x,y}*4] | null}] */
export async function createDecoder({ wasmUrl, wasmBinary, native = true } = {}) {
  const overrides = wasmBinary ? { wasmBinary } : { locateFile: (p, prefix) => /\.wasm$/.test(p) ? wasmUrl : prefix + p };
  await prepareZXingModule({ overrides, fireImmediately: true });
  // warm up so the first real frame does not pay for instantiation
  await readBarcodes({ data: new Uint8ClampedArray(16 * 16 * 4).fill(255), width: 16, height: 16 }, READER_OPTS);
  const zx = async (img, quick) => (await readBarcodes(img, quick ? QUICK_OPTS : READER_OPTS))
    .filter(r => r.isValid !== false && r.text)
    .map(r => {
      const p = r.position;
      return { format: r.format, text: r.text, pos: p ? [p.topLeft, p.topRight, p.bottomRight, p.bottomLeft] : null };
    });
  let bd = null;
  if (native && typeof BarcodeDetector !== 'undefined' && typeof ImageData !== 'undefined') {
    try {
      const have = await BarcodeDetector.getSupportedFormats();
      const want = Object.keys(NATIVE_FORMAT).filter(f => have.includes(f));
      if (want.length) bd = new BarcodeDetector({ formats: want });
    } catch (e) { bd = null; }
  }
  const decode = async (img, quick) => {
    const out = await zx(img, quick);
    if (bd && quick) {
      try {
        const id = img instanceof ImageData ? img : new ImageData(img.data, img.width, img.height);
        for (const r of await bd.detect(id)) {
          const format = NATIVE_FORMAT[r.format];
          if (format && r.rawValue && !out.some(o => o.format === format && o.text === r.rawValue))
            out.push({ format, text: r.rawValue, pos: r.cornerPoints && r.cornerPoints.length === 4 ? r.cornerPoints : null });
        }
      } catch (e) { /* native detector is optional */ }
    }
    return out;
  };
  decode.native = !!bd;
  return decode;
}
