/* Label Scanner app: scan files, live camera scan, photo scan, device list, CSV/Excel export. */
import { scanImage } from './src/scan.js';
import { classify, normalizeMac, formatMac, FIELD_ORDER, FIELD_LABEL, TYPES, EXPECTED, DEFAULT_ASSET_RE } from './src/classify.js';
import { buildDevice, mergeDevice, mergeRows, CONF } from './src/device.js';
import { macIssues, serialIssues, serialNote, splitPid, ouiSets, ouiVendor } from './src/validate.js';
import { csvCell } from './src/csv.js';
import { Scanner } from './src/scanner.js';
import * as Cam from './src/camera.js';
import { Xlsx } from './src/xlsx.js';
import { Store } from './src/store.js';
import { COLUMNS, COLUMN_KEYS, BUILTIN, allTemplates, findTemplate, newTemplate, cleanTemplate, buildTable, fileJson, exportFileName } from './src/templates.js';
import { tableToCsv } from './src/csv.js';

const Core = { scanImage, classify, normalizeMac, formatMac, FIELD_ORDER, FIELD_LABEL, TYPES, EXPECTED, DEFAULT_ASSET_RE, buildDevice, mergeDevice, csvCell };

(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var LABEL = Object.assign({ note: 'Note', hwRev: 'Hardware rev' }, Core.FIELD_LABEL);
  var oui = null;   // Cisco/Meraki OUI prefixes, loaded at start (data/oui-cisco.json)
  var store = new Store();
  var APP_VERSION = document.documentElement.dataset.version || '';

  var KIND = {
    AP: { label: 'Access points', one: 'AP' },
    Switch: { label: 'Switches', one: 'Switch' },
    Mixed: { label: 'Different devices', one: 'Device' }
  };
  var ICON = {
    AP: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5a10 10 0 0 1 14 0M8.5 16a5 5 0 0 1 7 0"/><circle cx="12" cy="19" r="1.2" fill="currentColor"/><path d="M2 9a14 14 0 0 1 20 0"/></svg>',
    Switch: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2.5" y="7" width="19" height="10" rx="2"/><path d="M6 11h1M9 11h1M12 11h1M15 11h1M6 14h1M9 14h1M12 14h1M15 14h1"/></svg>',
    Mixed: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="7.5" height="7.5" rx="1.5"/><rect x="13.5" y="3" width="7.5" height="7.5" rx="1.5"/><rect x="3" y="13.5" width="7.5" height="7.5" rx="1.5"/><rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.5"/></svg>'
  };
  var TRASH = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>';
  var CHEV = '<svg class="chev" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>';

  var state = {
    files: [], assetRe: Core.DEFAULT_ASSET_RE, autoSave: false,
    exp: { format: 'csv', template: 'full', macStyle: 'colons', apSerial: 'cisco' },
    templates: [], shareNoted: false
  };
  var busy = false, targetId = null, scanner = null, route = { view: 'home' }, entryLevel = null, listFilter = 'all';

  /* ---------- storage (IndexedDB via src/store.js) ---------- */
  async function load() {
    var s = await store.load();
    if (s && typeof s === 'object') {
      if (Array.isArray(s.files)) state.files = s.files;
      if (typeof s.assetRe === 'string') state.assetRe = s.assetRe;
      if (typeof s.autoSave === 'boolean') state.autoSave = s.autoSave;
      if (typeof s.zoom === 'number') state.zoom = s.zoom;
      if (s.exp && typeof s.exp === 'object') Object.assign(state.exp, s.exp);
      if (Array.isArray(s.templates)) state.templates = s.templates.map(cleanTemplate);
      state.shareNoted = !!s.shareNoted;
      if (state.exp.preset) { state.exp.template = state.exp.preset === 'short' ? 'short' : 'full'; delete state.exp.preset; delete state.exp.custom; }
    }
    // files from before Location/Rack existed kept their place in `site`
    var migrated = false;
    state.files.forEach(function (f) {
      if (f.location == null) { f.location = f.site || ''; delete f.site; migrated = true; }
      if (f.rack == null) { f.rack = ''; migrated = true; }
    });
    if (migrated) save();
  }
  var persisted = false;
  function save() {
    invalidateDups();
    store.save(function () { return state; });
    if (!persisted) { persisted = true; store.persist(); }
  }

  /* ---------- helpers ---------- */
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function ymd(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function stamp(d) { return ymd(d) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()); }
  function niceDate(s) {
    var d = new Date(String(s).replace(' ', 'T'));
    if (isNaN(d)) return s || '';
    var today = ymd(new Date()) === ymd(d);
    return today ? 'Today ' + pad(d.getHours()) + ':' + pad(d.getMinutes()) : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  }
  function setStatus(msg, kind) { var s = $('status'); s.hidden = !msg; s.textContent = msg || ''; s.dataset.kind = kind || ''; }
  function setPill(text, kind) { var p = $('decoderPill'); p.textContent = text; p.dataset.kind = kind || ''; }
  function plural(n, w) { return n + ' ' + w + (n === 1 ? '' : 's'); }
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function nextFrame() { return new Promise(function (r) { requestAnimationFrame(function () { r(); }); }); }
  function expectedFor(type) { return Core.EXPECTED[type] || Core.EXPECTED.Other; }
  function cur() { return route.id ? state.files.find(function (f) { return f.id === route.id; }) : null; }
  /* device number = position in its own file, so every file starts at #1 */
  function num(f, row) { return f.rows.indexOf(row) + 1; }
  function findRow(f, id) { return f && f.rows.find(function (r) { return r.id === id; }); }
  function missingOf(row) { return expectedFor(row.type).filter(function (f) { return !row[f]; }); }
  function counts(f) {
    var done = f.rows.filter(function (r) { return !missingOf(r).length; }).length;
    return { total: f.rows.length, done: done, miss: f.rows.length - done, dup: f.rows.filter(function (r) { return dupsOf(f, r).length; }).length };
  }

  /* ---------- duplicates (within one file; each file is its own data set) ---------- */
  var DUP_FIELDS = ['assetTag', 'mac', 'serial', 'meraki'];
  function dupKey(k, v) {
    v = String(v == null ? '' : v).trim();
    if (!v) return '';
    return k + '|' + (k === 'mac' ? (Core.normalizeMac(v) || v.toUpperCase()) : v.toUpperCase());
  }
  var dupCache = {};
  function dupIndex(f) {
    if (dupCache[f.id]) return dupCache[f.id];
    var idx = {};
    f.rows.forEach(function (r) {
      DUP_FIELDS.forEach(function (k) { var key = dupKey(k, r[k]); if (key) (idx[key] = idx[key] || []).push({ f: f, r: r }); });
    });
    return (dupCache[f.id] = idx);
  }
  function invalidateDups() { dupCache = {}; }
  function where(f, o) { return '#' + num(f, o.r); }
  /* -> [{k, where: ['#3', '"Other file" #2']}] for each field of row that another device also has */
  function dupsOf(f, row, values) {
    var idx = dupIndex(f), out = [];
    DUP_FIELDS.forEach(function (k) {
      var key = dupKey(k, (values || row)[k]); if (!key) return;
      var others = (idx[key] || []).filter(function (o) { return o.r !== row; });
      if (others.length) out.push({ k: k, where: others.map(function (o) { return where(f, o); }) });
    });
    return out;
  }
  function dupText(d) { return d.map(function (x) { return Core.FIELD_LABEL[x.k] + ' = ' + x.where.join(', '); }).join('; '); }

  /* ---------- files ---------- */
  function newFile(name, location, rack, kind) {
    var now = stamp(new Date());
    var f = { id: 'f' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), name: name, location: location || '', rack: rack || '', kind: KIND[kind] ? kind : 'Mixed', created: now, updated: now, rows: [], seq: 0 };
    state.files.push(f);
    return f;
  }
  function touch(f) { f.updated = stamp(new Date()); }

  /* ---------- decoder ---------- */
  async function initScanner() {
    try {
      scanner = await Scanner.create({
        wasmUrl: new URL('vendor/zxing-wasm/reader/zxing_reader.wasm', document.baseURI).href,
        workerUrl: new URL('src/worker.js', document.baseURI).href
      });
      setPill('Ready', 'ok');
    } catch (e) {
      scanner = null;
      setPill('Scanner offline', 'bad');
      setStatus('The barcode decoder could not load (' + (e && e.message || 'unknown error') + '). You can still add devices by hand.', 'bad');
    }
    setBusy(busy);
  }

  /* ---------- rows ---------- */
  function newRow(f, dev) {
    f.seq += 1;
    return {
      id: 'd' + Date.now().toString(36) + f.seq, type: dev.type || 'Other',
      assetTag: dev.assetTag || '', mac: dev.mac || '', serial: dev.serial || '', meraki: dev.meraki || '', pid: dev.pid || '', partNo: dev.partNo || '', clei: dev.clei || '',
      hwRev: dev.hwRev || '', note: '', scannedAt: stamp(new Date()), warnings: dev.warnings || [], other: dev.other || [],
      serialAgrees: !!dev.serialAgrees, serialMismatch: dev.serialMismatch || null, conf: Object.assign({}, dev.conf || {})
    };
  }
  /* A saved device in file f with the same serial, Meraki serial or MAC as dev (not counting `except`). */
  function findMatch(f, dev, except) {
    return f.rows.find(function (r) {
      return r !== except && ['serial', 'meraki', 'mac'].some(function (k) { var a = dupKey(k, dev[k]); return a && a === dupKey(k, r[k]); });
    }) || null;
  }
  /* New scan that matches a saved device: ask whether to open (merge into) it or add a second device.
     Resolves to the row id to merge into, null for a new device, or false to drop the scan. */
  async function resolveRepeat(f, dev) {
    var m = findMatch(f, dev); if (!m) return null;
    var same = ['serial', 'meraki', 'mac'].filter(function (k) { var a = dupKey(k, dev[k]); return a && a === dupKey(k, m[k]); })
      .map(function (k) { return LABEL[k] + ' ' + (k === 'mac' ? Core.formatMac(m[k], 'colons') : m[k]); });
    var choice = await ask({
      title: 'Already in this file as #' + num(f, m),
      text: 'Same ' + same.join(' and ') + '. Open the existing device and add anything new to it, or add this as a separate device?',
      buttons: [{ label: 'Add as new', value: 'new' }, { label: 'Open existing', value: 'open', primary: true }]
    });
    return choice === 'open' ? m.id : choice === 'new' ? null : false;
  }
  /* codes -> new device in file f, or merged into the device with id tid. A scan that repeats a saved
     device asks first (Open existing / Add as new). Returns the row, or null when nothing was kept. */
  async function ingest(f, codes, tid) {
    var dev = Core.buildDevice(codes, { assetRe: state.assetRe });
    var got = Core.FIELD_ORDER.filter(function (k) { return dev[k]; }).length;
    if (!got && !dev.other.length) return null;
    if (f.kind !== 'Mixed') dev.type = f.kind;
    if (!tid) { var r = await resolveRepeat(f, dev); if (r === false) return null; tid = r; }
    var row = tid && findRow(f, tid);
    if (row) Core.mergeDevice(row, dev);
    else { row = newRow(f, dev); f.rows.push(row); }
    touch(f);
    return row;
  }
  function summary(f, row) {
    var exp = expectedFor(row.type), missing = missingOf(row).map(function (k) { return Core.FIELD_LABEL[k]; });
    return { text: row.type + ' #' + num(f, row) + ': ' + (exp.length - missing.length) + ' of ' + exp.length + ' fields' + (missing.length ? '. Missing: ' + missing.join(', ') + '.' : '.'), kind: missing.length ? 'warn' : '' };
  }

  /* ---------- live camera ---------- */
  /* justSaved: identifying values (asset tag, MAC, serials) of the device just saved. After Save every box is
     blank and nothing is read until a code identifying a different device appears; from then on the new device
     fills in from scratch, and codes carrying the saved device's values are still ignored until the next save,
     so the label still in view is neither read as a duplicate of itself nor leaks into the next device. */
  var live = { stream: null, track: null, caps: {}, running: false, codes: new Map(), target: null, frames: 0, justSaved: null,
    boxes: [], reading: false, steady: true, focusNoted: false };

  /* mode 'asset': single-code mode for the County asset-tag sticker; returns to the file once it is read twice */
  async function startLive(tid, mode) {
    var f = cur();
    if (!f || live.running || !scanner) return;
    live.mode = mode || 'device';
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setStatus('This browser cannot open the camera here. Open the app from its https:// address in Safari, or use Take photo.', 'bad');
      return;
    }
    live.target = tid || null; live.codes = new Map(); live.frames = 0; live.justSaved = null; live.boxes = []; live.steady = true;
    scanner.reset();
    $('liveTitle').textContent = live.mode === 'asset' ? 'Asset tag for #' + num(f, findRow(f, live.target)) : live.target ? 'Adding to device #' + num(f, findRow(f, live.target)) : 'Live scan';
    $('livePanel').classList.toggle('asset-mode', live.mode === 'asset');
    $('scanPanel').hidden = true; $('livePanel').hidden = false; $('bottomBar').hidden = true;
    $('liveMsg').textContent = 'Starting camera…'; setStatus('');
    renderLive();
    $('livePanel').scrollIntoView({ block: 'start', behavior: 'smooth' });
    var cam;
    try { cam = await Cam.openCamera(); } catch (e) {
      closeLivePanel();
      var n = e && e.name;
      setStatus(n === 'NotAllowedError' ? 'Camera access was blocked. Allow the camera for this site in Settings, Safari, Camera, then try again.' :
        n === 'NotFoundError' ? 'No camera found on this device.' : 'Could not open the camera (' + (e && e.message || n || 'error') + ').', 'bad');
      return;
    }
    if (route.view !== 'file' || $('livePanel').hidden) { Cam.stopStream(cam.stream); closeLivePanel(); return; }
    live.stream = cam.stream; live.track = cam.track; live.caps = cam.caps || {};
    var v = $('video');
    v.srcObject = live.stream;
    try { await v.play(); } catch (e) {}
    fitViewport();
    setupCamControls();
    live.running = true;
    liveLoop();
  }

  /* Preview takes the stream's own shape (portrait on a phone held upright, landscape otherwise), so the
     guide box covers what the camera actually sees. Tall portrait streams are capped by max-height. */
  function fitViewport() {
    var v = $('video');
    if (v.videoWidth && v.videoHeight) $('viewport').style.aspectRatio = v.videoWidth + ' / ' + v.videoHeight;
  }

  function setupCamControls() {
    var caps = live.caps, z = $('zoom'), zr = Cam.zoomRange(caps);
    Cam.continuousFocus(live.track, caps);
    $('btnTorch').hidden = !caps.torch; $('btnTorch').dataset.on = ''; $('btnTorch').textContent = 'Light';
    if (zr) {
      var start = Math.min(zr.max, Math.max(zr.min, state.zoom || Cam.DEFAULT_ZOOM));
      z.disabled = false; z.min = zr.min; z.max = zr.max; z.step = zr.step; z.value = start;
      Cam.applyZoom(live.track, start);
    } else { z.disabled = true; z.min = 1; z.max = 1; z.value = 1; }
    $('zoomVal').textContent = zr ? Number(z.value).toFixed(1) + '×' : 'n/a';
    $('zoomNote').hidden = !!zr;
    var still = Cam.hasImageCapture();
    $('btnStill').textContent = still ? 'Full-res still' : 'Take photo';
    $('stillHint').textContent = still ? 'Full-res still takes one sharp picture with the camera that is already open, for the tiny PID and Meraki barcodes.'
      : 'This browser cannot take a full-resolution still from the live view (iPhone Safari cannot). Take photo opens the camera app instead: one 12 MP shot that reads the tiny barcodes better. Its codes are added to the device you are scanning.';
  }

  async function liveLoop() {
    var v = $('video');
    while (live.running) {
      if (v.readyState < 2 || !v.videoWidth) { await sleep(100); continue; }
      var rect = Cam.guideRect(v, $('viewport'), $('guide'));
      if (rect.w < 16 || rect.h < 16) { await sleep(100); continue; }
      setReading(true);
      var res = null;
      try { res = await scanner.frame(await Cam.grabCrop(v, rect, scanner.grabMode)); } catch (e) { res = null; }
      if (!live.running) break;
      live.frames++;
      if (res) {
        live.steady = res.steady;
        var kx = rect.w / res.width, ky = rect.h / res.height, now = performance.now();
        res.codes.forEach(function (c) {
          if (c.pos) live.boxes.push({ t: now, pts: c.pos.map(function (p) { return { x: rect.x + p.x * kx, y: rect.y + p.y * ky }; }) });
        });
        addLiveCodes(res.codes);
      }
      setReading(false);
      renderLive(); drawOverlay();
      // no queue: the next frame is grabbed only after this one is done
      await nextFrame();
    }
  }

  /* One read per code per frame (or per still), so a field's vote count is the number of frames that read it. */
  function addLiveCodes(list) {
    var fresh = false, js = live.justSaved;
    if (live.mode === 'asset') list = list.filter(function (c) { return classifyCode(c).some(function (h) { return h.field === 'assetTag'; }); });
    if (js) {
      var cls = list.map(function (c) { return { c: c, hits: classifyCode(c) }; });
      if (!js.started) js.started = cls.some(function (x) { return x.hits.some(function (h) { return DUP_FIELDS.indexOf(h.field) >= 0 && !js.vals.has(dupKey(h.field, h.value)); }); });
      list = !js.started ? [] : cls.filter(function (x) {
        return !x.hits.some(function (h) { return DUP_FIELDS.indexOf(h.field) >= 0 && js.vals.has(dupKey(h.field, h.value)); });
      }).map(function (x) { return x.c; });
    }
    var seen = {};
    list.forEach(function (c) {
      var key = c.format + '|' + c.text; if (seen[key]) return; seen[key] = 1;
      var h = live.codes.get(key);
      if (h) h.count += 1; else { live.codes.set(key, { format: c.format, text: c.text, count: 1 }); fresh = true; }
    });
    if (fresh) flash();
    if (live.mode === 'asset') finishAssetTag();
    else maybeAutoSave();
  }
  /* Auto-save (Settings, off by default): once every expected field for the detected type is confirmed, save
     and clear for the next device. The asset tag is not required: it is usually a separate sticker. */
  function maybeAutoSave() {
    if (!state.autoSave || live.target || live.saving || (live.justSaved && !live.justSaved.started)) return;
    var f = cur(); if (!f) return;
    var dev = liveDevice(), type = f.kind !== 'Mixed' ? f.kind : dev.type;
    var need = expectedFor(type).filter(function (k) { return k !== 'assetTag'; });
    if (type === 'Other' || !need.every(function (k) { return confirmedField(dev, k); })) return;
    live.saving = true;
    flash(); try { if (navigator.vibrate) navigator.vibrate([40, 50, 40]); } catch (e) {}
    saveLiveDevice().finally(function () { live.saving = false; });
  }
  function finishAssetTag() {
    var f = cur(), row = f && findRow(f, live.target), dev = liveDevice();
    if (!row || !dev.assetTag || (dev.votes.assetTag || 0) < 2) return;
    row.assetTag = dev.assetTag; row.conf = row.conf || {}; row.conf.assetTag = CONF.confirmed;
    touch(f); save();
    var n = num(f, row);
    stopLive(); renderFile();
    setStatus('Asset tag ' + row.assetTag + ' added to #' + n + '.');
    try { if (navigator.vibrate) navigator.vibrate([30, 60, 30]); } catch (e) {}
  }

  function setReading(on) {
    live.reading = on;
    var el = $('liveState');
    el.textContent = on ? 'Reading…' : live.steady ? 'Ready' : 'Hold steady';
    el.dataset.kind = on ? 'busy' : live.steady ? 'ok' : 'warn';
  }

  /* Green boxes over each barcode as it is read; they fade after a second so the user sees what is left. */
  function drawOverlay() {
    var c = $('overlay'), vp = $('viewport'), v = $('video');
    var r = vp.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
    var w = Math.round(r.width * dpr), h = Math.round(r.height * dpr);
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
    var ctx = c.getContext('2d'); ctx.clearRect(0, 0, w, h);
    if (!v.videoWidth) return;
    var m = Cam.coverMap(v.videoWidth, v.videoHeight, r.width, r.height), now = performance.now();
    live.boxes = live.boxes.filter(function (b) { return now - b.t < 1200; });
    ctx.lineWidth = 3 * dpr; ctx.lineJoin = 'round';
    live.boxes.forEach(function (b) {
      ctx.strokeStyle = 'rgba(34,197,94,' + (1 - (now - b.t) / 1400).toFixed(2) + ')';
      ctx.beginPath();
      b.pts.forEach(function (p, i) { var x = (p.x * m.scale - m.ox) * dpr, y = (p.y * m.scale - m.oy) * dpr; if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); });
      ctx.closePath(); ctx.stroke();
    });
  }

  async function tapFocus(e) {
    if (!live.running || !live.track || e.target.closest('button')) return;
    var v = $('video'), r = $('viewport').getBoundingClientRect();
    var m = Cam.coverMap(v.videoWidth, v.videoHeight, r.width, r.height);
    var sx = (e.clientX - r.left + m.ox) / m.scale, sy = (e.clientY - r.top + m.oy) / m.scale;
    var ring = $('focusRing');
    ring.style.left = (e.clientX - r.left) + 'px'; ring.style.top = (e.clientY - r.top) + 'px';
    ring.classList.remove('on'); void ring.offsetWidth; ring.classList.add('on');
    var ok = await Cam.focusAt(live.track, live.caps, Math.min(1, Math.max(0, sx / v.videoWidth)), Math.min(1, Math.max(0, sy / v.videoHeight)));
    if (!ok && !live.focusNoted) { live.focusNoted = true; setStatus('Tap to focus is not available in this browser. Move the phone back a little and it refocuses on its own.', 'warn'); }
  }

  async function captureStill() {
    if (!live.running) return;
    if (!Cam.hasImageCapture()) { targetId = 'live'; $('inCam').click(); return; }
    setReading(true);
    var blob = await Cam.takeStill(live.track);
    if (!blob) { setReading(false); targetId = 'live'; $('inCam').click(); return; }
    try { addLiveCodes(await scanner.photo(blob)); } catch (e) { setStatus('Could not read that still (' + (e && e.message || 'error') + ').', 'warn'); }
    setReading(false); renderLive();
  }

  function classifyCode(c) { try { return Core.classify(c, { assetRe: state.assetRe }) || []; } catch (e) { return []; } }

  function flash() {
    var el = $('flash'); el.classList.add('on');
    setTimeout(function () { el.classList.remove('on'); }, 120);
    try { if (navigator.vibrate) navigator.vibrate(30); } catch (e) {}
  }

  function liveDevice() { return Core.buildDevice(Array.from(live.codes.values()), { assetRe: state.assetRe }); }
  /* confirmed = two or more agreeing reads, or the serial cross-checked against the Data Matrix */
  function confirmedField(dev, k) { return !!dev[k] && ((dev.votes[k] || 0) >= 2 || (k === 'serial' && dev.serialAgrees)); }

  function renderLive() {
    var f = cur(); if (!f) return;
    var dev = liveDevice();
    var row = live.target && findRow(f, live.target);
    var type = f.kind !== 'Mixed' ? f.kind : (row && row.type !== 'Other' ? row.type : dev.type);
    var exp = live.mode === 'asset' ? ['assetTag'] : expectedFor(type);
    var shown = live.mode === 'asset' ? exp : exp.concat(Core.FIELD_ORDER.filter(function (k) { return exp.indexOf(k) < 0 && dev[k]; }));
    var got = Core.FIELD_ORDER.filter(function (k) { return dev[k]; }).length;
    $('liveType').textContent = got || f.kind !== 'Mixed' ? type : 'Looking…';
    $('liveType').className = 'badge ' + (type === 'Switch' ? 'Switch' : type === 'AP' ? 'AP' : 'Mixed');
    var ldups = dupsOf(f, row || {}, dev), dupBy = {};
    ldups.forEach(function (d) { dupBy[d.k] = d.where; });
    $('found').innerHTML = shown.map(function (k) {
      var val = dev[k] || (row && row[k] ? row[k] + ' (already saved)' : '');
      var conf = confirmedField(dev, k);
      var cls = dev[k] ? (dupBy[k] ? 'got dup' : conf ? 'got' : 'single') : 'miss';
      return '<li class="' + cls + '" data-field="' + k + '"><span class="k">' + esc(Core.FIELD_LABEL[k]) + '</span><span class="v">' + esc(val || 'not yet') +
        (dev[k] && !conf && !dupBy[k] ? '<em class="once">Read once, confirming…</em>' : '') +
        (dev[k] && dupBy[k] ? '<em>Already scanned: ' + esc(dupBy[k].join(', ')) + '</em>' : '') + '</span></li>';
    }).join('');
    var missing = exp.filter(function (k) { return !dev[k] && !(row && row[k]); }).length;
    $('liveMsg').classList.toggle('dup', ldups.length > 0 && live.running);
    $('liveMsg').textContent = !live.running ? 'Starting camera…' :
      live.mode === 'asset' ? (dev.assetTag ? 'Read ' + dev.assetTag + ' once. Hold steady to confirm…' : 'Point at the County asset tag sticker.') :
      ldups.length ? 'Duplicate: this device looks already scanned (' + ldups[0].where.join(', ') + '). Check before saving.' :
      live.justSaved && !live.justSaved.started ? 'Saved as #' + live.justSaved.n + '. Point at the next device.' :
      !live.steady ? 'Hold steady…' :
      !live.codes.size ? (live.frames > 6 ? 'No barcodes yet. Move closer and hold steady.' : 'Looking for barcodes…') :
      missing ? 'Reading… ' + plural(missing, 'field') + ' to go. Move slowly along the label.' : 'All expected fields read. Tap Save device.';
    var waiting = (live.justSaved && !live.justSaved.started) || live.mode === 'asset';
    $('btnSaveDev').disabled = !got || waiting;
    $('btnSaveDev').textContent = got && !waiting ? 'Save (' + got + ')' : 'Save device';
  }

  async function saveLiveDevice() {
    var f = cur(), codes = Array.from(live.codes.values());
    if (!f || !codes.length) return;
    var tid = live.target;
    var row = await ingest(f, codes, tid);
    save(); renderFile();
    if (row) {
      var s = summary(f, row), d = dupsOf(f, row);
      if (d.length) setStatus('Saved, but this is a duplicate: ' + dupText(d) + '.', 'bad');
      else setStatus('Saved. ' + s.text + (tid ? '' : ' Point at the next device.'), s.kind);
    }
    live.justSaved = row && !tid ? {
      n: num(f, row), started: false,
      vals: new Set(DUP_FIELDS.map(function (k) { return dupKey(k, row[k]); }).filter(Boolean))
    } : null;
    live.codes = new Map(); live.frames = 0; live.boxes = [];
    scanner.reset();
    if (tid) stopLive(); else renderLive();
  }

  function stopLive() {
    live.running = false;
    Cam.stopStream(live.stream);
    live.stream = null; live.track = null;
    var v = $('video'); try { v.pause(); } catch (e) {} v.srcObject = null;
    closeLivePanel();
  }
  function closeLivePanel() {
    $('livePanel').hidden = true; $('scanPanel').hidden = false; live.target = null;
    if (route.view === 'file') $('bottomBar').hidden = false;
  }

  /* ---------- photos ---------- */
  async function fileToImg(file) {
    var url = URL.createObjectURL(file);
    try {
      var im = new Image(); im.decoding = 'async'; im.src = url; await im.decode();
      var w = im.naturalWidth, h = im.naturalHeight, k = Math.min(1, 3000 / Math.max(w, h));
      var cw = Math.max(1, Math.round(w * k)), ch = Math.max(1, Math.round(h * k));
      var c = document.createElement('canvas'); c.width = cw; c.height = ch;
      var ctx = c.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(im, 0, 0, cw, ch);
      var d = ctx.getImageData(0, 0, cw, ch);
      c.width = 0; c.height = 0; im.removeAttribute('src');
      return { data: d.data, width: cw, height: ch };
    } finally { URL.revokeObjectURL(url); }
  }
  /* Photo -> codes, decoded in the worker (from the file itself when it can, else from pixels made here). */
  async function photoCodes(file, onProgress) {
    if (scanner.inWorker && scanner.bitmaps) return scanner.photo(file, onProgress);
    return scanner.photo(await fileToImg(file), onProgress);
  }
  async function addPhotoToLive(file) {
    targetId = null;
    if (!file) return;
    setReading(true); $('liveMsg').textContent = 'Reading the photo…';
    try { addLiveCodes(await photoCodes(file)); } catch (e) { setStatus('Could not read that photo.', 'warn'); }
    setReading(false); renderLive();
  }
  function showProgress(text, frac) { $('progress').hidden = false; $('progressText').textContent = text; $('progressBar').style.width = Math.round(Math.max(0, Math.min(1, frac)) * 100) + '%'; }
  function hideProgress() { $('progress').hidden = true; $('progressBar').style.width = '0'; }
  function setBusy(b) {
    busy = b;
    var off = b || !scanner;
    ['btnLive', 'btnCam', 'btnLib'].forEach(function (id) { $(id).disabled = off; });
    document.querySelectorAll('[data-act="live"],[data-act="photo"]').forEach(function (x) { x.disabled = off; });
  }

  async function handleFiles(files, tid) {
    var f = cur();
    if (!f || !files || !files.length || !scanner || busy) return;
    if (tid === 'live') return addPhotoToLive(files[0]);
    setBusy(true); setStatus('');
    var lastRow = null, added = 0, empty = 0, failed = 0;
    for (var i = 0; i < files.length; i++) {
      var label = 'Photo' + (files.length > 1 ? ' ' + (i + 1) + ' of ' + files.length : '');
      try {
        showProgress(label + ': opening…', 0); await nextFrame();
        var codes = await photoCodes(files[i], function (d, t, n) { showProgress(label + ': reading · ' + plural(n, 'code') + ' found', d / t); });
        var row = await ingest(f, codes, tid);
        if (!row) { empty++; continue; }
        if (!tid) added++;
        lastRow = row;
      } catch (e) { failed++; }
    }
    hideProgress(); save(); renderFile();
    if (lastRow) {
      var s = summary(f, lastRow);
      setStatus((added > 1 ? plural(added, 'device') + ' added. Last: ' : '') + s.text + (s.kind ? ' Scan again from a bit closer, or type it in.' : ''), s.kind);
      var el = document.querySelector('li[data-row="' + lastRow.id + '"]'); if (el) el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    } else if (failed) setStatus('Could not open that photo. Try again, or pick a JPEG.', 'bad');
    else if (empty) setStatus('No barcodes found. Move closer, keep the labels flat to the camera, and avoid glare.', 'warn');
    setBusy(false); targetId = null;
  }

  /* ---------- routing ---------- */
  function parseHash() {
    var m = /^#\/f\/([^\/]+)(\/export)?$/.exec(location.hash);
    if (!m) return { view: 'home' };
    return { view: m[2] ? 'export' : 'file', id: decodeURIComponent(m[1]) };
  }
  function level(r) { return r.view === 'home' ? 0 : r.view === 'file' ? 1 : 2; }
  function go(hash) { location.hash = hash; }
  function goBack() {
    var parent = route.view === 'export' ? '#/f/' + encodeURIComponent(route.id) : '#/';
    if (level(route) > entryLevel) history.back(); else location.replace(parent);
  }
  function onRoute() {
    var r = parseHash();
    if (r.id && !state.files.some(function (f) { return f.id === r.id; })) { location.replace('#/'); return; }
    if (entryLevel === null || level(r) < entryLevel) entryLevel = level(r);
    if (live.running && r.view !== 'file') stopLive();
    var changed = r.view !== route.view || r.id !== route.id;
    route = r;
    if (changed) setStatus('');
    $('viewHome').hidden = r.view !== 'home';
    $('viewFile').hidden = r.view !== 'file';
    $('viewExport').hidden = r.view !== 'export';
    $('btnNew').hidden = r.view !== 'home';
    $('btnBack').hidden = r.view === 'home';
    document.querySelector('.appbar .logo').hidden = r.view !== 'home';
    $('bottomBar').hidden = r.view !== 'file' || live.running;
    var f = cur();
    $('title').textContent = r.view === 'home' ? 'Label Scanner' : r.view === 'export' ? 'Export · ' + f.name : f.name;
    document.title = r.view === 'home' ? 'Label Scanner' : f.name + ' · Label Scanner';
    if (r.view === 'home') renderHome();
    if (r.view === 'file') { listFilter = 'all'; renderFile(); $('fName').value = f.name; $('fLocation').value = f.location; $('fRack').value = f.rack; }
    if (r.view === 'export') openExport();
    if (changed) window.scrollTo(0, 0);
  }

  /* ---------- rendering: home ---------- */
  function renderHome() {
    var list = state.files.slice().sort(function (a, b) { return a.updated < b.updated ? 1 : a.updated > b.updated ? -1 : 0; });
    $('homeEmpty').hidden = list.length > 0;
    $('homeCount').textContent = list.length ? plural(list.length, 'file') : '';
    $('btnDelAll').hidden = !list.length;
    $('files').innerHTML = list.map(function (f) {
      var c = counts(f);
      var sub = KIND[f.kind].label + (f.location ? ' · ' + f.location : '') + (f.rack ? ' · ' + f.rack : '') + ' · ' + niceDate(f.updated);
      return '<li class="fileitem"><a class="file" href="#/f/' + encodeURIComponent(f.id) + '">' +
        '<span class="ficon ' + f.kind + '">' + ICON[f.kind] + '</span>' +
        '<span class="meta"><span class="name">' + esc(f.name) + '</span><span class="sub">' + esc(sub) + '</span></span>' +
        '<span class="count"><b>' + c.total + '</b><small>' + (c.total === 1 ? 'device' : 'devices') + '</small></span>' + CHEV + '</a>' +
        '<button type="button" class="fdel" data-del="' + esc(f.id) + '" aria-label="Delete ' + esc(f.name) + '">' + TRASH + '</button></li>';
    }).join('');
  }

  /* ---------- rendering: file ---------- */
  var CONF_TEXT = { confirmed: 'confirmed', single: 'read once', manual: 'typed' };
  function confDot(row, k) {
    var c = row.conf && row.conf[k];
    if (!c || !row[k]) return '';
    return '<span class="conf ' + c + '" title="' + CONF_TEXT[c] + '"><i aria-hidden="true"></i>' + CONF_TEXT[c] + '</span>';
  }
  /* Validation lines under a field: problems (warn/error) and the serial date-code sanity note. */
  function fieldMsgs(row, k) {
    var issues = k === 'mac' ? macIssues(row.mac, oui) : k === 'serial' ? serialIssues(row.serial) : [];
    var h = issues.map(function (i) { return '<span class="fmsg ' + i.level + '">' + esc(i.text) + '</span>'; }).join('');
    if (k === 'serial' && !issues.length && serialNote(row.serial)) h += '<span class="fmsg ok">' + esc(serialNote(row.serial)) + '</span>';
    if (k === 'mac' && !issues.length && ouiVendor(row.mac, oui)) h += '<span class="fmsg ok">' + ouiVendor(row.mac, oui) + ' OUI</span>';
    return h;
  }
  function fieldHtml(row, k) {
    var id = 'f-' + row.id + '-' + k;
    var miss = !row[k] && k !== 'note' && k !== 'hwRev';
    return '<div class="field' + (miss ? ' missing' : '') + (k === 'note' ? ' note' : '') + '"><label for="' + id + '"><span>' + esc(LABEL[k]) + '</span>' + confDot(row, k) + '</label>' +
      '<input id="' + id + '" data-row="' + row.id + '" data-field="' + k + '" value="' + esc(row[k]) + '" placeholder="' + (k === 'note' ? 'Closet, rack, room, anything' : 'Not read') + '"' +
      (k === 'note' ? ' autocapitalize="sentences" style="font-family:var(--font-ui)"' : ' autocapitalize="characters"') + ' autocomplete="off" autocorrect="off" spellcheck="false">' +
      '<div class="fmsgs" id="m-' + row.id + '-' + k + '" aria-live="polite">' + fieldMsgs(row, k) + '</div></div>';
  }
  function cardFields(row) {
    var exp = expectedFor(row.type).slice();
    var i = exp.indexOf('pid'); if (i >= 0) exp.splice(i + 1, 0, 'hwRev');
    var extra = Core.FIELD_ORDER.filter(function (k) { return exp.indexOf(k) < 0; });
    if (exp.indexOf('hwRev') < 0) extra.push('hwRev');
    return { main: exp.concat(['note']), extra: extra };
  }
  function cardHtml(f, row) {
    var miss = missingOf(row), fl = cardFields(row);
    var h = '<li class="card" data-row="' + row.id + '"><header><span class="num">' + num(f, row) + '</span>' +
      '<span class="ttl"><span class="model' + (row.pid ? '' : ' none') + '">' + esc(row.pid || 'Model not read') + '</span><span class="when">' + esc(row.type === 'Other' ? 'Device' : row.type) + ' · ' + esc(niceDate(row.scannedAt)) + '</span></span>' +
      (f.kind === 'Mixed' ? '<select class="typesel" data-row="' + row.id + '" data-field="type" aria-label="Device type">' +
        Core.TYPES.map(function (t) { return '<option' + (t === row.type ? ' selected' : '') + '>' + t + '</option>'; }).join('') + '</select>' : '') +
      '<span class="state dupchip" hidden>Duplicate</span>' +
      '<span class="state fill ' + (miss.length ? 'warn' : 'ok') + '">' + (miss.length ? miss.length + ' missing' : 'Complete') + '</span></header>' +
      '<div class="dupbox" hidden></div>';
    if (row.serialMismatch) h += '<p class="mismatch" role="alert"><b>Serial mismatch.</b> The barcode label says ' + esc(row.serialMismatch.label) + ' but the Data Matrix says ' + esc(row.serialMismatch.matrix) + '. Check the device before exporting.</p>';
    h += '<div class="fields">' + fl.main.map(function (k) { return fieldHtml(row, k); }).join('') + '</div>';
    h += '<details><summary>More fields (' + fl.extra.length + ')</summary><div class="fields" style="margin-top:8px">' + fl.extra.map(function (k) { return fieldHtml(row, k); }).join('') + '</div></details>';
    if (row.serialAgrees) h += '<p class="note-ok">Serial read the same from the barcode and the Data Matrix.</p>';
    if (row.warnings && row.warnings.length) h += '<ul class="warns">' + row.warnings.map(function (w) { return '<li>' + esc(w) + '</li>'; }).join('') + '</ul>';
    if (row.other && row.other.length) h += '<details class="others"><summary>' + plural(row.other.length, 'other code') + ' not matched to a field</summary><ul>' + row.other.map(function (o) { return '<li>' + esc(o.format) + ': ' + esc(o.text) + '</li>'; }).join('') + '</ul></details>';
    h += '<div class="actions">' +
      '<button type="button" class="btn small" data-act="live" data-id="' + row.id + '">Scan more</button>' +
      '<button type="button" class="btn small" data-act="asset" data-id="' + row.id + '">Scan asset tag</button>' +
      '<button type="button" class="btn small" data-act="photo" data-id="' + row.id + '">Add photo</button>' +
      (f.rows.length > 1 ? '<button type="button" class="btn small" data-act="merge" data-id="' + row.id + '">Merge into…</button>' : '') +
      '<span class="grow"></span><button type="button" class="btn small danger" data-act="del" data-id="' + row.id + '">Delete</button></div></li>';
    return h;
  }
  function refreshDups(f) {
    invalidateDups();
    document.querySelectorAll('#devices .card').forEach(function (card) {
      var row = findRow(f, card.dataset.row); if (!row) return;
      var d = dupsOf(f, row), box = card.querySelector('.dupbox');
      card.classList.toggle('dup', d.length > 0);
      card.querySelector('.dupchip').hidden = !d.length;
      box.hidden = !d.length;
      box.innerHTML = d.map(function (x) { return '<div><b>' + esc(Core.FIELD_LABEL[x.k]) + '</b> also on ' + esc(x.where.join(', ')) + '</div>'; }).join('');
      card.querySelectorAll('.field').forEach(function (el) {
        var inp = el.querySelector('input');
        el.classList.toggle('dupfield', d.some(function (x) { return x.k === inp.dataset.field; }));
      });
    });
  }
  function renderStats(f) {
    var c = counts(f);
    var pct = c.total ? Math.round(c.done / c.total * 100) : 0;
    $('fProgress').style.width = pct + '%';
    $('fProgressWrap').setAttribute('aria-valuenow', String(pct));
    $('fProgressText').textContent = c.total ? plural(c.total, 'device') + ' · ' + c.done + ' complete · ' + c.miss + ' missing fields' + (c.dup ? ' · ' + plural(c.dup, 'duplicate') : '') : 'No devices yet';
    $('devFilter').hidden = !c.total;
    [['all', c.total], ['incomplete', c.miss], ['dups', c.dup]].forEach(function (x) {
      var b = $('devFilter').querySelector('[data-filter="' + x[0] + '"]');
      b.querySelector('b').textContent = x[1];
      b.setAttribute('aria-pressed', String(listFilter === x[0]));
      b.disabled = x[0] !== 'all' && !x[1];
    });
    $('stTotal').textContent = c.total; $('stDone').textContent = c.done; $('stMiss').textContent = c.miss; $('stDup').textContent = c.dup;
    $('bbText').textContent = c.total ? plural(c.total, 'device') + ' · ' + c.done + ' complete' : 'No devices yet';
    $('btnExport').disabled = !c.total;
    $('devHead').textContent = c.total ? 'Devices (' + c.total + ')' : 'Devices';
  }
  function renderFile() {
    var f = cur(); if (!f) return;
    $('fIcon').className = 'ficon ' + f.kind; $('fIcon').innerHTML = ICON[f.kind];
    $('fBadge').className = 'badge ' + f.kind; $('fBadge').textContent = KIND[f.kind].label;
    $('fSite').textContent = [f.location, f.rack ? 'Rack/U ' + f.rack : ''].filter(Boolean).concat(['Created ' + niceDate(f.created)]).join(' · ');
    var shown = f.rows.filter(function (r) { return listFilter === 'incomplete' ? missingOf(r).length > 0 : listFilter === 'dups' ? dupsOf(f, r).length > 0 : true; });
    if (listFilter !== 'all' && !shown.length && f.rows.length) { listFilter = 'all'; shown = f.rows; }
    $('devices').innerHTML = shown.slice().reverse().map(function (r) { return cardHtml(f, r); }).join('');
    $('devEmpty').hidden = f.rows.length > 0;
    refreshDups(f); renderStats(f); setBusy(busy);
  }

  /* ---------- export (templates in src/templates.js) ---------- */
  var FMT = { csv: { ext: 'csv', mime: 'text/csv' }, xlsx: { ext: 'xlsx', mime: Xlsx.MIME }, json: { ext: 'json', mime: 'application/json' } };
  function template() { return findTemplate(state.exp.template, state.templates); }
  function exportTable(f) {
    var t = template();
    var tab = buildTable(t, f, f.rows, { macStyle: state.exp.macStyle, apSerial: state.exp.apSerial, dupText: function (r) { return dupText(dupsOf(f, r)); } });
    tab.dupRows = [];
    f.rows.forEach(function (r, i) { if (dupsOf(f, r).length) tab.dupRows.push(i); });
    return tab;
  }
  function toTsv(t) {
    return [t.header].concat(t.rows).map(function (r) { return r.map(function (v) { return String(v).replace(/[\t\r\n]+/g, ' '); }).join('\t'); }).join('\n');
  }
  function safeStem(s) { return String(s || '').replace(/[\\\/:*?"<>|\u0000-\u001f]+/g, '-').replace(/\s+/g, ' ').trim().replace(/\.(csv|xlsx|json)$/i, ''); }
  function defaultStem(f) { return exportFileName(f.name, new Date(), 'x').slice(0, -2); }
  function exportName(f) { return (safeStem($('exName').value) || defaultStem(f)) + '.' + FMT[state.exp.format].ext; }
  function jsonText(f) { return JSON.stringify(fileJson(f, { app: 'Label Scanner ' + APP_VERSION }), null, 2); }
  function buildFile(f) {
    var name = exportName(f), fmt = state.exp.format;
    if (fmt === 'json') return new File([jsonText(f)], name, { type: FMT.json.mime });
    var t = exportTable(f);
    if (fmt === 'xlsx') return new File([Xlsx.build(f.name, t.header, t.rows, { highlight: t.dupRows })], name, { type: Xlsx.MIME });
    return new File([tableToCsv(t.header, t.rows)], name, { type: FMT.csv.mime });
  }

  function openExport() {
    var f = cur(); if (!f) return;
    $('exName').value = defaultStem(f);
    $('macStyle').value = state.exp.macStyle; $('apSerial').value = state.exp.apSerial;
    renderExport();
  }
  function renderExport() {
    var f = cur(); if (!f) return;
    var c = counts(f), o = state.exp, t = template();
    $('exTotal').textContent = c.total; $('exDone').textContent = c.done; $('exMiss').textContent = c.miss; $('exDup').textContent = c.dup;
    var dupList = f.rows.filter(function (r) { return dupsOf(f, r).length; });
    $('exDupCallout').hidden = !dupList.length;
    $('exDupCallout').textContent = dupList.length ? plural(dupList.length, 'device') + ' look like duplicates: ' +
      dupList.slice(0, 4).map(function (r) { return '#' + num(f, r) + ' (' + dupText(dupsOf(f, r)) + ')'; }).join('; ') + (dupList.length > 4 ? '; and ' + (dupList.length - 4) + ' more' : '') +
      '. They are highlighted in the preview and in the Excel file.' : '';
    var once = [];
    f.rows.forEach(function (r) { Object.keys(r.conf || {}).forEach(function (k) { if (r.conf[k] === CONF.single && r[k]) once.push('#' + num(f, r) + ' ' + LABEL[k]); }); });
    $('exOnceCallout').hidden = !once.length;
    $('exOnceCallout').textContent = once.length ? plural(once.length, 'value') + (once.length === 1 ? ' was' : ' were') + ' read only once (amber dot): ' + once.slice(0, 6).join(', ') +
      (once.length > 6 ? ' and ' + (once.length - 6) + ' more' : '') + '. Check them against the label, or scan again to confirm.' : '';
    var mism = f.rows.filter(function (r) { return r.serialMismatch; });
    $('exMismatch').hidden = !mism.length;
    $('exMismatch').textContent = mism.length ? 'Serial mismatch on ' + mism.map(function (r) { return '#' + num(f, r); }).join(', ') + ': the barcode label and the Data Matrix disagree.' : '';
    var bad = f.rows.filter(function (r) { return missingOf(r).length; });
    var co = $('exCallout');
    co.hidden = !c.total;
    co.className = 'callout' + (bad.length ? '' : ' ok');
    co.textContent = bad.length ?
      plural(bad.length, 'device') + ' missing information: ' + bad.slice(0, 4).map(function (r) { return '#' + num(f, r) + ' (' + missingOf(r).map(function (k) { return Core.FIELD_LABEL[k]; }).join(', ') + ')'; }).join('; ') + (bad.length > 4 ? '; and ' + (bad.length - 4) + ' more.' : '.') + ' You can still export.' :
      'All ' + plural(c.total, 'device') + ' have every expected field.';
    document.querySelectorAll('[data-fmt]').forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset.fmt === o.format)); });
    $('exExt').textContent = '.' + FMT[o.format].ext;
    var isJson = o.format === 'json';
    $('tplGroup').hidden = isJson; $('exOpts').hidden = isJson; $('jsonNote').hidden = !isJson;
    $('tplSel').innerHTML = allTemplates(state.templates).map(function (x) {
      return '<option value="' + esc(x.id) + '"' + (x.id === t.id ? ' selected' : '') + '>' + esc(x.name) + (x.builtin ? '' : ' (yours)') + '</option>';
    }).join('');
    $('btnTplEdit').hidden = !!t.builtin; $('btnTplDel').hidden = !!t.builtin;
    $('tplHint').textContent = t.id === 'snipeit' ? 'Snipe-IT: Hardware > Import. The importer maps columns by these header names and lets you change the mapping; MAC Address is a custom field in its default fieldsets. New models also need a Category and Manufacturer, which you can set in the importer.' :
      t.id === 'full' || t.id === 'short' ? 'Original template, unchanged.' : t.cols.length + ' columns.';
    var hasAP = f.kind === 'AP' || f.rows.some(function (r) { return r.type === 'AP'; });
    $('apSerialWrap').hidden = !(t.apSerialOption && hasAP);
    var tab = isJson ? null : exportTable(f);
    if (isJson) {
      $('prevHead').textContent = 'Preview · ' + plural(f.rows.length, 'device');
      $('prevTable').hidden = true; $('prevJson').hidden = false;
      var text = jsonText(f);
      $('prevJson').textContent = text.length > 4000 ? text.slice(0, 4000) + '\n…' : text;
    } else {
      $('prevTable').hidden = false; $('prevJson').hidden = true;
      $('prevHead').textContent = 'Preview · ' + plural(tab.rows.length, 'row') + ', ' + plural(tab.header.length, 'column');
      $('prevTable').innerHTML = !tab.header.length ? '<tr><td class="na">This template has no columns.</td></tr>' :
        '<thead><tr>' + tab.header.map(function (h) { return '<th>' + esc(h) + '</th>'; }).join('') + '</tr></thead><tbody>' +
        (tab.rows.length ? tab.rows.map(function (r, i) { return '<tr' + (tab.dupRows.indexOf(i) >= 0 ? ' class="dup"' : '') + '>' + r.map(function (v) { return v ? '<td>' + esc(v) + '</td>' : '<td class="na">—</td>'; }).join('') + '</tr>'; }).join('') :
          '<tr><td class="na" colspan="' + tab.header.length + '">No devices yet.</td></tr>') + '</tbody>';
    }
    $('btnCopy').textContent = isJson ? 'Copy JSON' : 'Copy as table';
    var ok = c.total > 0 && (isJson || tab.header.length > 0);
    ['btnShare', 'btnDownload', 'btnCopy'].forEach(function (id) { $(id).disabled = !ok; });
  }

  function downloadFile() {
    var f = cur(); if (!f) return;
    var file = buildFile(f), url = URL.createObjectURL(file);
    var a = document.createElement('a'); a.href = url; a.download = file.name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
    setStatus('Downloaded ' + file.name + '.');
    return file.name;
  }
  async function shareFile() {
    var f = cur(); if (!f) return;
    var file = buildFile(f);
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: file.name, text: f.name + (f.location ? ' (' + f.location + ')' : '') + ': ' + plural(f.rows.length, 'device') + ', exported ' + stamp(new Date()) + '.' });
        setStatus('Shared ' + file.name + '.');
      } catch (e) { if (!e || e.name !== 'AbortError') setStatus('Sharing failed (' + (e && e.message || 'error') + '). Use Download instead.', 'warn'); }
    } else {
      var n = downloadFile();
      if (!state.shareNoted) {
        state.shareNoted = true; save();
        setStatus('This browser cannot attach files to the share sheet, so ' + n + ' was downloaded instead. Attach it from your downloads or Files. (Shown once.)', 'warn');
      }
    }
  }
  async function copyTable() {
    var f = cur(); if (!f) return;
    var text = state.exp.format === 'json' ? jsonText(f) : toTsv(exportTable(f));
    try { await navigator.clipboard.writeText(text); setStatus(state.exp.format === 'json' ? 'JSON copied.' : 'Copied. Paste into Excel, Numbers, Sheets or an email.'); }
    catch (e) { setStatus('Copy is blocked in this browser. Use Download or Email instead.', 'warn'); }
  }

  /* ---------- template editor ---------- */
  var editing = null;
  function openTemplateEditor(t) {
    editing = JSON.parse(JSON.stringify(t));
    $('tplName').value = editing.name;
    renderTemplateEditor();
    var d = $('dlgTpl'); if (d.showModal) d.showModal(); else d.setAttribute('open', '');
  }
  function renderTemplateEditor() {
    var on = editing.cols.map(function (c) { return c.key; });
    var rows = editing.cols.map(function (c) { return { key: c.key, header: c.header, on: true }; })
      .concat(COLUMN_KEYS.filter(function (k) { return on.indexOf(k) < 0; }).map(function (k) { return { key: k, header: COLUMNS[k].header, on: false }; }));
    $('tplCols').innerHTML = rows.map(function (r, i) {
      return '<li class="tplcol' + (r.on ? '' : ' off') + '" data-key="' + r.key + '">' +
        '<label class="tplon"><input type="checkbox"' + (r.on ? ' checked' : '') + ' aria-label="Include ' + esc(COLUMNS[r.key].label) + '"><span>' + esc(COLUMNS[r.key].label) + '</span></label>' +
        '<input class="input tplhead" type="text" value="' + esc(r.header) + '" aria-label="Header for ' + esc(COLUMNS[r.key].label) + '"' + (r.on ? '' : ' disabled') + '>' +
        '<span class="tplmove"><button type="button" class="iconbtn" data-move="-1" aria-label="Move up"' + (r.on && i > 0 ? '' : ' disabled') + '>↑</button>' +
        '<button type="button" class="iconbtn" data-move="1" aria-label="Move down"' + (r.on && i < on.length - 1 ? '' : ' disabled') + '>↓</button></span></li>';
    }).join('');
  }
  function readTemplateEditor() {
    editing.name = $('tplName').value;
    editing.cols = Array.prototype.filter.call($('tplCols').children, function (li) { return li.querySelector('input[type=checkbox]').checked; })
      .map(function (li) { return { key: li.dataset.key, header: li.querySelector('.tplhead').value }; });
  }
  $('tplCols').addEventListener('change', function (e) {
    if (e.target.type !== 'checkbox') return;
    readTemplateEditor(); renderTemplateEditor();
  });
  $('tplCols').addEventListener('click', function (e) {
    var b = e.target.closest('button[data-move]'); if (!b) return;
    readTemplateEditor();
    var key = b.closest('li').dataset.key, i = editing.cols.findIndex(function (c) { return c.key === key; }), j = i + Number(b.dataset.move);
    if (i < 0 || j < 0 || j >= editing.cols.length) return;
    var tmp = editing.cols[i]; editing.cols[i] = editing.cols[j]; editing.cols[j] = tmp;
    renderTemplateEditor();
    var again = $('tplCols').querySelector('li[data-key="' + key + '"] button[data-move="' + b.dataset.move + '"]');
    if (again && !again.disabled) again.focus();
  });
  $('tplForm').addEventListener('submit', function (e) {
    e.preventDefault();
    readTemplateEditor();
    var t = cleanTemplate(editing);
    if (!t.cols.length) { $('tplErr').hidden = false; return; }
    $('tplErr').hidden = true;
    var i = state.templates.findIndex(function (x) { return x.id === t.id; });
    if (i >= 0) state.templates[i] = t; else state.templates.push(t);
    state.exp.template = t.id; save();
    $('dlgTpl').close(); renderExport();
  });
  $('btnTplCancel').addEventListener('click', function () { $('dlgTpl').close(); });
  $('btnTplNew').addEventListener('click', function () { openTemplateEditor(newTemplate('My template')); });
  $('btnTplEdit').addEventListener('click', function () { openTemplateEditor(template()); });
  $('btnTplDel').addEventListener('click', function (e) {
    var t = template(); if (t.builtin) return;
    twoStep(e.target, 'deltpl', 'Delete', function () {
      state.templates = state.templates.filter(function (x) { return x.id !== t.id; });
      state.exp.template = 'full'; save(); renderExport(); setStatus('Template “' + t.name + '” deleted.');
    });
  });
  $('tplSel').addEventListener('change', function (e) { state.exp.template = e.target.value; save(); renderExport(); });

  /* ---------- new file sheet ---------- */
  var nameEdited = false;
  function defaultName(kind) { return KIND[kind].label + ' ' + ymd(new Date()); }
  function selectedKind() { var r = document.querySelector('#newForm input[name="kind"]:checked'); return r ? r.value : 'AP'; }
  function openNew() {
    var d = $('dlgNew');
    $('newForm').reset(); nameEdited = false;
    $('newName').value = defaultName(selectedKind());
    if (d.showModal) d.showModal(); else d.setAttribute('open', '');
  }
  function closeNew() { var d = $('dlgNew'); if (d.close) d.close(); else d.removeAttribute('open'); }

  /* ---------- events ---------- */
  var armed = {};
  function twoStep(btn, key, label, run) {
    if (armed[key]) { clearTimeout(armed[key].t); delete armed[key]; btn.textContent = label; run(); return; }
    armed[key] = { t: setTimeout(function () { btn.textContent = label; delete armed[key]; }, 3000) };
    btn.textContent = 'Tap again to confirm';
  }
  function onFiles(e) { var list = Array.prototype.slice.call(e.target.files || []); e.target.value = ''; handleFiles(list, targetId); }

  document.querySelectorAll('[data-icon]').forEach(function (el) { el.innerHTML = ICON[el.dataset.icon]; });
  $('btnBack').addEventListener('click', goBack);
  $('btnNew').addEventListener('click', openNew);
  $('btnNewCancel').addEventListener('click', closeNew);
  $('newName').addEventListener('input', function () { nameEdited = true; });
  $('newForm').addEventListener('change', function (e) {
    if (e.target.name === 'kind' && !nameEdited) $('newName').value = defaultName(e.target.value);
  });
  $('newForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var name = $('newName').value.trim() || defaultName(selectedKind());
    var f = newFile(name, $('newLocation').value.trim(), $('newRack').value.trim(), selectedKind());
    save(); closeNew();
    go('#/f/' + encodeURIComponent(f.id));
  });

  $('btnLive').addEventListener('click', function () { startLive(null); });
  $('btnCam').addEventListener('click', function () { targetId = null; $('inCam').click(); });
  $('btnLib').addEventListener('click', function () { targetId = null; $('inLib').click(); });
  $('inCam').addEventListener('change', onFiles);
  $('inLib').addEventListener('change', onFiles);
  $('btnManual').addEventListener('click', function () {
    var f = cur(); if (!f) return;
    var row = newRow(f, { type: f.kind === 'Mixed' ? 'Other' : f.kind }); f.rows.push(row); touch(f); save(); renderFile();
    var el = document.getElementById('f-' + row.id + '-assetTag'); if (el) el.focus();
  });
  $('btnSaveDev').addEventListener('click', saveLiveDevice);
  $('btnResetDev').addEventListener('click', function () { live.codes = new Map(); live.frames = 0; live.justSaved = null; renderLive(); });
  $('btnStop').addEventListener('click', stopLive);
  $('btnTorch').addEventListener('click', function () {
    var on = !this.dataset.on; this.dataset.on = on ? '1' : '';
    this.textContent = on ? 'Light off' : 'Light';
    this.setAttribute('aria-pressed', String(on));
    if (live.track) Cam.setTorch(live.track, on);
  });
  $('zoom').addEventListener('input', function () {
    var z = Number(this.value);
    $('zoomVal').textContent = z.toFixed(1) + '×';
    state.zoom = z; save();
    if (live.track) Cam.applyZoom(live.track, z);
  });
  $('viewport').addEventListener('click', tapFocus);
  $('video').addEventListener('resize', fitViewport);
  $('btnStill').addEventListener('click', captureStill);
  function backgrounded() {
    store.flush();
    if (live.running) { stopLive(); setStatus('Camera closed while the app was in the background. Codes not saved were cleared.', 'warn'); }
  }
  document.addEventListener('visibilitychange', function () { if (document.hidden) backgrounded(); });
  window.addEventListener('pagehide', backgrounded);

  $('fName').addEventListener('change', function (e) {
    var f = cur(); if (!f) return;
    var v = e.target.value.trim(); if (!v) { e.target.value = f.name; return; }
    f.name = v; touch(f); save(); $('title').textContent = v;
  });
  $('fLocation').addEventListener('change', function (e) { var f = cur(); if (!f) return; f.location = e.target.value.trim(); touch(f); save(); renderFile(); });
  $('fRack').addEventListener('change', function (e) { var f = cur(); if (!f) return; f.rack = e.target.value.trim(); touch(f); save(); renderFile(); });
  $('devFilter').addEventListener('click', function (e) {
    var b = e.target.closest('button[data-filter]'); if (!b) return;
    listFilter = b.dataset.filter; renderFile();
  });
  $('autoSave').addEventListener('change', function (e) { state.autoSave = e.target.checked; save(); });
  $('btnDelFile').addEventListener('click', function (e) {
    var f = cur(); if (!f) return;
    twoStep(e.target, 'delfile', 'Delete this file', function () {
      state.files = state.files.filter(function (x) { return x.id !== f.id; }); save();
      location.replace('#/'); setStatus('Deleted ' + f.name + '.');
    });
  });

  $('btnExport').addEventListener('click', function () { var f = cur(); if (f && f.rows.length) go('#/f/' + encodeURIComponent(f.id) + '/export'); });
  document.querySelectorAll('[data-fmt]').forEach(function (b) { b.addEventListener('click', function () { state.exp.format = b.dataset.fmt; save(); renderExport(); }); });
  $('macStyle').addEventListener('change', function (e) { state.exp.macStyle = e.target.value; save(); renderExport(); });
  $('apSerial').addEventListener('change', function (e) { state.exp.apSerial = e.target.value; save(); renderExport(); });
  $('btnShare').addEventListener('click', shareFile);
  $('btnDownload').addEventListener('click', downloadFile);
  $('btnCopy').addEventListener('click', copyTable);

  $('assetRe').addEventListener('change', function (e) {
    try { new RegExp(e.target.value); state.assetRe = e.target.value; setStatus('Asset tag pattern saved. It applies to the next scan.'); }
    catch (x) { setStatus('That pattern is not a valid regular expression.', 'warn'); e.target.value = state.assetRe; }
    save();
  });

  $('devices').addEventListener('input', function (e) {
    var t = e.target; if (!t.dataset || !t.dataset.field || t.dataset.field === 'type') return;
    var f = cur(), row = findRow(f, t.dataset.row); if (!row) return;
    var k = t.dataset.field;
    row[k] = k === 'note' ? t.value : t.value.trim();
    row.conf = row.conf || {};
    if (k !== 'note') row.conf[k] = CONF.manual;
    if (k === 'pid' && row.conf.hwRev !== CONF.manual) {
      row.hwRev = splitPid(row.pid).rev; row.conf.hwRev = CONF.manual;
      var hw = document.getElementById('f-' + row.id + '-hwRev'); if (hw) hw.value = row.hwRev;
    }
    touch(f); save(); renderStats(f);
  });
  $('devices').addEventListener('change', function (e) {
    var t = e.target; if (!t.dataset || !t.dataset.field) return;
    var f = cur(), row = findRow(f, t.dataset.row); if (!row) return;
    if (t.dataset.field === 'type') { row.type = t.value; save(); renderFile(); return; }
    if (t.dataset.field === 'mac') { var n = Core.normalizeMac(t.value); if (n) { row.mac = n; t.value = n; save(); } }
    var msgs = document.getElementById('m-' + row.id + '-' + t.dataset.field);
    if (msgs) msgs.innerHTML = fieldMsgs(row, t.dataset.field);
    var lbl = t.closest('.field').querySelector('label');
    var old = lbl.querySelector('.conf'); if (old) old.remove();
    lbl.insertAdjacentHTML('beforeend', confDot(row, t.dataset.field));
    if (DUP_FIELDS.indexOf(t.dataset.field) >= 0) { refreshDups(f); renderStats(f); }
    if (t.dataset.field !== 'note') {
      var card = t.closest('.card'), miss = missingOf(row), chip = card && card.querySelector('.state.fill');
      if (chip) { chip.className = 'state fill ' + (miss.length ? 'warn' : 'ok'); chip.textContent = miss.length ? miss.length + ' missing' : 'Complete'; }
      t.closest('.field').classList.toggle('missing', !row[t.dataset.field]);
    }
  });
  $('devices').addEventListener('click', function (e) {
    var b = e.target.closest('button[data-act]'); if (!b) return;
    var f = cur(), id = b.dataset.id;
    if (b.dataset.act === 'live') startLive(id);
    if (b.dataset.act === 'asset') startLive(id, 'asset');
    if (b.dataset.act === 'photo') { targetId = id; $('inCam').click(); }
    if (b.dataset.act === 'del') deleteDevice(f, id);
    if (b.dataset.act === 'merge') mergeInto(f, id);
  });

  /* ---------- delete with undo, merge ---------- */
  var undo = null;
  function offerUndo(text, restore) {
    if (undo) clearTimeout(undo.t);
    var t = $('toast');
    t.querySelector('span').textContent = text;
    t.hidden = false;
    undo = { restore: restore, t: setTimeout(clearUndo, 5000) };
  }
  function clearUndo() { if (undo) clearTimeout(undo.t); undo = null; $('toast').hidden = true; }
  $('btnUndo').addEventListener('click', function () {
    if (!undo) return;
    var r = undo.restore; clearUndo(); r();
  });
  /* Snapshot a file's devices so one tap can put them back exactly as they were. */
  function snapshot(f) { var rows = JSON.parse(JSON.stringify(f.rows)); return function () { f.rows = rows; touch(f); save(); if (cur() === f) renderFile(); setStatus('Restored.'); }; }
  function deleteDevice(f, id) {
    var row = findRow(f, id); if (!row) return;
    var n = num(f, row), restore = snapshot(f);
    f.rows = f.rows.filter(function (r) { return r.id !== id; }); touch(f); save(); renderFile();
    offerUndo('Deleted device #' + n + '.', restore);
  }
  async function mergeInto(f, id) {
    var src = findRow(f, id); if (!src) return;
    var others = f.rows.filter(function (r) { return r !== src; });
    var choice = await ask({
      title: 'Merge #' + num(f, src) + ' into…',
      text: 'Pick the device to keep. Empty fields on it are filled from #' + num(f, src) + ', then #' + num(f, src) + ' is removed. You can undo for 5 seconds.',
      buttons: others.map(function (r) { return { label: '#' + num(f, r) + ' · ' + (r.pid || r.type) + (r.serial ? ' · ' + r.serial : r.mac ? ' · ' + Core.formatMac(r.mac, 'colons') : ''), value: r.id, list: true }; })
        .concat([{ label: 'Cancel', value: '' }])
    });
    var dst = choice && findRow(f, choice); if (!dst) return;
    var restore = snapshot(f), from = num(f, src);
    mergeRows(dst, src);
    f.rows = f.rows.filter(function (r) { return r !== src; }); touch(f); save(); renderFile();
    offerUndo('Merged #' + from + ' into #' + num(f, dst) + '.', restore);
  }

  /* ---------- ask: small modal sheet that resolves to the chosen button's value ('' when dismissed) ---------- */
  function ask(o) {
    var d = $('dlgAsk');
    $('askTitle').textContent = o.title; $('askText').textContent = o.text || '';
    $('askBtns').innerHTML = o.buttons.map(function (b) {
      return '<button type="submit" class="btn' + (b.primary ? ' primary' : '') + (b.list ? ' listbtn' : '') + '" value="' + esc(b.value) + '">' + esc(b.label) + '</button>';
    }).join('');
    $('askBtns').classList.toggle('list', o.buttons.some(function (b) { return b.list; }));
    return new Promise(function (resolve) {
      d.returnValue = '';
      d.addEventListener('close', function done() { d.removeEventListener('close', done); resolve(d.returnValue || ''); });
      if (d.showModal) d.showModal(); else d.setAttribute('open', '');
    });
  }

  function deleteFile(id) {
    var f = state.files.find(function (x) { return x.id === id; }); if (!f) return;
    state.files = state.files.filter(function (x) { return x.id !== id; }); save();
    renderHome(); setStatus('Deleted \u201c' + f.name + '\u201d.');
  }
  $('files').addEventListener('click', function (e) {
    var b = e.target.closest('button[data-del]'); if (!b) return;
    e.preventDefault();
    if (b.classList.contains('armed')) { deleteFile(b.dataset.del); return; }
    document.querySelectorAll('#files .fdel.armed').forEach(function (x) { x.classList.remove('armed'); x.innerHTML = TRASH; });
    b.classList.add('armed'); b.textContent = 'Delete';
    setTimeout(function () { if (b.isConnected && b.classList.contains('armed')) { b.classList.remove('armed'); b.innerHTML = TRASH; } }, 3000);
  });
  $('btnDelAll').addEventListener('click', function (e) {
    twoStep(e.target, 'delall', 'Delete all data', async function () {
      var n = state.files.length;
      state.files = []; state.assetRe = Core.DEFAULT_ASSET_RE; state.autoSave = false; delete state.zoom;
      state.exp = { format: 'csv', template: 'full', macStyle: 'colons', apSerial: 'cisco' }; state.templates = []; state.shareNoted = false;
      clearUndo();
      await store.clear();
      $('assetRe').value = state.assetRe; $('autoSave').checked = false;
      renderHome(); setStatus('All data deleted from this phone (' + plural(n, 'file') + ' and settings).');
    });
  });

  window.addEventListener('hashchange', onRoute);

  /* ---------- boot ---------- */
  fetch('data/oui-cisco.json').then(function (r) { return r.ok ? r.json() : null; }).then(function (j) {
    oui = ouiSets(j); if (route.view === 'file') renderFile();
  }).catch(function () { oui = null; });
  (async function boot() {
    var kind = await store.open();
    await load();
    $('assetRe').value = state.assetRe;
    $('autoSave').checked = state.autoSave;
    $('storageNote').textContent = kind === 'indexeddb' ? 'Saved on this phone in the browser database (IndexedDB).' :
      kind === 'localstorage' ? 'This browser has no IndexedDB here, so files are kept in its smaller local storage.' : 'This browser cannot store files here; export before closing.';
    onRoute();
    initScanner();
  })();
})();
