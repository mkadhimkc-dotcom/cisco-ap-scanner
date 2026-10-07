/* Label Scanner app: scan files, live camera scan, photo scan, device list, CSV/Excel export. */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var Core = window.Core;
  var LABEL = Object.assign({ note: 'Note' }, Core.FIELD_LABEL);
  var STORE = 'labelscanner.v3', OLD_STORE = 'labelscanner.v2';

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
  var CHEV = '<svg class="chev" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>';

  /* export columns, in output order */
  var COLS = [
    ['type', 'Type'], ['assetTag', 'Asset Tag'], ['mac', 'MAC Address'], ['serial', 'Serial Number'], ['meraki', 'Meraki Serial'],
    ['pid', 'Model (PID)'], ['partNo', 'Part Number'], ['clei', 'CLEI'], ['note', 'Note'], ['scannedAt', 'Scanned At'], ['site', 'Site'], ['file', 'File'], ['dup', 'Duplicate Of']
  ];
  var COL_HEAD = {}; COLS.forEach(function (c) { COL_HEAD[c[0]] = c[1]; });

  var state = {
    files: [], assetRe: Core.DEFAULT_ASSET_RE,
    exp: { format: 'xlsx', preset: 'full', custom: null, macStyle: 'colons', apSerial: 'cisco' }
  };
  var busy = false, targetId = null, decodeFn = null, route = { view: 'home' }, entryLevel = null;

  /* ---------- storage ---------- */
  function load() {
    try {
      var s = JSON.parse(localStorage.getItem(STORE) || 'null');
      if (s && typeof s === 'object') {
        if (Array.isArray(s.files)) state.files = s.files;
        if (typeof s.assetRe === 'string') state.assetRe = s.assetRe;
        if (s.exp && typeof s.exp === 'object') Object.assign(state.exp, s.exp);
        return;
      }
      var old = JSON.parse(localStorage.getItem(OLD_STORE) || 'null');
      if (old && typeof old === 'object') {
        if (typeof old.assetRe === 'string') state.assetRe = old.assetRe;
        ['macStyle', 'apSerial'].forEach(function (k) { if (typeof old[k] === 'string') state.exp[k] = old[k]; });
        if (old.template === 'short') state.exp.preset = 'short';
        if (Array.isArray(old.rows) && old.rows.length) {
          var f = newFile('Earlier scans', '', 'Mixed');
          f.rows = old.rows; f.seq = old.seq || old.rows.length;
        }
        save();
      }
    } catch (e) {}
  }
  function save() { invalidateDups(); try { localStorage.setItem(STORE, JSON.stringify(state)); } catch (e) {} }

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
  function findRow(f, id) { return f && f.rows.find(function (r) { return r.id === id; }); }
  function missingOf(row) { return expectedFor(row.type).filter(function (f) { return !row[f]; }); }
  function counts(f) {
    var done = f.rows.filter(function (r) { return !missingOf(r).length; }).length;
    return { total: f.rows.length, done: done, miss: f.rows.length - done, dup: f.rows.filter(function (r) { return dupsOf(f, r).length; }).length };
  }

  /* ---------- duplicates (across every file) ---------- */
  var DUP_FIELDS = ['assetTag', 'mac', 'serial', 'meraki'];
  function dupKey(k, v) {
    v = String(v == null ? '' : v).trim();
    if (!v) return '';
    return k + '|' + (k === 'mac' ? (Core.normalizeMac(v) || v.toUpperCase()) : v.toUpperCase());
  }
  var dupCache = null;
  function dupIndex() {
    if (dupCache) return dupCache;
    var idx = {};
    state.files.forEach(function (f) {
      f.rows.forEach(function (r) {
        DUP_FIELDS.forEach(function (k) { var key = dupKey(k, r[k]); if (key) (idx[key] = idx[key] || []).push({ f: f, r: r }); });
      });
    });
    return (dupCache = idx);
  }
  function invalidateDups() { dupCache = null; }
  function where(f, o) { return o.f === f ? '#' + o.r.n : '\u201c' + o.f.name + '\u201d #' + o.r.n; }
  /* -> [{k, where: ['#3', '"Other file" #2']}] for each field of row that another device also has */
  function dupsOf(f, row, values) {
    var idx = dupIndex(), out = [];
    DUP_FIELDS.forEach(function (k) {
      var key = dupKey(k, (values || row)[k]); if (!key) return;
      var others = (idx[key] || []).filter(function (o) { return o.r !== row; });
      if (others.length) out.push({ k: k, where: others.map(function (o) { return where(f, o); }) });
    });
    return out;
  }
  function dupText(d) { return d.map(function (x) { return Core.FIELD_LABEL[x.k] + ' = ' + x.where.join(', '); }).join('; '); }

  /* ---------- files ---------- */
  function newFile(name, site, kind) {
    var now = stamp(new Date());
    var f = { id: 'f' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), name: name, site: site || '', kind: KIND[kind] ? kind : 'Mixed', created: now, updated: now, rows: [], seq: 0 };
    state.files.push(f);
    return f;
  }
  function touch(f) { f.updated = stamp(new Date()); }

  /* ---------- decoder ---------- */
  var ZOPTS = { formats: ['Code128', 'Code39', 'DataMatrix', 'QRCode'], tryHarder: true, tryRotate: true, tryInvert: true, tryDownscale: true, maxNumberOfSymbols: 20 };
  async function initDecoder() {
    try {
      var Z = window.ZXingWASM;
      if (!Z) throw new Error('decoder script missing');
      Z.setZXingModuleOverrides({
        locateFile: function (p, prefix) { return /\.wasm$/.test(p) ? new URL('vendor/zxing_reader.wasm', document.baseURI).href : prefix + p; }
      });
      await Z.readBarcodes({ data: new Uint8ClampedArray(16 * 16 * 4).fill(255), width: 16, height: 16 }, ZOPTS);
      decodeFn = async function (img) {
        var res = await Z.readBarcodes(img, ZOPTS);
        return res.filter(function (r) { return r.isValid !== false; }).map(function (r) {
          var p = r.position;
          return { format: r.format, text: r.text, pos: p ? [p.topLeft, p.topRight, p.bottomRight, p.bottomLeft] : null };
        });
      };
      setPill('Ready', 'ok');
    } catch (e) {
      decodeFn = null;
      setPill('Scanner offline', 'bad');
      setStatus('The barcode decoder could not load (' + (e && e.message || 'unknown error') + '). You can still add devices by hand.', 'bad');
    }
    setBusy(busy);
  }

  /* ---------- rows ---------- */
  function newRow(f, dev) {
    f.seq += 1;
    return {
      id: 'd' + Date.now().toString(36) + f.seq, n: f.seq, type: dev.type || 'Other',
      assetTag: dev.assetTag || '', mac: dev.mac || '', serial: dev.serial || '', meraki: dev.meraki || '', pid: dev.pid || '', partNo: dev.partNo || '', clei: dev.clei || '',
      note: '', scannedAt: stamp(new Date()), warnings: dev.warnings || [], other: dev.other || [], serialAgrees: !!dev.serialAgrees,
      scanned: {}, edited: {}
    };
  }
  /* codes -> new device in file f, or merged into the device with id tid. Returns the row or null. */
  function ingest(f, codes, tid) {
    var dev = Core.buildDevice(codes, { assetRe: state.assetRe });
    var got = Core.FIELD_ORDER.filter(function (k) { return dev[k]; }).length;
    if (!got && !dev.other.length) return null;
    if (f.kind !== 'Mixed') dev.type = f.kind;
    var row = tid && findRow(f, tid);
    if (row) Core.mergeDevice(row, dev);
    else { row = newRow(f, dev); f.rows.push(row); }
    Core.FIELD_ORDER.forEach(function (k) { if (dev[k] && row[k] === dev[k]) row.scanned[k] = true; });
    touch(f);
    return row;
  }
  function summary(row) {
    var exp = expectedFor(row.type), missing = missingOf(row).map(function (k) { return Core.FIELD_LABEL[k]; });
    return { text: row.type + ' #' + row.n + ': ' + (exp.length - missing.length) + ' of ' + exp.length + ' fields' + (missing.length ? '. Missing: ' + missing.join(', ') + '.' : '.'), kind: missing.length ? 'warn' : '' };
  }

  /* ---------- live camera ---------- */
  var live = { stream: null, track: null, running: false, codes: new Map(), target: null, frames: 0, canvas: null };

  async function startLive(tid) {
    var f = cur();
    if (!f || live.running || !decodeFn) return;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setStatus('This browser cannot open the camera here. Open the app from its https:// address in Safari, or use Take photo.', 'bad');
      return;
    }
    live.target = tid || null; live.codes = new Map(); live.frames = 0;
    $('liveTitle').textContent = live.target ? 'Adding to device #' + (findRow(f, live.target) || {}).n : 'Live scan';
    $('scanPanel').hidden = true; $('livePanel').hidden = false; $('bottomBar').hidden = true;
    $('liveMsg').textContent = 'Starting camera…'; setStatus('');
    renderLive();
    $('livePanel').scrollIntoView({ block: 'start', behavior: 'smooth' });
    try {
      live.stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } }
      });
    } catch (e) {
      closeLivePanel();
      var n = e && e.name;
      setStatus(n === 'NotAllowedError' ? 'Camera access was blocked. Allow the camera for this site in Settings, Safari, Camera, then try again.' :
        n === 'NotFoundError' ? 'No camera found on this device.' : 'Could not open the camera (' + (e && e.message || n || 'error') + ').', 'bad');
      return;
    }
    if (route.view !== 'file') { live.stream.getTracks().forEach(function (t) { t.stop(); }); live.stream = null; closeLivePanel(); return; }
    var v = $('video');
    v.srcObject = live.stream;
    try { await v.play(); } catch (e) {}
    live.track = live.stream.getVideoTracks()[0];
    setupCamControls();
    live.running = true;
    liveLoop();
  }

  function setupCamControls() {
    var caps = {};
    try { caps = live.track.getCapabilities ? live.track.getCapabilities() : {}; } catch (e) {}
    try { if (caps.focusMode && caps.focusMode.indexOf('continuous') >= 0) live.track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] }).catch(function () {}); } catch (e) {}
    $('btnTorch').hidden = !caps.torch; $('btnTorch').dataset.on = ''; $('btnTorch').textContent = 'Light';
    if (caps.zoom && caps.zoom.max > caps.zoom.min) {
      var z = $('zoom'); z.min = caps.zoom.min; z.max = Math.min(caps.zoom.max, 6); z.step = caps.zoom.step || 0.1;
      var c = (live.track.getSettings && live.track.getSettings().zoom) || caps.zoom.min; z.value = c;
      $('zoomWrap').hidden = false;
    } else $('zoomWrap').hidden = true;
  }

  async function liveLoop() {
    var v = $('video');
    if (!live.canvas) live.canvas = document.createElement('canvas');
    var ctx = live.canvas.getContext('2d', { willReadFrequently: true });
    while (live.running) {
      if (v.readyState < 2 || !v.videoWidth) { await sleep(100); continue; }
      var vw = v.videoWidth, vh = v.videoHeight, k = Math.min(1, 1920 / Math.max(vw, vh));
      var cw = Math.round(vw * k), ch = Math.round(vh * k);
      if (live.canvas.width !== cw || live.canvas.height !== ch) { live.canvas.width = cw; live.canvas.height = ch; }
      ctx.drawImage(v, 0, 0, cw, ch);
      var img = ctx.getImageData(0, 0, cw, ch);
      var list = [];
      try { list = await Core.scanImage({ data: img.data, width: cw, height: ch }, decodeFn, { noTiles: true }); } catch (e) {}
      if (!live.running) break;
      live.frames++;
      var fresh = false;
      list.forEach(function (c) {
        var key = c.format + '|' + c.text, h = live.codes.get(key);
        if (h) h.count += c.count; else { live.codes.set(key, { format: c.format, text: c.text, count: c.count }); fresh = true; }
      });
      if (fresh) flash();
      renderLive();
      await sleep(50);
    }
  }

  function flash() {
    var el = $('flash'); el.classList.add('on');
    setTimeout(function () { el.classList.remove('on'); }, 120);
    try { if (navigator.vibrate) navigator.vibrate(30); } catch (e) {}
  }

  function liveDevice() { return Core.buildDevice(Array.from(live.codes.values()), { assetRe: state.assetRe }); }

  function renderLive() {
    var f = cur(); if (!f) return;
    var dev = liveDevice();
    var row = live.target && findRow(f, live.target);
    var type = f.kind !== 'Mixed' ? f.kind : (row && row.type !== 'Other' ? row.type : dev.type);
    var exp = expectedFor(type);
    var shown = exp.concat(Core.FIELD_ORDER.filter(function (k) { return exp.indexOf(k) < 0 && dev[k]; }));
    var got = Core.FIELD_ORDER.filter(function (k) { return dev[k]; }).length;
    $('liveType').textContent = got || f.kind !== 'Mixed' ? type : 'Looking…';
    $('liveType').className = 'badge ' + (type === 'Switch' ? 'Switch' : type === 'AP' ? 'AP' : 'Mixed');
    var ldups = dupsOf(f, row || {}, dev), dupBy = {};
    ldups.forEach(function (d) { dupBy[d.k] = d.where; });
    $('found').innerHTML = shown.map(function (k) {
      var val = dev[k] || (row && row[k] ? row[k] + ' (already saved)' : '');
      var cls = dev[k] ? (dupBy[k] ? 'got dup' : 'got') : 'miss';
      return '<li class="' + cls + '"><span class="k">' + esc(Core.FIELD_LABEL[k]) + '</span><span class="v">' + esc(val || 'not yet') +
        (dev[k] && dupBy[k] ? '<em>Already scanned: ' + esc(dupBy[k].join(', ')) + '</em>' : '') + '</span></li>';
    }).join('');
    var missing = exp.filter(function (k) { return !dev[k] && !(row && row[k]); }).length;
    $('liveMsg').classList.toggle('dup', ldups.length > 0 && live.running);
    $('liveMsg').textContent = !live.running ? 'Starting camera…' :
      ldups.length ? 'Duplicate: this device looks already scanned (' + ldups[0].where.join(', ') + '). Check before saving.' :
      !live.codes.size ? (live.frames > 6 ? 'No barcodes yet. Move closer and hold steady.' : 'Looking for barcodes…') :
      missing ? 'Reading… ' + plural(missing, 'field') + ' to go. Move slowly along the label.' : 'All expected fields read. Tap Save device.';
    $('btnSaveDev').disabled = !got;
    $('btnSaveDev').textContent = got ? 'Save (' + got + ')' : 'Save device';
  }

  function saveLiveDevice() {
    var f = cur(), codes = Array.from(live.codes.values());
    if (!f || !codes.length) return;
    var tid = live.target;
    var row = ingest(f, codes, tid);
    save(); renderFile();
    if (row) {
      var s = summary(row), d = dupsOf(f, row);
      if (d.length) setStatus('Saved, but this is a duplicate: ' + dupText(d) + '.', 'bad');
      else setStatus('Saved. ' + s.text + (tid ? '' : ' Point at the next device.'), s.kind);
    }
    live.codes = new Map(); live.frames = 0;
    if (tid) stopLive(); else renderLive();
  }

  function stopLive() {
    live.running = false;
    if (live.stream) live.stream.getTracks().forEach(function (t) { try { t.stop(); } catch (e) {} });
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
  function showProgress(text, frac) { $('progress').hidden = false; $('progressText').textContent = text; $('progressBar').style.width = Math.round(Math.max(0, Math.min(1, frac)) * 100) + '%'; }
  function hideProgress() { $('progress').hidden = true; $('progressBar').style.width = '0'; }
  function setBusy(b) {
    busy = b;
    var off = b || !decodeFn;
    ['btnLive', 'btnCam', 'btnLib'].forEach(function (id) { $(id).disabled = off; });
    document.querySelectorAll('[data-act="live"],[data-act="photo"]').forEach(function (x) { x.disabled = off; });
  }

  async function handleFiles(files, tid) {
    var f = cur();
    if (!f || !files || !files.length || !decodeFn || busy) return;
    setBusy(true); setStatus('');
    var lastRow = null, added = 0, empty = 0, failed = 0;
    for (var i = 0; i < files.length; i++) {
      var label = 'Photo' + (files.length > 1 ? ' ' + (i + 1) + ' of ' + files.length : '');
      try {
        showProgress(label + ': opening…', 0); await nextFrame();
        var img = await fileToImg(files[i]);
        var codes = await Core.scanImage(img, decodeFn, {
          onProgress: function (d, t, n) { showProgress(label + ': reading · ' + plural(n, 'code') + ' found', d / t); }
        });
        img = null;
        var row = ingest(f, codes, tid);
        if (!row) { empty++; continue; }
        if (!tid) added++;
        lastRow = row;
      } catch (e) { failed++; }
    }
    hideProgress(); save(); renderFile();
    if (lastRow) {
      var s = summary(lastRow);
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
    if (r.view === 'file') { renderFile(); $('fName').value = f.name; $('fSiteIn').value = f.site; }
    if (r.view === 'export') openExport();
    if (changed) window.scrollTo(0, 0);
  }

  /* ---------- rendering: home ---------- */
  function renderHome() {
    var list = state.files.slice().sort(function (a, b) { return a.updated < b.updated ? 1 : a.updated > b.updated ? -1 : 0; });
    $('homeEmpty').hidden = list.length > 0;
    $('homeCount').textContent = list.length ? plural(list.length, 'file') : '';
    $('files').innerHTML = list.map(function (f) {
      var c = counts(f);
      var sub = KIND[f.kind].label + (f.site ? ' · ' + f.site : '') + ' · ' + niceDate(f.updated);
      return '<li><a class="file" href="#/f/' + encodeURIComponent(f.id) + '">' +
        '<span class="ficon ' + f.kind + '">' + ICON[f.kind] + '</span>' +
        '<span class="meta"><span class="name">' + esc(f.name) + '</span><span class="sub">' + esc(sub) + '</span></span>' +
        '<span class="count"><b>' + c.total + '</b><small>' + (c.total === 1 ? 'device' : 'devices') + '</small></span>' + CHEV + '</a></li>';
    }).join('');
  }

  /* ---------- rendering: file ---------- */
  function fieldHtml(row, k) {
    var id = 'f-' + row.id + '-' + k;
    var src = row.edited && row.edited[k] ? '<span class="src">typed</span>' : (row.scanned && row.scanned[k] ? '<span class="src scan">scanned</span>' : '');
    var miss = !row[k] && k !== 'note';
    return '<div class="field' + (miss ? ' missing' : '') + (k === 'note' ? ' note' : '') + '"><label for="' + id + '"><span>' + esc(LABEL[k]) + '</span>' + src + '</label>' +
      '<input id="' + id + '" data-row="' + row.id + '" data-field="' + k + '" value="' + esc(row[k]) + '" placeholder="' + (k === 'note' ? 'Closet, rack, room, anything' : 'Not read') + '"' +
      (k === 'note' ? ' autocapitalize="sentences" style="font-family:var(--font-ui)"' : ' autocapitalize="characters"') + ' autocomplete="off" autocorrect="off" spellcheck="false"></div>';
  }
  function cardHtml(f, row) {
    var exp = expectedFor(row.type), miss = missingOf(row);
    var extra = Core.FIELD_ORDER.filter(function (k) { return exp.indexOf(k) < 0; });
    var h = '<li class="card" data-row="' + row.id + '"><header><span class="num">' + row.n + '</span>' +
      '<span class="ttl"><span class="model' + (row.pid ? '' : ' none') + '">' + esc(row.pid || 'Model not read') + '</span><span class="when">' + esc(row.type === 'Other' ? 'Device' : row.type) + ' · ' + esc(niceDate(row.scannedAt)) + '</span></span>' +
      (f.kind === 'Mixed' ? '<select class="typesel" data-row="' + row.id + '" data-field="type" aria-label="Device type">' +
        Core.TYPES.map(function (t) { return '<option' + (t === row.type ? ' selected' : '') + '>' + t + '</option>'; }).join('') + '</select>' : '') +
      '<span class="state dupchip" hidden>Duplicate</span>' +
      '<span class="state fill ' + (miss.length ? 'warn' : 'ok') + '">' + (miss.length ? miss.length + ' missing' : 'Complete') + '</span></header>' +
      '<div class="dupbox" hidden></div>';
    h += '<div class="fields">' + exp.concat(['note']).map(function (k) { return fieldHtml(row, k); }).join('') + '</div>';
    if (extra.length) h += '<details><summary>More fields (' + extra.length + ')</summary><div class="fields" style="margin-top:8px">' + extra.map(function (k) { return fieldHtml(row, k); }).join('') + '</div></details>';
    if (row.serialAgrees) h += '<p class="note-ok">Serial read the same from two labels.</p>';
    if (row.warnings && row.warnings.length) h += '<ul class="warns">' + row.warnings.map(function (w) { return '<li>' + esc(w) + '</li>'; }).join('') + '</ul>';
    if (row.other && row.other.length) h += '<details class="others"><summary>' + plural(row.other.length, 'other code') + ' not matched to a field</summary><ul>' + row.other.map(function (o) { return '<li>' + esc(o.format) + ': ' + esc(o.text) + '</li>'; }).join('') + '</ul></details>';
    h += '<div class="actions"><button type="button" class="btn small" data-act="live" data-id="' + row.id + '">Scan more</button><button type="button" class="btn small" data-act="photo" data-id="' + row.id + '">Add photo</button><span class="grow"></span><button type="button" class="btn small danger" data-act="del" data-id="' + row.id + '">Delete</button></div></li>';
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
    $('stTotal').textContent = c.total; $('stDone').textContent = c.done; $('stMiss').textContent = c.miss; $('stDup').textContent = c.dup;
    $('bbText').textContent = c.total ? plural(c.total, 'device') + (c.dup ? ' · ' + plural(c.dup, 'duplicate') : '') + (c.miss ? ' · ' + c.miss + ' missing info' : c.dup ? '' : ' · all complete') : 'No devices yet';
    $('btnExport').disabled = !c.total;
    $('devHead').textContent = c.total ? 'Devices (' + c.total + ')' : 'Devices';
  }
  function renderFile() {
    var f = cur(); if (!f) return;
    $('fIcon').className = 'ficon ' + f.kind; $('fIcon').innerHTML = ICON[f.kind];
    $('fBadge').className = 'badge ' + f.kind; $('fBadge').textContent = KIND[f.kind].label;
    $('fSite').textContent = (f.site ? f.site + ' · ' : '') + 'Created ' + niceDate(f.created);
    $('devices').innerHTML = f.rows.slice().reverse().map(function (r) { return cardHtml(f, r); }).join('');
    $('devEmpty').hidden = f.rows.length > 0;
    refreshDups(f); renderStats(f); setBusy(busy);
  }

  /* ---------- export ---------- */
  function presetCols(f, preset) {
    if (preset === 'short') return ['assetTag', 'mac', 'serial'];
    var full = f.kind === 'AP' ? ['assetTag', 'mac', 'serial', 'meraki', 'pid', 'note', 'scannedAt'] :
      f.kind === 'Switch' ? ['assetTag', 'mac', 'serial', 'pid', 'partNo', 'clei', 'note', 'scannedAt'] :
      ['type', 'assetTag', 'mac', 'serial', 'meraki', 'pid', 'partNo', 'clei', 'note', 'scannedAt'];
    if (f.site) full = full.concat(['site']);
    if (f.rows.some(function (r) { return dupsOf(f, r).length; })) full = full.concat(['dup']);
    if (preset === 'custom' && Array.isArray(state.exp.custom)) {
      var pick = state.exp.custom;
      return COLS.map(function (c) { return c[0]; }).filter(function (k) { return pick.indexOf(k) >= 0; });
    }
    return full;
  }
  function exportTable(f) {
    var cols = presetCols(f, state.exp.preset), o = state.exp;
    var merakiSub = o.apSerial === 'meraki' && cols.indexOf('meraki') < 0;
    var sorted = f.rows.slice().sort(function (a, b) { return a.n - b.n; }), dupRows = [];
    var rows = sorted.map(function (r, i) {
      var d = dupsOf(f, r);
      if (d.length) dupRows.push(i);
      return cols.map(function (k) {
        if (k === 'dup') return dupText(d);
        if (k === 'mac') return r.mac ? Core.formatMac(r.mac, o.macStyle) : '';
        if (k === 'serial' && merakiSub && r.type === 'AP' && r.meraki) return r.meraki;
        if (k === 'site') return f.site || '';
        if (k === 'file') return f.name;
        return r[k] == null ? '' : String(r[k]);
      });
    });
    return { cols: cols, header: cols.map(function (k) { return COL_HEAD[k]; }), rows: rows, dupRows: dupRows };
  }
  function toCsv(t) {
    return [t.header].concat(t.rows).map(function (r) { return r.map(Core.csvCell).join(','); }).join('\r\n') + '\r\n';
  }
  function toTsv(t) {
    return [t.header].concat(t.rows).map(function (r) { return r.map(function (v) { return String(v).replace(/[\t\r\n]+/g, ' '); }).join('\t'); }).join('\n');
  }
  function safeName(s) { return String(s || '').replace(/[\\\/:*?"<>|\u0000-\u001f]+/g, '-').replace(/\s+/g, ' ').trim(); }
  function exportName(f) {
    var base = safeName($('exName').value) || safeName(f.name) || 'label-scan';
    return base + '.' + state.exp.format;
  }
  function buildFile(f) {
    var t = exportTable(f), name = exportName(f);
    if (state.exp.format === 'xlsx') return new File([Xlsx.build(f.name, t.header, t.rows, { highlight: t.dupRows })], name, { type: Xlsx.MIME });
    return new File([toCsv(t)], name, { type: 'text/csv' });
  }

  function openExport() {
    var f = cur(); if (!f) return;
    var base = safeName(f.name), today = ymd(new Date());
    $('exName').value = base.indexOf(today) >= 0 ? base : base + ' ' + today;
    $('macStyle').value = state.exp.macStyle; $('apSerial').value = state.exp.apSerial;
    renderExport();
  }
  function renderExport() {
    var f = cur(); if (!f) return;
    var c = counts(f), o = state.exp;
    $('exTotal').textContent = c.total; $('exDone').textContent = c.done; $('exMiss').textContent = c.miss; $('exDup').textContent = c.dup;
    var dupList = f.rows.filter(function (r) { return dupsOf(f, r).length; });
    $('exDupCallout').hidden = !dupList.length;
    $('exDupCallout').textContent = dupList.length ? plural(dupList.length, 'device') + ' look like duplicates: ' +
      dupList.slice(0, 4).map(function (r) { return '#' + r.n + ' (' + dupText(dupsOf(f, r)) + ')'; }).join('; ') + (dupList.length > 4 ? '; and ' + (dupList.length - 4) + ' more' : '') +
      '. They are highlighted in the preview and in the Excel file.' : '';
    var bad = f.rows.filter(function (r) { return missingOf(r).length; });
    var co = $('exCallout');
    co.hidden = !c.total;
    co.className = 'callout' + (bad.length ? '' : ' ok');
    co.textContent = bad.length ?
      plural(bad.length, 'device') + ' missing information: ' + bad.slice(0, 4).map(function (r) { return '#' + r.n + ' (' + missingOf(r).map(function (k) { return Core.FIELD_LABEL[k]; }).join(', ') + ')'; }).join('; ') + (bad.length > 4 ? '; and ' + (bad.length - 4) + ' more.' : '.') + ' You can still export.' :
      'All ' + plural(c.total, 'device') + ' have every expected field.';
    document.querySelectorAll('[data-fmt]').forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset.fmt === o.format)); });
    document.querySelectorAll('[data-preset]').forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset.preset === o.preset)); });
    $('exExt').textContent = '.' + o.format;
    var t = exportTable(f);
    $('colPick').hidden = o.preset !== 'custom';
    if (o.preset === 'custom') {
      $('colPick').innerHTML = COLS.map(function (col) {
        return '<label><input type="checkbox" value="' + col[0] + '"' + (t.cols.indexOf(col[0]) >= 0 ? ' checked' : '') + '>' + esc(col[1]) + '</label>';
      }).join('');
    }
    var hasAP = f.kind === 'AP' || f.rows.some(function (r) { return r.type === 'AP'; });
    $('apSerialWrap').hidden = !(hasAP && t.cols.indexOf('serial') >= 0 && t.cols.indexOf('meraki') < 0);
    $('prevHead').textContent = 'Preview · ' + plural(t.rows.length, 'row') + ', ' + plural(t.cols.length, 'column');
    $('prevTable').innerHTML = !t.cols.length ? '<tr><td class="na">Pick at least one column.</td></tr>' :
      '<thead><tr>' + t.header.map(function (h) { return '<th>' + esc(h) + '</th>'; }).join('') + '</tr></thead><tbody>' +
      (t.rows.length ? t.rows.map(function (r, i) { return '<tr' + (t.dupRows.indexOf(i) >= 0 ? ' class="dup"' : '') + '>' + r.map(function (v) { return v ? '<td>' + esc(v) + '</td>' : '<td class="na">—</td>'; }).join('') + '</tr>'; }).join('') :
        '<tr><td class="na" colspan="' + t.cols.length + '">No devices yet.</td></tr>') + '</tbody>';
    var ok = c.total > 0 && t.cols.length > 0;
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
        await navigator.share({ files: [file], title: file.name, text: f.name + (f.site ? ' (' + f.site + ')' : '') + ': ' + plural(f.rows.length, 'device') + ', exported ' + stamp(new Date()) + '.' });
        setStatus('Shared ' + file.name + '.');
      } catch (e) { if (!e || e.name !== 'AbortError') setStatus('Sharing failed (' + (e && e.message || 'error') + '). Use Download instead.', 'warn'); }
    } else {
      var n = downloadFile();
      setStatus('This browser cannot attach files to a share, so ' + n + ' was downloaded instead.', 'warn');
    }
  }
  async function copyTable() {
    var f = cur(); if (!f) return;
    try { await navigator.clipboard.writeText(toTsv(exportTable(f))); setStatus('Copied. Paste into Excel, Numbers, Sheets or an email.'); }
    catch (e) { setStatus('Copy is blocked in this browser. Use Download or Email instead.', 'warn'); }
  }

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
    var f = newFile(name, $('newSite').value.trim(), selectedKind());
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
  $('btnResetDev').addEventListener('click', function () { live.codes = new Map(); live.frames = 0; renderLive(); });
  $('btnStop').addEventListener('click', stopLive);
  $('btnTorch').addEventListener('click', function () {
    var on = !this.dataset.on; this.dataset.on = on ? '1' : '';
    this.textContent = on ? 'Light off' : 'Light';
    if (live.track) live.track.applyConstraints({ advanced: [{ torch: on }] }).catch(function () {});
  });
  $('zoom').addEventListener('input', function () {
    if (live.track) live.track.applyConstraints({ advanced: [{ zoom: Number(this.value) }] }).catch(function () {});
  });
  document.addEventListener('visibilitychange', function () {
    if (document.hidden && live.running) { stopLive(); setStatus('Camera closed while the app was in the background. Codes not saved were cleared.', 'warn'); }
  });

  $('fName').addEventListener('change', function (e) {
    var f = cur(); if (!f) return;
    var v = e.target.value.trim(); if (!v) { e.target.value = f.name; return; }
    f.name = v; touch(f); save(); $('title').textContent = v;
  });
  $('fSiteIn').addEventListener('change', function (e) { var f = cur(); if (!f) return; f.site = e.target.value.trim(); touch(f); save(); renderFile(); });
  $('btnDelFile').addEventListener('click', function (e) {
    var f = cur(); if (!f) return;
    twoStep(e.target, 'delfile', 'Delete this file', function () {
      state.files = state.files.filter(function (x) { return x.id !== f.id; }); save();
      location.replace('#/'); setStatus('Deleted ' + f.name + '.');
    });
  });

  $('btnExport').addEventListener('click', function () { var f = cur(); if (f && f.rows.length) go('#/f/' + encodeURIComponent(f.id) + '/export'); });
  document.querySelectorAll('[data-fmt]').forEach(function (b) { b.addEventListener('click', function () { state.exp.format = b.dataset.fmt; save(); renderExport(); }); });
  document.querySelectorAll('[data-preset]').forEach(function (b) {
    b.addEventListener('click', function () {
      var f = cur();
      if (b.dataset.preset === 'custom' && !Array.isArray(state.exp.custom) && f) state.exp.custom = presetCols(f, state.exp.preset);
      state.exp.preset = b.dataset.preset; save(); renderExport();
    });
  });
  $('colPick').addEventListener('change', function () {
    state.exp.custom = Array.prototype.map.call($('colPick').querySelectorAll('input:checked'), function (i) { return i.value; });
    save(); renderExport();
  });
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
    row.edited = row.edited || {}; row.edited[k] = true;
    touch(f); save(); renderStats(f);
  });
  $('devices').addEventListener('change', function (e) {
    var t = e.target; if (!t.dataset || !t.dataset.field) return;
    var f = cur(), row = findRow(f, t.dataset.row); if (!row) return;
    if (t.dataset.field === 'type') { row.type = t.value; save(); renderFile(); return; }
    if (t.dataset.field === 'mac') { var n = Core.normalizeMac(t.value); if (n) { row.mac = n; t.value = n; save(); } }
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
    if (b.dataset.act === 'photo') { targetId = id; $('inCam').click(); }
    if (b.dataset.act === 'del') twoStep(b, 'del' + id, 'Delete', function () { f.rows = f.rows.filter(function (r) { return r.id !== id; }); touch(f); save(); renderFile(); });
  });

  window.addEventListener('hashchange', onRoute);

  /* ---------- boot ---------- */
  load();
  $('assetRe').value = state.assetRe;
  onRoute();
  initDecoder();
})();
