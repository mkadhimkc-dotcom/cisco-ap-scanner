/* Label field classification and device typing. */

export const DEFAULT_ASSET_RE = '^\\d{4,9}$';
export const FIELD_ORDER = ['assetTag', 'mac', 'serial', 'meraki', 'pid', 'partNo', 'clei'];
export const FIELD_LABEL = {
  assetTag: 'Asset tag', mac: 'MAC address', serial: 'Serial number', meraki: 'Meraki serial',
  pid: 'Model (PID)', partNo: 'Part number', clei: 'CLEI'
};
export const TYPES = ['Switch', 'AP', 'Other'];
/* fields a label of this type is expected to carry (drives "read X of Y" and which fields show first) */
export const EXPECTED = {
  Switch: ['assetTag', 'mac', 'serial', 'pid', 'partNo', 'clei'],
  AP: ['assetTag', 'mac', 'serial', 'meraki', 'pid'],
  Other: ['assetTag', 'mac', 'serial', 'pid']
};

export function normalizeMac(s) {
  const hex = String(s).replace(/[^0-9a-fA-F]/g, '').toUpperCase();
  return hex.length === 12 ? hex : '';
}
export function formatMac(s, style) {
  const hex = normalizeMac(s);
  if (!hex) return String(s || '');
  const pairs = hex.match(/.{2}/g);
  if (style === 'plain') return hex;
  if (style === 'dashes') return pairs.join('-');
  if (style === 'cisco') return [hex.slice(0, 4), hex.slice(4, 8), hex.slice(8)].join('.').toLowerCase();
  return pairs.join(':');
}

export const SERIAL_RE = /^[A-Z]{3}\d{4}[A-Z0-9]{4}$/;
export const MAC_RE = /^([0-9A-F]{12}|([0-9A-F]{2}[:\-.]){5}[0-9A-F]{2})$/i;
export const PARTNO_RE = /^\d{2,3}-\d{4,6}-\d{2}(\s+[A-Z0-9]{1,3})?$/;
export const PID_RE = /^[A-Z][A-Z0-9]*[-\/][A-Z0-9][A-Z0-9\-\/.]*(\s+V\d{2})?$/;
export const CLEI_RE = /^[A-Z0-9]{10}$/;
export const MERAKI_RE = /^Q[A-Z0-9]{3}-[A-Z0-9]{4}-[A-Z0-9]{4}$/;
export const AP_PID_RE = /^(CW\d{4}|MR\d{2}|AIR-|C91\d\d)/;
export const SWITCH_PID_RE = /^(C9[2-6]\d\d|C1[0-9]{3}|WS-C|MS\d{3}|CBS|SG\d|SF\d|N\dK|IE-)/;

export function detectType(dev) {
  const pid = String(dev.pid || '').toUpperCase();
  if (AP_PID_RE.test(pid)) return 'AP';
  if (SWITCH_PID_RE.test(pid)) return 'Switch';
  if (dev.meraki) return 'AP';
  if (dev.clei && dev.partNo) return 'Switch';
  return 'Other';
}

const GS = '\u001d';
export function unsymbol(t) {
  return String(t).replace(/␝/g, GS).replace(/␞/g, '\u001e').replace(/␄/g, '\u0004');
}

/* ISO/IEC 15434 format 06 payload (Cisco Data Matrix): [)>RS06 GS 11P<CLEI> GS S<serial> RS EOT */
export function parse15434(text) {
  const t = unsymbol(text);
  if (t.indexOf('[)>') !== 0) return null;
  const body = t.replace(/^\[\)>\u001e?\d{0,2}/, '');
  const out = {};
  for (let f of body.split(GS)) {
    f = f.replace(/[\u001e\u0004]/g, '').trim();
    if (!f) continue;
    if (/^11P/.test(f)) out.clei = f.slice(3);
    else if (/^1P/.test(f)) out.pid = f.slice(2);
    else if (/^S/.test(f)) out.serial = f.slice(1);
    else if (/^P/.test(f)) out.pid = f.slice(1);
  }
  return Object.keys(out).length ? out : null;
}

/* One decoded code -> list of {field, value, src} or [] (unrecognized).
   src is 'dm' for values that came out of a Data Matrix / QR payload, 'linear' otherwise. */
export function classify(code, opts) {
  opts = opts || {};
  const assetRe = new RegExp(opts.assetRe || DEFAULT_ASSET_RE);
  const text = String(code.text).trim();
  const fmt = code.format;
  if (fmt === 'DataMatrix' || fmt === 'QRCode') {
    const p = parse15434(text);
    if (!p) return [];
    const res = [];
    if (p.clei && CLEI_RE.test(p.clei)) res.push({ field: 'clei', value: p.clei, src: 'dm' });
    if (p.serial && /^[A-Z0-9]{8,14}$/.test(p.serial)) res.push({ field: 'serial', value: p.serial, src: 'dm' });
    if (p.pid) res.push({ field: 'pid', value: p.pid, src: 'dm' });
    return res;
  }
  if (fmt !== 'Code128' && fmt !== 'Code39') return [];
  const up = text.toUpperCase();
  const bare = up.replace(/[:\-.]/g, '');
  const hit = (field, value) => [{ field, value, src: 'linear' }];
  if (MAC_RE.test(up) && (up !== bare || /[A-F]/.test(bare) || !assetRe.test(up))) return hit('mac', normalizeMac(up));
  // Meraki serials (Q2XX-XXXX-XXXX) also fit the loose PID pattern, so they must be tested first
  if (MERAKI_RE.test(up)) return hit('meraki', up);
  if (SERIAL_RE.test(up)) return hit('serial', up);
  if (PARTNO_RE.test(up)) return hit('partNo', up);
  if (assetRe.test(text)) return hit('assetTag', text);
  if (PID_RE.test(up) && /[A-Z]/.test(up) && up.length >= 6) return hit('pid', up);
  return [];
}
