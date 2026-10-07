import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BUILTIN, buildTable, findTemplate, newTemplate, cleanTemplate, fileJson, exportFileName, COLUMNS } from '../../site/src/templates.js';
import { toCsv, tableToCsv } from '../../site/src/csv.js';

const file = { name: 'IDF-3 Rm 214', kind: 'Mixed', location: 'Bldg 2', rack: 'R2 U12', created: '2026-10-07 12:00', updated: '2026-10-07 13:00' };
const rows = [
  { type: 'AP', assetTag: '001234', mac: '780F810A68B0', serial: 'FJC295016BD', meraki: 'Q5AP-9XMF-374L', pid: 'CW9166I-B V06', hwRev: 'V06', partNo: '', clei: '', note: 'ceiling, =odd', scannedAt: '2026-10-07 12:43', conf: { mac: 'confirmed' } },
  { type: 'Switch', assetTag: '298366', mac: 'F4B82188DE00', serial: 'FJC302010KM', meraki: '', pid: 'C9300-48UN-A V10', partNo: '800-107831-05 D0', clei: 'INMGV10CRE', note: '', scannedAt: '2026-10-07 12:50' }
];

test('built-in full and short templates produce exactly the original CSV', () => {
  for (const id of ['full', 'short']) for (const macStyle of ['colons', 'dashes', 'plain', 'cisco']) for (const apSerial of ['cisco', 'meraki']) {
    const t = buildTable(findTemplate(id), file, rows, { macStyle, apSerial });
    assert.equal(tableToCsv(t.header, t.rows), toCsv(rows, id, { macStyle, apSerial }), `${id} ${macStyle} ${apSerial}`);
  }
});

test('Snipe-IT preset', () => {
  const t = buildTable(findTemplate('snipeit'), file, rows, { macStyle: 'colons', apSerial: 'meraki' });
  assert.deepEqual(t.header, ['Asset Tag', 'Serial Number', 'Model Name', 'MAC Address', 'Location', 'Notes']);
  assert.deepEqual(t.rows[0], ['001234', 'FJC295016BD', 'CW9166I-B V06', '78:0F:81:0A:68:B0', 'Bldg 2', 'ceiling, =odd'], 'Meraki serial option ignored outside the short template');
  assert.equal(tableToCsv(t.header, t.rows).split('\r\n')[1], '001234,FJC295016BD,CW9166I-B V06,78:0F:81:0A:68:B0,Bldg 2,"ceiling, =odd"');
});

test('custom templates: order, renamed headers, file columns, derived columns', () => {
  const t = cleanTemplate({ id: 'x', name: ' Inventory ', cols: [
    { key: 'serial', header: 'S/N' }, { key: 'model', header: '' }, { key: 'hwRev' }, { key: 'rack', header: 'Rack' },
    { key: 'serial', header: 'again' }, { key: 'bogus', header: 'X' }, { key: 'dup' }
  ] });
  assert.equal(t.name, 'Inventory');
  assert.deepEqual(t.cols.map(c => c.header), ['S/N', 'Model', 'Hardware Rev', 'Rack', 'Duplicate Of']);
  const tab = buildTable(t, file, rows, { dupText: r => r.type === 'AP' ? 'MAC = #2' : '' });
  assert.deepEqual(tab.rows[1], ['FJC302010KM', 'C9300-48UN-A', 'V10', 'R2 U12', '']);
  assert.deepEqual(tab.rows[0], ['FJC295016BD', 'CW9166I-B', 'V06', 'R2 U12', 'MAC = #2']);
});

test('newTemplate starts from all fields plus Location and Rack/U', () => {
  const t = newTemplate('Mine');
  assert.equal(t.cols.length, 12);
  assert.deepEqual(t.cols.slice(-2).map(c => c.key), ['location', 'rack']);
  assert.ok(t.cols.every(c => COLUMNS[c.key]));
  assert.notEqual(newTemplate().id, newTemplate().id);
});

test('JSON export of a file', () => {
  const j = fileJson(Object.assign({ rows }, file), { now: '2026-10-07T20:00:00Z' });
  assert.equal(j.format, 'label-scanner/file');
  assert.equal(j.file.location, 'Bldg 2');
  assert.equal(j.devices.length, 2);
  assert.equal(j.devices[0].mac, '78:0F:81:0A:68:B0');
  assert.equal(j.devices[1].hwRev, 'V10', 'derived from the PID when not stored');
  assert.deepEqual(j.devices[0].confidence, { mac: 'confirmed' });
  assert.doesNotThrow(() => JSON.parse(JSON.stringify(j)));
});

test('export file names', () => {
  const d = new Date(2026, 9, 7);
  assert.equal(exportFileName('IDF-3 Rm 214', d, 'csv'), 'label-scan_IDF-3-Rm-214_2026-10-07.csv');
  assert.equal(exportFileName('Bâtiment 2 / IDF:3', d, 'xlsx'), 'label-scan_Batiment-2-IDF-3_2026-10-07.xlsx');
  assert.equal(exportFileName('   ', d, 'json'), 'label-scan_session_2026-10-07.json');
});

test('every built-in references real columns', () => {
  for (const t of BUILTIN) assert.ok(t.cols.every(c => COLUMNS[c.key]), t.id);
});
