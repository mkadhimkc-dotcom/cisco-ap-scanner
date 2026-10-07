/* Build a device record from decoded codes, and merge later scans into it. */
import { FIELD_ORDER, FIELD_LABEL, classify, detectType, unsymbol } from './classify.js';

/* codes -> device record. Majority value wins per field (votes = summed code counts, i.e. frames or passes
   that read it); conflicts become warnings. */
export function buildDevice(codes, opts) {
  const votes = {}; const other = [];
  for (const c of codes) {
    const hit = classify(c, opts);
    if (!hit.length) { other.push({ format: c.format, text: unsymbol(c.text).replace(/[\u0000-\u001f]/g, '·'), count: c.count }); continue; }
    for (const h of hit) {
      const m = votes[h.field] || (votes[h.field] = new Map());
      m.set(h.value, (m.get(h.value) || 0) + c.count);
    }
  }
  const dev = { assetTag: '', mac: '', serial: '', meraki: '', pid: '', partNo: '', clei: '', type: 'Other', warnings: [], other: other, votes: {} };
  for (const f of FIELD_ORDER) {
    const m = votes[f]; if (!m) continue;
    const ranked = Array.from(m.entries()).sort((a, b) => b[1] - a[1]);
    dev[f] = ranked[0][0];
    dev.votes[f] = ranked[0][1];   // reads that agree with the kept value
    if (ranked.length > 1)
      dev.warnings.push(FIELD_LABEL[f] + ': found ' + ranked.map(r => r[0]).join(' and ') + '. Kept ' + ranked[0][0] + '.');
  }
  dev.type = detectType(dev);
  // serial cross-check: Code128 label vs Data Matrix
  const serials = codes.flatMap(c => classify(c, opts).filter(h => h.field === 'serial').map(h => h.value));
  dev.serialAgrees = new Set(serials).size === 1 && serials.length >= 2;
  return dev;
}

/* Fill empty fields of an existing row from a new scan; report disagreements. */
export function mergeDevice(row, dev) {
  row.warnings = row.warnings || [];
  for (const f of FIELD_ORDER) {
    if (!dev[f]) continue;
    if (!row[f]) row[f] = dev[f];
    else if (row[f] !== dev[f]) row.warnings.push(FIELD_LABEL[f] + ': a new photo read ' + dev[f] + ' (kept ' + row[f] + ').');
  }
  if ((!row.type || row.type === 'Other') && dev.type) row.type = dev.type;
  row.other = (row.other || []).concat(dev.other || []);
  row.warnings = row.warnings.concat(dev.warnings || []);
  row.serialAgrees = row.serialAgrees || dev.serialAgrees;
  row.photos = (row.photos || 1) + 1;
  return row;
}
