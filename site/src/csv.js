/* CSV export: the two built-in templates and the formula-injection guard. */
import { formatMac } from './classify.js';

export const TEMPLATES = {
  full: {
    label: 'All fields',
    cols: [['Type', 'type'], ['Asset Tag', 'assetTag'], ['MAC Address', 'mac'], ['Serial Number', 'serial'],
      ['Meraki Serial', 'meraki'], ['Model (PID)', 'pid'], ['Part Number', 'partNo'], ['CLEI', 'clei'],
      ['Note', 'note'], ['Scanned At', 'scannedAt']]
  },
  short: {
    label: 'Asset tag, MAC, serial',
    cols: [['Asset Tag', 'assetTag'], ['MAC Address', 'mac'], ['Serial Number', 'serial']]
  }
};

/* Quote when needed; prefix "'" to text that a spreadsheet would run as a formula (=, +, -, @, tab, CR),
   but leave plain numbers like -5 alone. */
export function csvCell(v) {
  let s = v == null ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = "'" + s;
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

/* opts: {macStyle, apSerial: 'cisco'|'meraki'} (a bare string is taken as macStyle) */
export function toCsv(rows, templateKey, opts) {
  if (typeof opts === 'string') opts = { macStyle: opts };
  opts = opts || {};
  const t = TEMPLATES[templateKey] || TEMPLATES.full;
  const lines = [t.cols.map(c => csvCell(c[0])).join(',')];
  for (const r of rows) {
    lines.push(t.cols.map(([_, key]) => {
      if (key === 'mac') return csvCell(formatMac(r.mac, opts.macStyle));
      if (key === 'serial' && templateKey === 'short' && opts.apSerial === 'meraki' && r.type === 'AP' && r.meraki) return csvCell(r.meraki);
      return csvCell(r[key]);
    }).join(','));
  }
  return lines.join('\r\n') + '\r\n';
}

/* Generic table (header + rows of strings) -> CSV text, same quoting and guard. */
export function tableToCsv(header, rows) {
  return [header].concat(rows).map(r => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}
