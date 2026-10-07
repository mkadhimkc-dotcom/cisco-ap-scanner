import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  classify, parse15434, detectType, normalizeMac, formatMac, unsymbol,
  SERIAL_RE, MAC_RE, PARTNO_RE, PID_RE, CLEI_RE, MERAKI_RE, AP_PID_RE, SWITCH_PID_RE
} from '../../site/src/classify.js';

const c128 = text => ({ format: 'Code128', text });
const c39 = text => ({ format: 'Code39', text });
const one = (code, opts) => classify(code, opts).map(h => [h.field, h.value]);

test('regexes: serial', () => {
  for (const s of ['FJC295016BD', 'FOC2302X0AB', 'FCW1234Z9YX']) assert.ok(SERIAL_RE.test(s), s);
  for (const s of ['FJ295016BD', 'FJC29501', 'fjc295016bd', 'FJC295016BDX']) assert.ok(!SERIAL_RE.test(s), s);
});
test('regexes: MAC', () => {
  for (const s of ['780F810A68B0', '78:0F:81:0A:68:B0', '78-0f-81-0a-68-b0', '78.0F.81.0A.68.B0']) assert.ok(MAC_RE.test(s), s);
  for (const s of ['780F810A68B', '780F810A68BZ', 'f4b8.2188.de00']) assert.ok(!MAC_RE.test(s), s);
});
test('regexes: part number, PID, CLEI, Meraki, type prefixes', () => {
  assert.ok(PARTNO_RE.test('800-107831-05 D0'));
  assert.ok(PARTNO_RE.test('74-123456-01'));
  assert.ok(!PARTNO_RE.test('800-107831-5'));
  assert.ok(PID_RE.test('C9300-48UN-A V10'));
  assert.ok(PID_RE.test('CW9166I-B V06'));
  assert.ok(PID_RE.test('AIR-AP2802I-B-K9'));
  assert.ok(!PID_RE.test('C9300'));
  assert.ok(CLEI_RE.test('INMGV10CRE'));
  assert.ok(!CLEI_RE.test('INMGV10CR'));
  assert.ok(MERAKI_RE.test('Q5AP-9XMF-374L'));
  assert.ok(!MERAKI_RE.test('Q5AP-9XMF-374'));
  for (const p of ['CW9166I-B', 'MR46', 'AIR-AP2802I', 'C9120AXI-B']) assert.ok(AP_PID_RE.test(p), p);
  for (const p of ['C9300-48UN-A', 'WS-C3850-48P', 'MS250-48', 'C1000-24T', 'N9K-C93180', 'IE-3300']) assert.ok(SWITCH_PID_RE.test(p), p);
});

test('classify: MAC wins over asset tag only when it has letters or separators', () => {
  assert.deepEqual(one(c128('780F810A68B0')), [['mac', '780F810A68B0']]);
  assert.deepEqual(one(c39('f4:b8:21:88:de:00')), [['mac', 'F4B82188DE00']]);
  // 12 digits, no letters: an asset tag when the pattern allows 12 digits, else a MAC
  assert.deepEqual(one(c39('123456789012'), { assetRe: '^\\d{12}$' }), [['assetTag', '123456789012']]);
  assert.deepEqual(one(c39('123456789012')), [['mac', '123456789012']]);
});
test('classify: Meraki serial is tested before the loose PID pattern', () => {
  assert.ok(PID_RE.test('Q5AP-9XMF-374L'), 'Meraki serials also fit PID_RE');
  assert.deepEqual(one(c128('Q5AP-9XMF-374L')), [['meraki', 'Q5AP-9XMF-374L']]);
});
test('classify: serial, part number, asset tag, PID, junk', () => {
  assert.deepEqual(one(c128('FJC295016BD')), [['serial', 'FJC295016BD']]);
  assert.deepEqual(one(c128('800-107831-05 D0')), [['partNo', '800-107831-05 D0']]);
  assert.deepEqual(one(c39('298366')), [['assetTag', '298366']]);
  assert.deepEqual(one(c128('C9300-48UN-A V10')), [['pid', 'C9300-48UN-A V10']]);
  assert.deepEqual(one(c128('cw9166i-b v06')), [['pid', 'CW9166I-B V06']]);
  assert.deepEqual(one(c128('HELLO')), []);
  assert.deepEqual(one(c128('123')), []);
  assert.deepEqual(one({ format: 'EAN13', text: '298366' }), []);
});
test('classify: custom asset tag pattern', () => {
  assert.deepEqual(one(c39('KC-00123'), { assetRe: '^KC-\\d{5}$' }), [['assetTag', 'KC-00123']]);
  assert.deepEqual(one(c39('298366'), { assetRe: '^KC-\\d{5}$' }), []);
});

test('parse15434: Cisco Data Matrix payload, raw and with control pictures', () => {
  const raw = '[)>\x1e06\x1d11PINMGV10CRE\x1dSFJC302010KM\x1e\x04';
  assert.deepEqual(parse15434(raw), { clei: 'INMGV10CRE', serial: 'FJC302010KM' });
  assert.deepEqual(parse15434('[)>␞06␝11PINMGV10CRE␝SFJC302010KM␝1PC9300-48UN-A␞␄'),
    { clei: 'INMGV10CRE', serial: 'FJC302010KM', pid: 'C9300-48UN-A' });
  assert.equal(parse15434('hello'), null);
  assert.equal(parse15434('[)>\x1e06\x1e\x04'), null);
  assert.equal(unsymbol('a␝b'), 'a\x1db');
});
test('classify: Data Matrix fields are tagged with their source', () => {
  const hits = classify({ format: 'DataMatrix', text: '[)>\x1e06\x1d11PINMGV10CRE\x1dSFJC302010KM\x1e\x04' });
  assert.deepEqual(hits, [
    { field: 'clei', value: 'INMGV10CRE', src: 'dm' },
    { field: 'serial', value: 'FJC302010KM', src: 'dm' }
  ]);
  assert.deepEqual(classify({ format: 'DataMatrix', text: 'not 15434' }), []);
});

test('detectType', () => {
  assert.equal(detectType({ pid: 'CW9166I-B V06' }), 'AP');
  assert.equal(detectType({ pid: 'C9300-48UN-A V10' }), 'Switch');
  assert.equal(detectType({ meraki: 'Q5AP-9XMF-374L' }), 'AP');
  assert.equal(detectType({ clei: 'INMGV10CRE', partNo: '800-107831-05' }), 'Switch');
  assert.equal(detectType({ serial: 'FJC295016BD' }), 'Other');
});

test('normalizeMac / formatMac: every style', () => {
  assert.equal(normalizeMac('f4-b8-21-88-de-00'), 'F4B82188DE00');
  assert.equal(normalizeMac('f4b8.2188.de0'), '');
  const m = 'F4B82188DE00';
  assert.equal(formatMac(m, 'colons'), 'F4:B8:21:88:DE:00');
  assert.equal(formatMac(m, 'dashes'), 'F4-B8-21-88-DE-00');
  assert.equal(formatMac(m, 'plain'), 'F4B82188DE00');
  assert.equal(formatMac(m, 'cisco'), 'f4b8.2188.de00');
  assert.equal(formatMac(m), 'F4:B8:21:88:DE:00');
  assert.equal(formatMac('not a mac', 'plain'), 'not a mac');
  assert.equal(formatMac('', 'plain'), '');
});
