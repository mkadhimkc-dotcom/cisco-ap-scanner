/* Main-thread client for the decode worker. Falls back to decoding on the main thread when module
   workers are unavailable (older browsers); the UI then stutters but still works. */
import { LivePipeline } from './live.js';

export class Scanner {
  static async create({ wasmUrl, workerUrl, timeoutMs = 30000 }) {
    if (typeof Worker !== 'undefined') {
      try {
        const w = new Worker(workerUrl, { type: 'module' });
        const ready = await new Promise((resolve, reject) => {
          const t = setTimeout(() => reject(new Error('worker timeout')), timeoutMs);
          w.onmessage = e => { if (e.data.type === 'ready') { clearTimeout(t); resolve(e.data); } else if (e.data.type === 'error') { clearTimeout(t); reject(new Error(e.data.message)); } };
          w.onerror = e => { clearTimeout(t); reject(new Error(e.message || 'worker failed')); };
          w.postMessage({ type: 'init', wasmUrl });
        });
        return new Scanner(w, ready);
      } catch (e) { /* fall through to main thread */ }
    }
    return MainThreadScanner.create(wasmUrl);
  }

  constructor(worker, info) {
    this.worker = worker; this.inWorker = true;
    this.bitmaps = !!info.offscreen;       // worker can take ImageBitmaps directly
    // best way to hand a live frame to the worker: VideoFrame (no main-thread copy) > ImageBitmap > ImageData
    this.grabMode = info.videoFrames ? 'frame' : info.offscreen ? 'bitmap' : 'pixels';
    this.native = !!info.native;
    this.seq = 0; this.pending = new Map();
    worker.onmessage = e => {
      const m = e.data, p = this.pending.get(m.id);
      if (!p) return;
      if (m.type === 'progress') { if (p.onProgress) p.onProgress(m.done, m.total, m.found); return; }
      this.pending.delete(m.id);
      if (m.type === 'error') p.reject(new Error(m.message)); else p.resolve(m);
    };
  }

  _call(msg, transfer, onProgress) {
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, onProgress });
      this.worker.postMessage(Object.assign({ id }, msg), transfer || []);
    });
  }

  /* image: {frame: VideoFrame, rect}, ImageBitmap or {data,width,height}. Transferred, so do not reuse it. */
  frame(image) {
    const transfer = image.data ? [image.data.buffer] : image.frame ? [image.frame] : [image];
    return this._call({ type: 'frame', image }, transfer);
  }

  /* blob (worker decodes it) or {data,width,height} */
  async photo(input, onProgress) {
    const msg = input instanceof Blob ? { type: 'photo', blob: input } : { type: 'photo', image: input };
    const transfer = input instanceof Blob ? [] : [input.data.buffer];
    return (await this._call(msg, transfer, onProgress)).codes;
  }

  reset() { this.worker.postMessage({ type: 'reset' }); }
}

class MainThreadScanner {
  static async create(wasmUrl) {
    const { createDecoder } = await import('./decoder.js');
    const decode = await createDecoder({ wasmUrl });
    return new MainThreadScanner(decode);
  }
  constructor(decode) { this.decode = decode; this.live = new LivePipeline(decode); this.inWorker = false; this.bitmaps = false; this.grabMode = 'pixels'; this.native = !!decode.native; }
  async frame(image) {
    const res = await this.live.frame(image);
    return Object.assign({ width: image.width, height: image.height }, res);
  }
  async photo(input, onProgress) {
    const { scanImage } = await import('./scan.js');
    return (await scanImage(input, this.decode, { onProgress })).map(c => ({ format: c.format, text: c.text, count: c.count }));
  }
  reset() { this.live.reset(); }
}
