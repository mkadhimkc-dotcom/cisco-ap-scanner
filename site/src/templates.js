/* Export templates: which columns, in what order, under which header names.
   Built-ins: the two original CSV templates (unchanged) and a Snipe-IT preset. Users can save their own. */
import { formatMac } from './classify.js';
import { TEMPLATES as CSV_TEMPLATES } from './csv.js';
import { splitPid } from './validate.js';

/* Every column a template can use: key -> {label (shown in the editor), header (default), get(row, file, opts)} */
export const COLUMNS = {
  type: { label: 'Type', header: 'Type' },
  assetTag: { label: 'Asset tag', header: 'Asset Tag' },
  mac: { label: 'MAC address', header: 'MAC Address', get: (r, f, o) => r.mac ? formatMac(r.mac, o.macStyle) : '' },
  serial: { label: 'Serial number', header: 'Serial Number', get: (r, f, o) => o.apSerial === 'meraki' && r.type === 'AP' && r.meraki ? r.meraki : r.serial || '' },
  meraki: { label: 'Meraki serial', header: 'Meraki Serial' },
  pid: { label: 'Model (full PID)', header: 'Model (PID)' },
  model: { label: 'Model without revision', header: 'Model', get: r => splitPid(r.pid).base },
  hwRev: { label: 'Hardware rev', header: 'Hardware Rev', get: r => r.hwRev || splitPid(r.pid).rev },
  partNo: { label: 'Part number', header: 'Part Number' },
  clei: { label: 'CLEI', header: 'CLEI' },
  note: { label: 'Note', header: 'Note' },
  scannedAt: { label: 'Scanned at', header: 'Scanned At' },
  location: { label: 'Location (file)', header: 'Location', get: (r, f) => f.location || '' },
  rack: { label: 'Rack/U (file)', header: 'Rack/U', get: (r, f) => f.rack || '' },
  file: { label: 'File name', header: 'File', get: (r, f) => f.name || '' },
  dup: { label: 'Duplicate of', header: 'Duplicate Of', get: (r, f, o) => (o.dupText ? o.dupText(r) : '') }
};
export const COLUMN_KEYS = Object.keys(COLUMNS);

/* The original templates, column for column (do not change: other tools import these files). */
export const BUILTIN = [
  { id: 'full', name: 'All fields', builtin: true, cols: CSV_TEMPLATES.full.cols.map(([header, key]) => ({ key, header })) },
  { id: 'short', name: 'Asset tag, MAC, serial', builtin: true, apSerialOption: true, cols: CSV_TEMPLATES.short.cols.map(([header, key]) => ({ key, header })) },
  /* Snipe-IT asset import. Header names follow the importer's usual field names (it maps by header name and
     lets you adjust the mapping on import). MAC Address is a custom field in Snipe-IT's default fieldsets. */
  { id: 'snipeit', name: 'Snipe-IT import', builtin: true, cols: [
    { key: 'assetTag', header: 'Asset Tag' }, { key: 'serial', header: 'Serial Number' }, { key: 'pid', header: 'Model Name' },
    { key: 'mac', header: 'MAC Address' }, { key: 'location', header: 'Location' }, { key: 'note', header: 'Notes' }
  ] }
];

export function allTemplates(custom) { return BUILTIN.concat(Array.isArray(custom) ? custom : []); }
export function findTemplate(id, custom) { return allTemplates(custom).find(t => t.id === id) || BUILTIN[0]; }

/* A new custom template starts from the full template plus the file's Location and Rack/U. */
export function newTemplate(name) {
  return {
    id: 't' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), name: name || 'My template',
    cols: BUILTIN[0].cols.map(c => ({ ...c })).concat([{ key: 'location', header: 'Location' }, { key: 'rack', header: 'Rack/U' }])
  };
}

/* Keep only known columns, give every column a header, drop repeats of the same column. */
export function cleanTemplate(t) {
  const seen = new Set();
  const cols = (t.cols || []).filter(c => COLUMNS[c.key] && !seen.has(c.key) && seen.add(c.key))
    .map(c => ({ key: c.key, header: String(c.header || '').trim() || COLUMNS[c.key].header }));
  return { id: t.id, name: String(t.name || '').trim() || 'My template', cols };
}

/* rows of one file -> {header: [..], rows: [[..]]} of strings.
   opts: {macStyle, apSerial ('cisco'|'meraki', only honoured by templates with apSerialOption), dupText(row)} */
export function buildTable(template, file, rows, opts = {}) {
  const o = Object.assign({}, opts, { apSerial: template.apSerialOption ? opts.apSerial : 'cisco' });
  return {
    header: template.cols.map(c => c.header),
    rows: rows.map(r => template.cols.map(c => {
      const col = COLUMNS[c.key];
      const v = col && col.get ? col.get(r, file, o) : r[c.key];
      return v == null ? '' : String(v);
    }))
  };
}

/* JSON of a whole file for scripting: every field, independent of the chosen template. */
export function fileJson(file, opts = {}) {
  return {
    format: 'label-scanner/file', version: 1, exportedAt: opts.now || new Date().toISOString(), app: opts.app || 'Label Scanner',
    file: { name: file.name, kind: file.kind, location: file.location || '', rack: file.rack || '', created: file.created, updated: file.updated },
    devices: file.rows.map((r, i) => ({
      n: i + 1, type: r.type, assetTag: r.assetTag || '', mac: r.mac ? formatMac(r.mac, 'colons') : '', serial: r.serial || '',
      meraki: r.meraki || '', pid: r.pid || '', hwRev: r.hwRev || splitPid(r.pid).rev, partNo: r.partNo || '', clei: r.clei || '',
      note: r.note || '', scannedAt: r.scannedAt || '', confidence: Object.assign({}, r.conf || {}),
      warnings: (r.warnings || []).slice(), serialMismatch: r.serialMismatch || null
    }))
  };
}

/* label-scan_<session>_<YYYY-MM-DD>.<ext> with the session name made file-safe */
export function exportFileName(sessionName, date, ext) {
  const slug = String(sessionName || '').normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9._-]+/g, '-').replace(/-+/g, '-').replace(/^[-.]+|[-.]+$/g, '') || 'session';
  const d = date instanceof Date ? date : new Date(date);
  const ymd = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  return 'label-scan_' + slug + '_' + ymd + '.' + ext;
}
