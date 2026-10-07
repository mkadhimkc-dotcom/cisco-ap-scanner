import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildDevice, mergeDevice } from '../../site/src/device.js';

const code = (format, text, count = 1) => ({ format, text, count });

test('buildDevice: AP label', () => {
  const dev = buildDevice([
    code('Code128', 'CW9166I-B V06'), code('Code128', 'FJC295016BD'),
    code('Code128', 'Q5AP-9XMF-374L'), code('Code128', '780F810A68B0'), code('QRCode', 'https://meraki.example/x')
  ]);
  assert.equal(dev.type, 'AP');
  assert.equal(dev.pid, 'CW9166I-B V06');
  assert.equal(dev.serial, 'FJC295016BD');
  assert.equal(dev.meraki, 'Q5AP-9XMF-374L');
  assert.equal(dev.mac, '780F810A68B0');
  assert.deepEqual(dev.warnings, []);
  assert.equal(dev.other.length, 1, 'unmatched QR kept as "other"');
  assert.equal(dev.serialAgrees, false, 'only one serial source');
});

test('buildDevice: majority wins, conflict becomes a warning', () => {
  const dev = buildDevice([code('Code128', 'FJC295016BD', 5), code('Code128', 'FJC295016B0', 1)]);
  assert.equal(dev.serial, 'FJC295016BD');
  assert.equal(dev.warnings.length, 1);
  assert.match(dev.warnings[0], /Serial number: found FJC295016BD and FJC295016B0\. Kept FJC295016BD\./);
});

test('buildDevice: serial cross-check with the Data Matrix', () => {
  const dm = '[)>\x1e06\x1d11PINMGV10CRE\x1dSFJC302010KM\x1e\x04';
  const agree = buildDevice([code('Code128', 'FJC302010KM'), code('DataMatrix', dm)]);
  assert.equal(agree.serialAgrees, true);
  assert.equal(agree.clei, 'INMGV10CRE');
  const disagree = buildDevice([code('Code128', 'FJC302010KX'), code('DataMatrix', dm)]);
  assert.equal(disagree.serialAgrees, false);
  assert.equal(disagree.warnings.length, 1, 'mismatch reported');
});

test('mergeDevice: fills gaps, keeps existing values, warns on disagreement', () => {
  const row = { assetTag: '', mac: '780F810A68B0', serial: 'FJC295016BD', meraki: '', pid: '', partNo: '', clei: '', type: 'Other', warnings: [], other: [] };
  const dev = buildDevice([code('Code39', '298366'), code('Code128', '780F810A0000'), code('Code128', 'CW9166I-B V06')]);
  mergeDevice(row, dev);
  assert.equal(row.assetTag, '298366', 'empty field filled');
  assert.equal(row.mac, '780F810A68B0', 'existing value kept');
  assert.equal(row.pid, 'CW9166I-B V06');
  assert.equal(row.type, 'AP', 'type upgraded from Other');
  assert.equal(row.warnings.length, 1);
  assert.match(row.warnings[0], /MAC address: a new photo read 780F810A0000 \(kept 780F810A68B0\)/);
  assert.equal(row.photos, 2);
});

test('mergeDevice: does not downgrade a known type', () => {
  const row = { type: 'Switch', warnings: [], other: [] };
  mergeDevice(row, buildDevice([code('Code128', 'Q5AP-9XMF-374L')]));
  assert.equal(row.type, 'Switch');
});
