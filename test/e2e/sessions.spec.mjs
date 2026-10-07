// Phase 3: IndexedDB persistence, Location/Rack, progress and filter, delete all data.
import { test, expect } from '@playwright/test';
import { newFile, addByHand, home } from './helpers.mjs';

test.beforeEach(async ({ page }) => {
  page.errors = [];
  page.on('pageerror', e => page.errors.push(e.message));
  await page.goto('/');
  await expect(page.locator('#decoderPill')).toHaveAttribute('data-kind', 'ok', { timeout: 30000 });
});
test.afterEach(async ({ page }) => { expect(page.errors).toEqual([]); });

const idbState = page => page.evaluate(() => new Promise((resolve, reject) => {
  const r = indexedDB.open('labelscanner', 1);
  r.onsuccess = () => {
    const g = r.result.transaction('kv').objectStore('kv').get('state');
    g.onsuccess = () => resolve(g.result ? JSON.parse(g.result) : null);
    g.onerror = () => reject(g.error);
  };
  r.onerror = () => reject(r.error);
}));

test('files are stored in IndexedDB and survive an immediate reload', async ({ page }) => {
  await newFile(page, 'IDF-3 Rm 214', 'Switch');
  await addByHand(page, { assetTag: '298366', serial: 'FJC302010KM' });
  await page.reload();   // no wait: the synchronous journal covers the async IndexedDB write
  await expect(page.locator('#devices .card input[data-field="serial"]')).toHaveValue('FJC302010KM');
  await expect.poll(async () => (await idbState(page))?.files?.[0]?.rows?.[0]?.serial).toBe('FJC302010KM');
});

test('older localStorage data moves into IndexedDB', async ({ page }) => {
  await page.evaluate(() => {
    localStorage.setItem('labelscanner.v3', JSON.stringify({ files: [{ id: 'fold', name: 'Old file', site: 'Bldg 1', kind: 'AP', created: '2026-10-01 09:00', updated: '2026-10-01 09:00', rows: [], seq: 0 }] }));
  });
  await page.evaluate(() => new Promise(r => { const d = indexedDB.deleteDatabase('labelscanner'); d.onsuccess = d.onerror = d.onblocked = () => r(); }));
  await page.reload();
  await expect(page.locator('#files .name')).toHaveText(['Old file']);
  await expect(page.locator('#files .sub')).toContainText('Bldg 1');
  expect(await page.evaluate(() => localStorage.getItem('labelscanner.v3'))).toBeNull();
  await expect.poll(async () => (await idbState(page))?.files?.[0]?.location).toBe('Bldg 1');
});

test('Location and Rack/U, progress line and the incomplete filter', async ({ page }) => {
  await page.click('#btnNew');
  await page.fill('#newName', 'IDF-3');
  await page.fill('#newLocation', 'Building 2, IDF 3');
  await page.fill('#newRack', 'R2 U12');
  await page.check('#newForm input[name="kind"][value="AP"]', { force: true });
  await page.click('#newForm button[type=submit]');
  await expect(page.locator('#fSite')).toContainText('Building 2, IDF 3 · Rack/U R2 U12');
  await addByHand(page, { assetTag: '1001', mac: '780F810A68B0', serial: 'FJC295016BD', meraki: 'Q5AP-9XMF-374L', pid: 'CW9166I-B V06' });
  await addByHand(page, { serial: 'FJC2950AAAA' });
  await expect(page.locator('#fProgressText')).toHaveText('2 devices · 1 complete · 1 missing fields');
  await expect(page.locator('#fProgressWrap')).toHaveAttribute('aria-valuenow', '50');
  await page.click('#devFilter [data-filter="incomplete"]');
  await expect(page.locator('#devices .card')).toHaveCount(1);
  await expect(page.locator('#devices .card input[data-field="serial"]')).toHaveValue('FJC2950AAAA');
  await page.click('#devFilter [data-filter="all"]');
  await expect(page.locator('#devices .card')).toHaveCount(2);
  await expect(page.locator('#btnExport')).toHaveText(/Finish and export/);
});

test('Delete all data clears files and settings', async ({ page }) => {
  await newFile(page, 'Gone', 'AP'); await home(page);
  await page.click('#viewHome details summary');
  await page.fill('#assetRe', '^KC-\\d+$'); await page.dispatchEvent('#assetRe', 'change');
  await page.check('#autoSave');
  await page.click('#btnDelAll'); await page.click('#btnDelAll');
  await expect(page.locator('#files li')).toHaveCount(0);
  await expect(page.locator('#assetRe')).toHaveValue('^\\d{4,9}$');
  await expect(page.locator('#autoSave')).not.toBeChecked();
  await page.reload();
  await expect(page.locator('#homeEmpty')).toBeVisible();
});
