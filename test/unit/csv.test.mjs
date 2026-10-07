import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toCsv, csvCell, tableToCsv, TEMPLATES } from '../../site/src/csv.js';

const ap = { type: 'AP', assetTag: '001234', mac: '780F810A68B0', serial: 'FJC295016BD', meraki: 'Q5AP-9XMF-374L', pid: 'CW9166I-B V06', partNo: '', clei: '', note: 'IDF-3, rack 2', scannedAt: '2026-10-07 12:43' };
const sw = { type: 'Switch', assetTag: '298366', mac: 'F4B82188DE00', serial: 'FJC302010KM', meraki: '', pid: 'C9300-48UN-A V10', partNo: '800-107831-05 D0', clei: 'INMGV10CRE', note: '', scannedAt: '2026-10-07 12:50' };

test('templates: built-in headers are exactly as shipped', () => {
  assert.equal(toCsv([], 'full').trim(), 'Type,Asset Tag,MAC Address,Serial Number,Meraki Serial,Model (PID),Part Number,CLEI,Note,Scanned At');
  assert.equal(toCsv([], 'short').trim(), 'Asset Tag,MAC Address,Serial Number');
  assert.equal(TEMPLATES.full.cols.length, 10);
  assert.equal(TEMPLATES.short.cols.length, 3);
});

test('toCsv full: values, quoting, CRLF, leading zeros kept', () => {
  const csv = toCsv([ap, sw], 'full', { macStyle: 'colons' });
  const lines = csv.split('\r\n');
  assert.equal(lines.length, 4, 'header + 2 rows + trailing CRLF');
  assert.equal(lines[1], 'AP,001234,78:0F:81:0A:68:B0,FJC295016BD,Q5AP-9XMF-374L,CW9166I-B V06,,,"IDF-3, rack 2",2026-10-07 12:43');
  assert.equal(lines[2], 'Switch,298366,F4:B8:21:88:DE:00,FJC302010KM,,C9300-48UN-A V10,800-107831-05 D0,INMGV10CRE,,2026-10-07 12:50');
  assert.equal(lines[3], '');
});

test('toCsv: every MAC style', () => {
  const cell = style => toCsv([sw], 'short', { macStyle: style }).split('\r\n')[1].split(',')[1];
  assert.equal(cell('colons'), 'F4:B8:21:88:DE:00');
  assert.equal(cell('dashes'), 'F4-B8-21-88-DE-00');
  assert.equal(cell('plain'), 'F4B82188DE00');
  assert.equal(cell('cisco'), 'f4b8.2188.de00');
  assert.equal(toCsv([sw], 'short', 'dashes').split('\r\n')[1].split(',')[1], 'F4-B8-21-88-DE-00', 'bare string = macStyle');
});

test('toCsv short: AP serial column can use the Meraki serial', () => {
  assert.equal(toCsv([ap, sw], 'short', { apSerial: 'meraki' }).split('\r\n')[1], '001234,78:0F:81:0A:68:B0,Q5AP-9XMF-374L');
  assert.equal(toCsv([ap, sw], 'short', { apSerial: 'meraki' }).split('\r\n')[2], '298366,F4:B8:21:88:DE:00,FJC302010KM', 'switches unaffected');
  assert.equal(toCsv([ap], 'short', { apSerial: 'cisco' }).split('\r\n')[1], '001234,78:0F:81:0A:68:B0,FJC295016BD');
  assert.equal(toCsv([ap], 'full', { apSerial: 'meraki' }).split('\r\n')[1].split(',')[3], 'FJC295016BD', 'full keeps both');
});

test('csvCell: quoting', () => {
  assert.equal(csvCell('plain'), 'plain');
  assert.equal(csvCell('a,b'), '"a,b"');
  assert.equal(csvCell('say "hi"'), '"say ""hi"""');
  assert.equal(csvCell('two\nlines'), '"two\nlines"');
  assert.equal(csvCell(null), '');
  assert.equal(csvCell(undefined), '');
  assert.equal(csvCell(0), '0');
});

test('csvCell: formula-injection guard', () => {
  assert.equal(csvCell('=1+1'), "'=1+1");
  assert.equal(csvCell('+SUM(A1)'), "'+SUM(A1)");
  assert.equal(csvCell('-2+3'), "'-2+3");
  assert.equal(csvCell('@cmd'), "'@cmd");
  assert.equal(csvCell('\tx'), "'\tx");
  assert.equal(csvCell('=HYPERLINK("http://x","y")'), '"\'=HYPERLINK(""http://x"",""y"")"');
  assert.equal(csvCell('-5'), '-5', 'plain negative number untouched');
  assert.equal(csvCell('-0.25'), '-0.25');
  const csv = toCsv([Object.assign({}, sw, { note: '=cmd|"/c calc"!A1' })], 'full');
  assert.match(csv, /"'=cmd\|""\/c calc""!A1"/);
});

test('tableToCsv uses the same rules', () => {
  assert.equal(tableToCsv(['A', 'B'], [['=x', '1,2']]), "A,B\r\n'=x,\"1,2\"\r\n");
});
