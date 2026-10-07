/* Label Scanner app: live camera scan, photo scan, device list, CSV export. */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var Core = window.Core;
  var LABEL = Object.assign({ note: 'Note' }, Core.FIELD_LABEL);
  var STORE = 'labelscanner.v2';

  var state = { rows: [], template: 'full', macStyle: 'colons', apSerial: 'cisco', assetRe: Core.DEFAULT_ASSET_RE, seq: 0 };
  var busy = false, targetId = null, decodeFn = null;

  /* ---------- storage ---------- */
  function load() {
    try {
      var s = JSON.parse(localStorage.getItem(STORE) || 'null');
      if (s && typeof s === 'object') {
        ['template', 'macStyle', 'apSerial', 'assetRe'].forEach(function (k) { if (typeof s[k] === 'string') state[k] = s[k]; });
        if (Array.isArray(s.rows)) { state.rows = s.rows; state.seq = s.seq || s.rows.length; }
      }
    } catch (e) {}
  }
  function save() { try { localStorage.setItem(STORE, JSON.stringify(state)); } catch (e) {} }

  /* ---------- helpers ---------- */
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function stamp(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()); }
  function fileStamp(d) { return d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + '-' + pad(d.getHours()) + pad(d.getMinutes()); }
  function setStatus(msg, kind) { var s = $('status'); s.hidden = !msg; s.textContent = msg || ''; s.dataset.kind = kind || ''; }
  function setPill(text, kind) { var p = $('decoderPill'); p.textContent = text; p.dataset.kind = kind || ''; }
  function plural(n, w) { return n + ' ' + w + (n === 1 ? '' : 's'); }
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function nextFrame() { return new Promise(function (r) { requestAnimationFrame(function () { r(); }); }); }
  function csvName() { return 'label-scan-' + fileStamp(new Date()) + '.csv'; }
  function currentCsv() { return Core.toCsv(state.rows, state.template, { macStyle: state.macStyle, apSerial: state.apSerial }); }
  function expectedFor(type) { return Core.EXPECTED[type] || Core.EXPECTED.Other; }

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
      setPill('Decoder ready', 'ok');
    } catch (e) {
      decodeFn = null;
      setPill('Decoder failed', 'bad');
      setStatus('The barcode decoder could not load (' + (e && e.message || 'unknown error') + '). You can still add devices by hand.', 'bad');
    }
    setBusy(busy);
  }

  /* ---------- rows ---------- */
  function newRow(dev) {
    state.seq += 1;
    return {
      id: 'd' + Date.now().toString(36) + state.seq, n: state.seq, type: dev.type || 'Other',
      assetTag: dev.assetTag || '', mac: dev.mac || '', serial: dev.serial || '', meraki: dev.meraki || '', pid: dev.pid || '', partNo: dev.partNo || '', clei: dev.clei || '',
      note: '', scannedAt: stamp(new Date()), warnings: dev.warnings || [], other: dev.other || [], serialAgrees: !!dev.serialAgrees,
      scanned: {}, edited: {}
    };
  }
  /* codes -> new device, or merged into the device with id tid. Returns the row or null. */
  function ingest(codes, tid) {
    var dev = Core.buildDevice(codes, { assetRe: state.assetRe });
    var got = Core.FIELD_ORDER.filter(function (f) { return dev[f]; }).length;
    if (!got && !dev.other.length) return null;
    var row = tid && state.rows.find(function (r) { return r.id === tid; });
    if (row) Core.mergeDevice(row, dev);
    else { row = newRow(dev); state.rows.push(row); }
    Core.FIELD_ORDER.forEach(function (f) { if (dev[f] && row[f] === dev[f]) row.scanned[f] = true; });
    return row;
  }
  function summary(row) {
    var exp = expectedFor(row.type);
    var missing = exp.filter(function (f) { return !row[f]; }).map(function (f) { return Core.FIELD_LABEL[f]; });
    return { text: row.type + ' #' + row.n + ': ' + (exp.length - missing.length) + ' of ' + exp.length + ' fields' + (missing.length ? '. Missing: ' + missing.join(', ') + '.' : '.'), kind: missing.length ? 'warn' : '' };
  }

  /* ---------- live camera ---------- */
  var live = { stream: null, track: null, running: false, codes: new Map(), target: null, frames: 0, canvas: null };

  async function startLive(tid) {
    if (live.running || !decodeFn) return;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setStatus('This browser cannot open the camera here. Open the app from its https:// GitHub Pages address in Safari, or use Take photo.', 'bad');
      return;
    }
    live.target = tid || null; live.codes = new Map(); live.frames = 0;
    $('liveTitle').textContent = live.target ? 'Adding to device #' + (state.rows.find(function (r) { return r.id === live.target; }) || {}).n : 'Live scan';
    $('scanPanel').hidden = true; $('livePanel').hidden = false; $('exportPanel').hidden = true;
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
    $('btnTorch').hidden = !caps.torch; $('btnTorch').dataset.on = '';
    if (caps.zoom && caps.zoom.max > caps.zoom.min) {
      var z = $('zoom'); z.min = caps.zoom.min; z.max = Math.min(caps.zoom.max, 6); z.step = caps.zoom.step || 0.1;
      var cur = (live.track.getSettings && live.track.getSettings().zoom) || caps.zoom.min; z.value = cur;
      $('zoomWrap').hidden = false;
    } else $('zoomWrap').hidden = true;
  }

  async function liveLoop() {
    var v = $('video');
    if (!live.canvas) live.canvas = document.createElement('canvas');
    var ctx = live.canvas.getContext('2d', { willReadFrequently: true });
    while (live.running) {
      if (v.readyState < 2 || !v.videoWidth) { await sleep(100); continue; }
      var vw = v.videoWidth, vh = v.videoHeight, f = Math.min(1, 1920 / Math.max(vw, vh));
      var cw = Math.round(vw * f), ch = Math.round(vh * f);
      if (live.canvas.width !== cw || live.canvas.height !== ch) { live.canvas.width = cw; live.canvas.height = ch; }
      ctx.drawImage(v, 0, 0, cw, ch);
      var img = ctx.getImageData(0, 0, cw, ch);
      var list = [];
      try { list = await Core.scanImage({ data: img.data, width: cw, height: ch }, decodeFn, { noTiles: true }); } catch (e) {}
      if (!live.running) break;
      live.frames++; live.dims = cw + 'x' + ch;
      var fresh = false;
      list.forEach(function (c) {
        var k = c.format + '|' + c.text, h = live.codes.get(k);
        if (h) h.count += c.count; else { live.codes.set(k, { format: c.format, text: c.text, count: c.count }); fresh = true; }
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
    var dev = liveDevice();
    var row = live.target && state.rows.find(function (r) { return r.id === live.target; });
    var type = row && row.type !== 'Other' ? row.type : dev.type;
    var exp = expectedFor(type);
    var shown = exp.concat(Core.FIELD_ORDER.filter(function (f) { return exp.indexOf(f) < 0 && dev[f]; }));
    var got = Core.FIELD_ORDER.filter(function (f) { return dev[f]; }).length;
    $('liveType').textContent = got ? type : 'Looking…';
    $('found').innerHTML = shown.map(function (f) {
      var val = dev[f] || (row && row[f] ? row[f] + ' (already saved)' : '');
      var cls = dev[f] ? 'got' : 'miss';
      return '<li class="' + cls + '"><span class="k">' + esc(Core.FIELD_LABEL[f]) + '</span><span class="v">' + esc(val || 'not yet') + '</span></li>';
    }).join('');
    var missing = exp.filter(function (f) { return !dev[f] && !(row && row[f]); }).length;
    $('liveMsg').textContent = !live.running ? 'Starting camera…' :
      !live.codes.size ? (live.frames > 6 ? 'No barcodes yet. Move closer and hold steady.' : 'Looking for barcodes…') :
      missing ? 'Reading… ' + plural(missing, 'field') + ' to go. Move slowly along the label.' : 'All expected fields read. Tap Save device.';
    $('btnSaveDev').disabled = !got;
    $('btnSaveDev').textContent = got ? 'Save device (' + got + ')' : 'Save device';
  }

  function saveLiveDevice() {
    var codes = Array.from(live.codes.values());
    if (!codes.length) return;
    var tid = live.target;
    var row = ingest(codes, tid);
    save(); renderAll();
    if (row) { var s = summary(row); setStatus('Saved. ' + s.text + (tid ? '' : ' Point at the next device.'), s.kind); }
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
  }

  /* ---------- photos ---------- */
  async function fileToImg(file) {
    var url = URL.createObjectURL(file);
    try {
      var im = new Image(); im.decoding = 'async'; im.src = url; await im.decode();
      var w = im.naturalWidth, h = im.naturalHeight, f = Math.min(1, 3000 / Math.max(w, h));
      var cw = Math.max(1, Math.round(w * f)), ch = Math.max(1, Math.round(h * f));
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
    if (!files || !files.length || !decodeFn || busy) return;
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
        var row = ingest(codes, tid);
        if (!row) { empty++; continue; }
        if (!tid) added++;
        lastRow = row;
      } catch (e) { failed++; }
    }
    hideProgress(); save(); renderAll();
    if (lastRow) {
      var s = summary(lastRow);
      setStatus((added > 1 ? plural(added, 'device') + ' added. Last: ' : '') + s.text + (s.kind ? ' Scan again from a bit closer, or type it in.' : ''), s.kind);
      var el = document.querySelector('li[data-row="' + lastRow.id + '"]'); if (el) el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    } else if (failed) setStatus('Could not open that photo. Try again, or pick a JPEG.', 'bad');
    else if (empty) setStatus('No barcodes found. Move closer, keep the labels flat to the camera, and avoid glare.', 'warn');
    setBusy(false); targetId = null;
  }

  /* ---------- rendering ---------- */
  function fieldHtml(row, f) {
    var id = 'f-' + row.id + '-' + f;
    var src = row.edited && row.edited[f] ? '<span class="src">typed</span>' : (row.scanned && row.scanned[f] ? '<span class="src scan">scanned</span>' : '');
    var miss = !row[f] && f !== 'note';
    return '<div class="field' + (miss ? ' missing' : '') + '"><label for="' + id + '"><span>' + esc(LABEL[f]) + '</span>' + src + '</label>' +
      '<input id="' + id + '" data-row="' + row.id + '" data-field="' + f + '" value="' + esc(row[f]) + '" placeholder="' + (f === 'note' ? 'Closet, rack, anything' : 'not read') + '"' +
      (f === 'note' ? ' autocapitalize="sentences" style="font-family:var(--font-ui)"' : ' autocapitalize="characters"') + ' autocomplete="off" autocorrect="off" spellcheck="false"></div>';
  }
  function cardHtml(row) {
    var exp = expectedFor(row.type);
    var extra = Core.FIELD_ORDER.filter(function (f) { return exp.indexOf(f) < 0; });
    var h = '<li class="card" data-row="' + row.id + '"><header>' +
      '<select class="typesel" data-row="' + row.id + '" data-field="type" aria-label="Device type">' +
      Core.TYPES.map(function (t) { return '<option' + (t === row.type ? ' selected' : '') + '>' + t + '</option>'; }).join('') + '</select>' +
      '<span class="model">' + esc(row.pid || 'Device') + '</span><span class="num">#' + row.n + ' · ' + esc((row.scannedAt || '').slice(11)) + '</span></header>';
    h += '<div class="fields">' + exp.concat(['note']).map(function (f) { return fieldHtml(row, f); }).join('') + '</div>';
    if (extra.length) h += '<details><summary>More fields (' + extra.length + ')</summary><div class="fields" style="margin-top:8px">' + extra.map(function (f) { return fieldHtml(row, f); }).join('') + '</div></details>';
    if (row.serialAgrees) h += '<p class="note-ok">Serial read the same from two labels.</p>';
    if (row.warnings && row.warnings.length) h += '<ul class="warns">' + row.warnings.map(function (w) { return '<li>' + esc(w) + '</li>'; }).join('') + '</ul>';
    if (row.other && row.other.length) h += '<details class="others"><summary>' + plural(row.other.length, 'other code') + ' not matched to a field</summary><ul>' + row.other.map(function (o) { return '<li>' + esc(o.format) + ': ' + esc(o.text) + '</li>'; }).join('') + '</ul></details>';
    h += '<div class="actions"><button type="button" class="btn small" data-act="live" data-id="' + row.id + '">Scan more</button><button type="button" class="btn small" data-act="photo" data-id="' + row.id + '">Add photo</button><span class="grow"></span><button type="button" class="btn small danger" data-act="del" data-id="' + row.id + '">Delete</button></div></li>';
    return h;
  }
  function renderAll() {
    var n = state.rows.length;
    $('devices').innerHTML = state.rows.slice().reverse().map(cardHtml).join('');
    $('empty').hidden = n > 0;
    $('btnClear').hidden = !n;
    $('finishBar').hidden = !n;
    $('finishCount').textContent = plural(n, 'device') + ' scanned';
    $('devHead').textContent = n ? 'Devices (' + n + ')' : 'Devices';
    if (!n) $('exportPanel').hidden = true;
    renderExport(); setBusy(busy);
  }
  function renderExport() {
    $('tplFull').setAttribute('aria-pressed', String(state.template === 'full'));
    $('tplShort').setAttribute('aria-pressed', String(state.template === 'short'));
    $('apSerial').disabled = state.template !== 'short';
    ['btnShare', 'btnDownload', 'btnCopy'].forEach(function (id) { $(id).disabled = !state.rows.length; });
    $('csvPreview').textContent = state.rows.length ? currentCsv() : '(nothing to export yet)';
  }

  /* ---------- export ---------- */
  function downloadCsv() {
    var name = csvName(), blob = new Blob([currentCsv()], { type: 'text/csv' }), url = URL.createObjectURL(blob);
    var a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
    setStatus('Downloaded ' + name + '.');
  }
  async function shareCsv() {
    var name = csvName(), file = new File([currentCsv()], name, { type: 'text/csv' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: name, text: plural(state.rows.length, 'device') + ' scanned ' + stamp(new Date()) + '.' });
        setStatus('Shared ' + name + '.');
      } catch (e) { if (!e || e.name !== 'AbortError') setStatus('Sharing failed (' + (e && e.message || 'error') + '). Use Download CSV instead.', 'warn'); }
    } else {
      downloadCsv();
      setStatus('This browser cannot attach files to a share. The CSV was downloaded instead.', 'warn');
    }
  }
  async function copyCsv() {
    try { await navigator.clipboard.writeText(currentCsv()); setStatus('CSV copied. Paste it into Notes, Mail or a spreadsheet.'); }
    catch (e) { $('previewBox').open = true; setStatus('Copy is blocked here. Press and hold the preview to select the text.', 'warn'); }
  }

  /* ---------- events ---------- */
  var armed = {};
  function twoStep(btn, key, label, run) {
    if (armed[key]) { clearTimeout(armed[key].t); delete armed[key]; btn.textContent = label; run(); return; }
    armed[key] = { t: setTimeout(function () { btn.textContent = label; delete armed[key]; }, 3000) };
    btn.textContent = 'Tap again to confirm';
  }
  function onFiles(e) { var f = Array.prototype.slice.call(e.target.files || []); e.target.value = ''; handleFiles(f, targetId); }

  $('btnLive').addEventListener('click', function () { startLive(null); });
  $('btnCam').addEventListener('click', function () { targetId = null; $('inCam').click(); });
  $('btnLib').addEventListener('click', function () { targetId = null; $('inLib').click(); });
  $('inCam').addEventListener('change', onFiles);
  $('inLib').addEventListener('change', onFiles);
  $('btnManual').addEventListener('click', function () {
    var row = newRow({}); state.rows.push(row); save(); renderAll();
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

  $('btnFinish').addEventListener('click', function () {
    if (live.running) stopLive();
    $('exportPanel').hidden = false; $('macStyle').value = state.macStyle; $('apSerial').value = state.apSerial; renderExport();
    $('exportPanel').scrollIntoView({ block: 'start', behavior: 'smooth' });
  });
  $('btnBack').addEventListener('click', function () { $('exportPanel').hidden = true; window.scrollTo({ top: 0, behavior: 'smooth' }); });
  $('tplFull').addEventListener('click', function () { state.template = 'full'; save(); renderExport(); });
  $('tplShort').addEventListener('click', function () { state.template = 'short'; save(); renderExport(); });
  $('macStyle').addEventListener('change', function (e) { state.macStyle = e.target.value; save(); renderExport(); });
  $('apSerial').addEventListener('change', function (e) { state.apSerial = e.target.value; save(); renderExport(); });
  $('assetRe').addEventListener('change', function (e) {
    try { new RegExp(e.target.value); state.assetRe = e.target.value; setStatus('Asset tag pattern saved. It applies to the next scan.'); }
    catch (x) { setStatus('That pattern is not a valid regular expression.', 'warn'); e.target.value = state.assetRe; }
    save();
  });
  $('btnShare').addEventListener('click', shareCsv);
  $('btnDownload').addEventListener('click', downloadCsv);
  $('btnCopy').addEventListener('click', copyCsv);
  $('btnClear').addEventListener('click', function (e) {
    twoStep(e.target, 'clear', 'Clear all', function () { state.rows = []; save(); renderAll(); setStatus('Cleared.'); });
  });

  $('devices').addEventListener('input', function (e) {
    var t = e.target; if (!t.dataset || !t.dataset.field || t.dataset.field === 'type') return;
    var row = state.rows.find(function (r) { return r.id === t.dataset.row; }); if (!row) return;
    var f = t.dataset.field;
    row[f] = f === 'note' ? t.value : t.value.trim();
    row.edited = row.edited || {}; row.edited[f] = true;
    save(); renderExport();
  });
  $('devices').addEventListener('change', function (e) {
    var t = e.target; if (!t.dataset || !t.dataset.field) return;
    var row = state.rows.find(function (r) { return r.id === t.dataset.row; }); if (!row) return;
    if (t.dataset.field === 'type') { row.type = t.value; save(); renderAll(); return; }
    if (t.dataset.field === 'mac') { var n = Core.normalizeMac(t.value); if (n) { row.mac = n; t.value = n; save(); renderExport(); } }
  });
  $('devices').addEventListener('click', function (e) {
    var b = e.target.closest('button[data-act]'); if (!b) return;
    var id = b.dataset.id;
    if (b.dataset.act === 'live') startLive(id);
    if (b.dataset.act === 'photo') { targetId = id; $('inCam').click(); }
    if (b.dataset.act === 'del') twoStep(b, 'del' + id, 'Delete', function () { state.rows = state.rows.filter(function (r) { return r.id !== id; }); save(); renderAll(); });
  });

  /* ---------- boot ---------- */
  load();
  $('macStyle').value = state.macStyle; $('apSerial').value = state.apSerial; $('assetRe').value = state.assetRe;
  renderAll();
  initDecoder();
})();
