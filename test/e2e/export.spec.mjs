// Phase 4: templates (built-ins unchanged, Snipe-IT, custom), JSON, file names, share fallback notice.
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { addByHand } from './helpers.mjs';

test.use({ acceptDownloads: true });

test.beforeEach(async ({ page }) => {
  page.errors = [];
  page.on('pageerror', e => page.errors.push(e.message));
  await page.goto('/');
  await expect(page.locator('#decoderPill')).toHaveAttribute('data-kind', 'ok', { timeout: 30000 });
  await page.click('#btnNew');
  await page.fill('#newName', 'IDF-3 Rm 214');
  await page.fill('#newLocation', 'Bldg 2');
  await page.fill('#newRack', 'R2 U12');
  await page.check('#newForm input[name="kind"][value="Mixed"]', { force: true });
  await page.click('#newForm button[type=submit]');
  await page.waitForSelector('#viewFile:not([hidden])');
  await addByHand(page, { serial: 'FJC302010KM' });
  await page.selectOption('#devices .card select[data-field="type"]', 'Switch');   // Switch shows part number and CLEI
  const id = await page.$eval('#devices li', li => li.dataset.row);
  for (const [k, v] of Object.entries({ assetTag: '298366', mac: 'F4B82188DE00', pid: 'C9300-48UN-A V10', partNo: '800-107831-05 D0', clei: 'INMGV10CRE', note: '=not a formula' })) {
    await page.fill(`#f-${id}-${k}`, v); await page.dispatchEvent(`#f-${id}-${k}`, 'change');
  }
  await page.click('#btnExport');
  await page.waitForSelector('#viewExport:not([hidden])');
});
test.afterEach(async ({ page }) => { expect(page.errors).toEqual([]); });

async function download(page) {
  const [d] = await Promise.all([page.waitForEvent('download'), page.click('#btnDownload')]);
  return { name: d.suggestedFilename(), text: readFileSync(await d.path(), 'utf8') };
}
const today = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };

test('built-in templates export the original CSV columns; file name pattern', async ({ page }) => {
  await page.click('[data-fmt="csv"]');
  await page.selectOption('#tplSel', 'full');
  let f = await download(page);
  expect(f.name).toBe(`label-scan_IDF-3-Rm-214_${today()}.csv`);
  const lines = f.text.split('\r\n');
  expect(lines[0]).toBe('Type,Asset Tag,MAC Address,Serial Number,Meraki Serial,Model (PID),Part Number,CLEI,Note,Scanned At');
  expect(lines[1]).toMatch(/^Switch,298366,F4:B8:21:88:DE:00,FJC302010KM,,C9300-48UN-A V10,800-107831-05 D0,INMGV10CRE,'=not a formula,\d{4}-\d\d-\d\d \d\d:\d\d$/);
  await page.selectOption('#tplSel', 'short');
  await page.selectOption('#macStyle', 'cisco');
  f = await download(page);
  expect(f.text).toBe('Asset Tag,MAC Address,Serial Number\r\n298366,f4b8.2188.de00,FJC302010KM\r\n');
});

test('Snipe-IT preset', async ({ page }) => {
  await page.click('[data-fmt="csv"]');
  await page.selectOption('#tplSel', 'snipeit');
  await expect(page.locator('#tplHint')).toContainText('Snipe-IT');
  const f = await download(page);
  expect(f.text).toBe("Asset Tag,Serial Number,Model Name,MAC Address,Location,Notes\r\n298366,FJC302010KM,C9300-48UN-A V10,F4:B8:21:88:DE:00,Bldg 2,'=not a formula\r\n");
});

test('custom template: pick, reorder, rename, save; it is remembered and can be deleted', async ({ page }) => {
  await page.click('[data-fmt="csv"]');
  await page.click('#btnTplNew');
  await page.fill('#tplName', 'Rack sheet');
  // keep only Rack/U, Asset tag, Hardware rev (in that order), rename Asset tag
  const keys = await page.$$eval('#tplCols li', lis => lis.map(li => li.dataset.key));
  for (const key of keys) {   // the list re-renders after each tick, so look each row up again
    const box = page.locator(`#tplCols li[data-key="${key}"] input[type=checkbox]`);
    if (['assetTag', 'rack'].includes(key)) { if (!(await box.isChecked())) await box.check(); }
    else if (await box.isChecked()) await box.uncheck();
  }
  await page.locator('#tplCols li[data-key="hwRev"] input[type=checkbox]').check();
  await page.locator('#tplCols li[data-key="rack"] button[data-move="-1"]').click();
  await page.locator('#tplCols li[data-key="assetTag"] .tplhead').fill('KC Asset');
  await page.click('#tplForm button[type=submit]');
  await expect(page.locator('#tplSel option:checked')).toHaveText('Rack sheet (yours)');
  let f = await download(page);
  expect(f.text).toBe('Rack/U,KC Asset,Hardware Rev\r\nR2 U12,298366,V10\r\n');
  await page.reload();
  await expect(page.locator('#tplSel option:checked')).toHaveText('Rack sheet (yours)');
  await page.click('#btnTplDel'); await page.click('#btnTplDel');
  await expect(page.locator('#tplSel option', { hasText: 'Rack sheet' })).toHaveCount(0);
});

test('JSON export of the file', async ({ page }) => {
  await page.click('[data-fmt="json"]');
  await expect(page.locator('#tplGroup')).toBeHidden();
  const f = await download(page);
  expect(f.name).toBe(`label-scan_IDF-3-Rm-214_${today()}.json`);
  const j = JSON.parse(f.text);
  expect(j.format).toBe('label-scanner/file');
  expect(j.file).toMatchObject({ name: 'IDF-3 Rm 214', location: 'Bldg 2', rack: 'R2 U12' });
  expect(j.devices[0]).toMatchObject({ n: 1, type: 'Switch', mac: 'F4:B8:21:88:DE:00', hwRev: 'V10', clei: 'INMGV10CRE' });
  expect(j.devices[0].confidence.serial).toBe('manual');
});

test('Excel export still works', async ({ page }) => {
  await page.click('[data-fmt="xlsx"]');
  const [d] = await Promise.all([page.waitForEvent('download'), page.click('#btnDownload')]);
  expect(d.suggestedFilename()).toBe(`label-scan_IDF-3-Rm-214_${today()}.xlsx`);
  expect(readFileSync(await d.path()).subarray(0, 2).toString()).toBe('PK');
});

test('share falls back to download and says why only once', async ({ page }) => {
  await page.evaluate(() => { navigator.canShare = () => false; });
  await page.click('[data-fmt="csv"]');
  let [d] = await Promise.all([page.waitForEvent('download'), page.click('#btnShare')]);
  await expect(page.locator('#status')).toContainText('cannot attach files');
  [d] = await Promise.all([page.waitForEvent('download'), page.click('#btnShare')]);
  await expect(page.locator('#status')).toHaveText(/^Downloaded label-scan_/);
  await expect(page.locator('#status')).not.toContainText('cannot attach');
});
