/* Decode worker: owns zxing-wasm, the live pipeline and the photo pipeline.
   Pixels arrive by transfer and are dropped after decoding; nothing leaves this worker except text. */
import { createDecoder } from './decoder.js';
import { LivePipeline } from './live.js';
import { scanImage } from './scan.js';

let decode = null, live = null, canvas = null;
const offscreen = typeof OffscreenCanvas !== 'undefined';
const videoFrames = offscreen && typeof VideoFrame === 'function';

/* ImageBitmap, or {frame: VideoFrame, rect} (crop done here), -> {data,width,height} via OffscreenCanvas.
   Plain pixel objects pass through. The source is closed as soon as its pixels are read. */
function pixels(source, maxSide) {
  if (!source || source.data) return source;
  const frame = source.frame, rect = source.rect || { x: 0, y: 0, w: source.width, h: source.height };
  const src = frame || source;
  const k = Math.min(1, (maxSide || 1e9) / Math.max(rect.w, rect.h));
  const w = Math.max(1, Math.round(rect.w * k)), h = Math.max(1, Math.round(rect.h * k));
  if (!canvas) canvas = new OffscreenCanvas(w, h);
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  try { ctx.drawImage(src, rect.x, rect.y, rect.w, rect.h, 0, 0, w, h); } finally { if (src.close) src.close(); }
  const d = ctx.getImageData(0, 0, w, h);
  return { data: d.data, width: w, height: h };
}

self.onmessage = async (e) => {
  const m = e.data;
  try {
    if (m.type === 'init') {
      decode = await createDecoder({ wasmUrl: m.wasmUrl });
      live = new LivePipeline(decode);
      self.postMessage({ type: 'ready', offscreen, videoFrames, native: decode.native });
    } else if (m.type === 'reset') {
      if (live) live.reset();
    } else if (m.type === 'frame') {
      const img = pixels(m.image);
      const res = await live.frame(img);
      self.postMessage(Object.assign({ type: 'frame', id: m.id, width: img.width, height: img.height }, res));
    } else if (m.type === 'photo') {
      let img = m.image;
      if (m.blob) img = pixels(await createImageBitmap(m.blob), 3000);
      const codes = await scanImage(img, decode, {
        onProgress: (d, t, n) => self.postMessage({ type: 'progress', id: m.id, done: d, total: t, found: n })
      });
      self.postMessage({ type: 'photo', id: m.id, codes: codes.map(c => ({ format: c.format, text: c.text, count: c.count })) });
    }
  } catch (err) {
    self.postMessage({ type: 'error', id: m.id, message: String(err && err.message || err) });
  }
};
