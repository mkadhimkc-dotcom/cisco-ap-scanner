import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { macIssues, ouiVendor, ouiSets, decodeSerial, serialIssues, serialNote, splitPid } from '../../site/src/validate.js';
import { buildDevice, mergeDevice, mergeRows, CONF } from '../../site/src/device.js';

const oui = ouiSets(JSON.parse(readFileSync(new URL('../../site/data/oui-cisco.json', import.meta.url))));
const code = (format, text, count = 1) => ({ format, text, count });

test('OUI list: fixture MACs are Cisco / Meraki prefixes', () => {
  assert.equal(ouiVendor('F4:B8:21:88:DE:00', oui), 'Cisco');
  assert.equal(ouiVendor('780F810A68B0', oui), 'Meraki');
  assert.equal(ouiVendor('001122334455', oui), null);
  assert.equal(ouiVendor('nope', oui), null);
});

test('macIssues', () => {
  assert.deepEqual(macIssues('', oui), []);
  assert.deepEqual(macIssues('F4B82188DE00', oui), []);
  assert.equal(macIssues('F4B82188DE0', oui)[0].level, 'error');
  assert.equal(macIssues('000000000000', oui)[0].level, 'error');
  assert.equal(macIssues('ff:ff:ff:ff:ff:ff', oui)[0].level, 'error');
  assert.match(macIssues('011122334455', oui)[0].text, /Multicast/);
  const odd = macIssues('001122334455', oui);
  assert.equal(odd.length, 1); assert.equal(odd[0].level, 'warn'); assert.match(odd[0].text, /Unusual OUI 00:11:22/);
  assert.deepEqual(macIssues('001122334455', null), [], 'no OUI list loaded: no OUI hint');
});

test('Cisco serial date code', () => {
  assert.deepEqual(decodeSerial('FJC295016BD'), { site: 'FJC', year: 2025, week: 50, valid: true });
  assert.deepEqual(decodeSerial('FJC302010KM'), { site: 'FJC', year: 2026, week: 20, valid: true });
  assert.equal(decodeSerial('FOC2702X0AB').year, 2023);
  assert.equal(decodeSerial('Q5AP-9XMF-374L'), null);
  assert.equal(serialNote('FOC2702X0AB'), 'Site FOC · mfg 2023 wk 02');
  assert.equal(serialNote('nope'), '');
  const now = new Date('2026-10-07');
  assert.deepEqual(serialIssues('FJC295016BD', now), []);
  assert.match(serialIssues('FJC2960AAAA', now)[0].text, /Week 60/);
  assert.match(serialIssues('FJC4001AAAA', now)[0].text, /future/);
  assert.match(serialIssues('12345', now)[0].text, /pattern/);
  assert.deepEqual(serialIssues('', now), []);
});

test('splitPid: hardware revision', () => {
  assert.deepEqual(splitPid('C9300-48UN-A V10'), { base: 'C9300-48UN-A', rev: 'V10' });
  assert.deepEqual(splitPid('CW9166I-B v06'), { base: 'CW9166I-B', rev: 'V06' });
  assert.deepEqual(splitPid('MR46'), { base: 'MR46', rev: '' });
  assert.deepEqual(splitPid(''), { base: '', rev: '' });
});

test('buildDevice: confidence, hardware rev, serial mismatch', () => {
  const dev = buildDevice([code('Code128', 'CW9166I-B V06', 3), code('Code128', 'FJC295016BD', 1), code('Code39', '780F810A68B0', 2)]);
  assert.equal(dev.pid, 'CW9166I-B V06', 'full PID kept');
  assert.equal(dev.hwRev, 'V06');
  assert.deepEqual(dev.conf, { pid: CONF.confirmed, serial: CONF.single, mac: CONF.confirmed, hwRev: CONF.confirmed });
  const dm = '[)>\x1e06\x1d11PINMGV10CRE\x1dSFJC302010KM\x1e\x04';
  const ok = buildDevice([code('Code128', 'FJC302010KM'), code('DataMatrix', dm)]);
  assert.equal(ok.conf.serial, CONF.confirmed, 'one read each from label and Data Matrix = cross-checked');
  assert.equal(ok.serialMismatch, null);
  const bad = buildDevice([code('Code128', 'FJC302010KX', 3), code('DataMatrix', dm)]);
  assert.deepEqual(bad.serialMismatch, { label: 'FJC302010KX', matrix: 'FJC302010KM' });
});

test('mergeDevice: a second agreeing scan confirms; typed values stay manual', () => {
  const row = { mac: '780F810A68B0', serial: '', pid: '', conf: { mac: CONF.single }, warnings: [], other: [] };
  mergeDevice(row, buildDevice([code('Code128', '780F810A68B0'), code('Code128', 'FJC295016BD')]));
  assert.equal(row.conf.mac, CONF.confirmed);
  assert.equal(row.conf.serial, CONF.single);
  const typed = { mac: '780F810A68B0', conf: { mac: CONF.manual }, warnings: [], other: [] };
  mergeDevice(typed, buildDevice([code('Code128', '780F810A68B0')]));
  assert.equal(typed.conf.mac, CONF.manual);
});

test('mergeRows: fills gaps, confirms equal values, warns on differences, joins notes', () => {
  const dst = { type: 'Other', assetTag: '', mac: 'F4B82188DE00', serial: 'FJC302010KM', note: 'rack 2', conf: { mac: CONF.single, serial: CONF.single }, warnings: [], other: [] };
  const src = { type: 'Switch', assetTag: '298366', mac: 'F4B82188DE00', serial: 'FJC302010KX', note: 'U12', conf: { assetTag: CONF.single, mac: CONF.single, serial: CONF.single }, warnings: [], other: [] };
  mergeRows(dst, src);
  assert.equal(dst.assetTag, '298366');
  assert.equal(dst.conf.mac, CONF.confirmed);
  assert.equal(dst.serial, 'FJC302010KM');
  assert.match(dst.warnings[0], /Serial number kept FJC302010KM \(the other device had FJC302010KX\)/);
  assert.equal(dst.note, 'rack 2; U12');
  assert.equal(dst.type, 'Switch');
});
