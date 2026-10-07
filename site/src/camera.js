/* Camera: best available stream, capabilities, guide-box crop, zoom/torch/tap-to-focus, full-res stills. */

/* Ask for 4K and let the browser fall back; then 1080p; then anything. */
export async function openCamera() {
  const tries = [
    { width: { ideal: 3840 }, height: { ideal: 2160 } },
    { width: { ideal: 1920 }, height: { ideal: 1080 } },
    {}
  ];
  let last;
  for (const size of tries) {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: Object.assign({ facingMode: { ideal: 'environment' } }, size) });
      const track = stream.getVideoTracks()[0];
      let caps = {};
      try { caps = track.getCapabilities ? track.getCapabilities() : {}; } catch (e) { caps = {}; }
      return { stream, track, caps };
    } catch (e) {
      last = e;
      if (e && (e.name === 'NotAllowedError' || e.name === 'SecurityError' || e.name === 'NotFoundError')) throw e;
    }
  }
  throw last;
}

export function stopStream(stream) {
  if (stream) stream.getTracks().forEach(t => { try { t.stop(); } catch (e) { /* already stopped */ } });
}

/* The <video> uses object-fit: cover. Returns the mapping source px -> element px. */
export function coverMap(vw, vh, ew, eh) {
  const scale = Math.max(ew / vw, eh / vh);
  return { scale, ox: (vw * scale - ew) / 2, oy: (vh * scale - eh) / 2 };
}

/* Source-pixel rectangle under the on-screen guide box. */
export function guideRect(video, viewport, guide) {
  const vw = video.videoWidth, vh = video.videoHeight;
  const vr = viewport.getBoundingClientRect(), gr = guide.getBoundingClientRect();
  const m = coverMap(vw, vh, vr.width, vr.height);
  const x0 = (gr.left - vr.left + m.ox) / m.scale, y0 = (gr.top - vr.top + m.oy) / m.scale;
  const x1 = (gr.right - vr.left + m.ox) / m.scale, y1 = (gr.bottom - vr.top + m.oy) / m.scale;
  const x = Math.max(0, Math.floor(x0)), y = Math.max(0, Math.floor(y0));
  return { x, y, w: Math.min(vw, Math.ceil(x1)) - x, h: Math.min(vh, Math.ceil(y1)) - y };
}

let grabCanvas = null;
/* Crop the guide area at native resolution, doing as little as possible on the main thread:
   'frame'  -> {frame: VideoFrame, rect}: wraps the current video frame without copying pixels; the worker crops.
   'bitmap' -> ImageBitmap of the crop (Chromium copies the frame here, ~10-50 ms on the main thread).
   else     -> ImageData via a canvas (oldest fallback, slowest). */
export async function grabCrop(video, rect, mode) {
  if (mode === 'frame' && typeof VideoFrame === 'function') {
    try { return { frame: new VideoFrame(video, { timestamp: 0 }), rect }; } catch (e) { /* fall back */ }
  }
  if (mode === 'frame' || mode === 'bitmap') {
    if (typeof createImageBitmap === 'function') {
      try { return await createImageBitmap(video, rect.x, rect.y, rect.w, rect.h); } catch (e) { /* fall back */ }
    }
  }
  if (!grabCanvas) grabCanvas = document.createElement('canvas');
  if (grabCanvas.width !== rect.w || grabCanvas.height !== rect.h) { grabCanvas.width = rect.w; grabCanvas.height = rect.h; }
  const ctx = grabCanvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(video, rect.x, rect.y, rect.w, rect.h, 0, 0, rect.w, rect.h);
  const d = ctx.getImageData(0, 0, rect.w, rect.h);
  return { data: d.data, width: rect.w, height: rect.h };
}

export function zoomRange(caps) {
  return caps && caps.zoom && caps.zoom.max > caps.zoom.min ? { min: caps.zoom.min, max: Math.min(caps.zoom.max, 8), step: caps.zoom.step || 0.1 } : null;
}
export const DEFAULT_ZOOM = 1.75;   // labels are small; start between 1.5x and 2x where the camera allows

export function applyZoom(track, z) {
  return track.applyConstraints({ advanced: [{ zoom: z }] }).catch(() => {});
}
export function setTorch(track, on) {
  return track.applyConstraints({ advanced: [{ torch: on }] }).catch(() => {});
}

export function canTapFocus(caps) {
  return !!(caps && (caps.pointsOfInterest || (caps.focusMode && caps.focusMode.includes('single-shot'))));
}
/* Focus (and expose) at a point given in 0..1 frame coordinates. Returns false when unsupported. */
export async function focusAt(track, caps, nx, ny) {
  if (!canTapFocus(caps)) return false;
  const c = {};
  if (caps.pointsOfInterest) c.pointsOfInterest = [{ x: nx, y: ny }];
  if (caps.focusMode && caps.focusMode.includes('single-shot')) c.focusMode = 'single-shot';
  if (caps.exposureMode && caps.exposureMode.includes('continuous')) c.exposureMode = 'continuous';
  try { await track.applyConstraints({ advanced: [c] }); } catch (e) { return false; }
  if (caps.focusMode && caps.focusMode.includes('continuous'))
    setTimeout(() => track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] }).catch(() => {}), 2500);
  return true;
}
export function continuousFocus(track, caps) {
  if (caps && caps.focusMode && caps.focusMode.includes('continuous'))
    track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] }).catch(() => {});
}

export function hasImageCapture() { return typeof ImageCapture !== 'undefined'; }
/* Full-resolution still from the running stream (Chrome on Android); null when unsupported. */
export async function takeStill(track) {
  if (!hasImageCapture()) return null;
  try { return await new ImageCapture(track).takePhoto(); } catch (e) { return null; }
}
