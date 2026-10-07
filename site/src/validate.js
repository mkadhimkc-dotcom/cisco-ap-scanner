/* Field validators. They only warn; nothing here ever blocks a value from being saved or exported. */
import { normalizeMac, formatMac, SERIAL_RE } from './classify.js';

/* oui = {cisco: Set, meraki: Set} of 6-hex-digit prefixes (site/data/oui-cisco.json), or null when not loaded. */
export function ouiVendor(mac, oui) {
  const hex = normalizeMac(mac);
  if (!hex || !oui) return null;
  const p = hex.slice(0, 6);
  return oui.meraki.has(p) ? 'Meraki' : oui.cisco.has(p) ? 'Cisco' : null;
}

/* -> [{level: 'error'|'warn', text}] */
export function macIssues(mac, oui) {
  const raw = String(mac || '').trim();
  if (!raw) return [];
  const hex = normalizeMac(raw);
  if (!hex) return [{ level: 'error', text: 'A MAC address is 12 hex digits.' }];
  if (/^0{12}$/.test(hex) || /^F{12}$/.test(hex)) return [{ level: 'error', text: 'All zeros or all F is not a device MAC.' }];
  const out = [];
  if (parseInt(hex.slice(0, 2), 16) & 1) out.push({ level: 'warn', text: 'Multicast address: not a device MAC. Check the label.' });
  if (oui && !ouiVendor(hex, oui)) out.push({ level: 'warn', text: 'Unusual OUI ' + formatMac(hex, 'colons').slice(0, 8) + ': not registered to Cisco or Meraki.' });
  return out;
}

/* Cisco serial LLLYYWWXXXX: LLL = site prefix, YY = year - 1996, WW = week. */
export function decodeSerial(serial) {
  const m = /^([A-Z]{3})(\d{2})(\d{2})[A-Z0-9]{4}$/.exec(String(serial || '').trim().toUpperCase());
  if (!m) return null;
  const year = 1996 + Number(m[2]), week = Number(m[3]);
  return { site: m[1], year, week, valid: week >= 1 && week <= 53 };
}

export function serialIssues(serial, now = new Date()) {
  const s = String(serial || '').trim().toUpperCase();
  if (!s) return [];
  if (!SERIAL_RE.test(s)) return [{ level: 'warn', text: 'Not the Cisco serial pattern (3 letters, 4 digits, 4 letters or digits).' }];
  const d = decodeSerial(s);
  if (!d.valid) return [{ level: 'warn', text: 'Week ' + d.week + ' in the date code is not a real week. Check the serial.' }];
  if (d.year > now.getFullYear() + 1) return [{ level: 'warn', text: 'The date code says ' + d.year + ', which is in the future. Check the serial.' }];
  return [];
}

/* "Site FJC · mfg 2025 wk 50" sanity line for a card, or '' */
export function serialNote(serial) {
  const d = decodeSerial(serial);
  return d && d.valid ? 'Site ' + d.site + ' · mfg ' + d.year + ' wk ' + String(d.week).padStart(2, '0') : '';
}

/* "C9300-48UN-A V10" -> {base: 'C9300-48UN-A', rev: 'V10'}. The full PID stays in the CSV. */
export function splitPid(pid) {
  const m = /^(.*?)\s+(V\d{2})$/i.exec(String(pid || '').trim());
  return m ? { base: m[1], rev: m[2].toUpperCase() } : { base: String(pid || '').trim(), rev: '' };
}

/* oui-cisco.json -> {cisco: Set, meraki: Set} */
export function ouiSets(json) {
  return json ? { cisco: new Set(json.cisco || []), meraki: new Set(json.meraki || []) } : null;
}
