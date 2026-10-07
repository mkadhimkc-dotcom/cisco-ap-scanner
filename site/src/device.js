/* Build a device record from decoded codes, and merge later scans into it. */
import { FIELD_ORDER, FIELD_LABEL, classify, detectType, unsymbol } from './classify.js';
import { splitPid } from './validate.js';

/* Confidence of a field value:
   confirmed = two or more agreeing reads (frames, photo passes or separate scans) or a cross-check
   single    = read once
   manual    = typed by hand */
export const CONF = { confirmed: 'confirmed', single: 'single', manual: 'manual' };

/* codes -> device record. Majority value wins per field (votes = summed code counts, i.e. frames or passes
   that read it); conflicts become warnings. */
export function buildDevice(codes, opts) {
  const votes = {}, serialBy = { dm: new Set(), linear: new Set() }; const other = [];
  for (const c of codes) {
    const hit = classify(c, opts);
    if (!hit.length) { other.push({ format: c.format, text: unsymbol(c.text).replace(/[\u0000-\u001f]/g, '·'), count: c.count }); continue; }
    for (const h of hit) {
      const m = votes[h.field] || (votes[h.field] = new Map());
      m.set(h.value, (m.get(h.value) || 0) + c.count);
      if (h.field === 'serial') serialBy[h.src === 'dm' ? 'dm' : 'linear'].add(h.value);
    }
  }
  const dev = { assetTag: '', mac: '', serial: '', meraki: '', pid: '', partNo: '', clei: '', hwRev: '', type: 'Other', warnings: [], other, votes: {}, conf: {} };
  for (const f of FIELD_ORDER) {
    const m = votes[f]; if (!m) continue;
    const ranked = Array.from(m.entries()).sort((a, b) => b[1] - a[1]);
    dev[f] = ranked[0][0];
    dev.votes[f] = ranked[0][1];   // reads that agree with the kept value
    if (ranked.length > 1)
      dev.warnings.push(FIELD_LABEL[f] + ': found ' + ranked.map(r => r[0]).join(' and ') + '. Kept ' + ranked[0][0] + '.');
  }
  dev.type = detectType(dev);
  dev.hwRev = splitPid(dev.pid).rev;
  // serial cross-check: Code128 label vs Data Matrix
  const serials = codes.flatMap(c => classify(c, opts).filter(h => h.field === 'serial').map(h => h.value));
  dev.serialAgrees = new Set(serials).size === 1 && serials.length >= 2;
  dev.serialMismatch = serialBy.dm.size && serialBy.linear.size && [...serialBy.dm].some(v => !serialBy.linear.has(v))
    ? { label: [...serialBy.linear].join(', '), matrix: [...serialBy.dm].join(', ') } : null;
  for (const f of FIELD_ORDER) if (dev[f])
    dev.conf[f] = dev.votes[f] >= 2 || (f === 'serial' && dev.serialAgrees) ? CONF.confirmed : CONF.single;
  if (dev.hwRev) dev.conf.hwRev = dev.conf.pid;
  return dev;
}

/* Fill empty fields of an existing row from a new scan; a matching value upgrades it to confirmed;
   disagreements become warnings. */
export function mergeDevice(row, dev) {
  row.warnings = row.warnings || [];
  row.conf = row.conf || {};
  for (const f of FIELD_ORDER) {
    if (!dev[f]) continue;
    if (!row[f]) { row[f] = dev[f]; row.conf[f] = dev.conf && dev.conf[f] || CONF.single; }
    else if (row[f] === dev[f]) { if (row.conf[f] !== CONF.manual) row.conf[f] = CONF.confirmed; }
    else row.warnings.push(FIELD_LABEL[f] + ': a new photo read ' + dev[f] + ' (kept ' + row[f] + ').');
  }
  if (!row.hwRev && row.pid) { row.hwRev = splitPid(row.pid).rev; if (row.hwRev) row.conf.hwRev = row.conf.pid; }
  if ((!row.type || row.type === 'Other') && dev.type) row.type = dev.type;
  row.other = (row.other || []).concat(dev.other || []);
  row.warnings = row.warnings.concat(dev.warnings || []);
  row.serialAgrees = row.serialAgrees || dev.serialAgrees;
  row.serialMismatch = row.serialMismatch || dev.serialMismatch || null;
  row.photos = (row.photos || 1) + 1;
  return row;
}

/* "Merge into…": fold device `src` into `dst` (the one that is kept). Empty fields are filled, equal values
   become confirmed, different values stay as in dst with a warning. Notes are joined. */
export function mergeRows(dst, src) {
  dst.conf = dst.conf || {}; dst.warnings = dst.warnings || [];
  for (const f of FIELD_ORDER.concat(['hwRev'])) {
    if (!src[f]) continue;
    const sc = src.conf && src.conf[f];
    if (!dst[f]) { dst[f] = src[f]; dst.conf[f] = sc || CONF.single; }
    else if (dst[f] === src[f]) { if (dst.conf[f] !== CONF.manual) dst.conf[f] = sc === CONF.manual ? CONF.manual : CONF.confirmed; }
    else dst.warnings.push('Merged: ' + (FIELD_LABEL[f] || f) + ' kept ' + dst[f] + ' (the other device had ' + src[f] + ').');
  }
  if (src.note) dst.note = dst.note ? dst.note + '; ' + src.note : src.note;
  if ((!dst.type || dst.type === 'Other') && src.type) dst.type = src.type;
  dst.other = (dst.other || []).concat(src.other || []);
  dst.warnings = dst.warnings.concat(src.warnings || []);
  dst.serialAgrees = dst.serialAgrees || src.serialAgrees;
  dst.serialMismatch = dst.serialMismatch || src.serialMismatch || null;
  return dst;
}
