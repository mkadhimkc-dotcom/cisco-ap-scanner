import { test, expect } from '@playwright/test';
import { newFile, addByHand, home } from './helpers.mjs';

test.beforeEach(async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.errors = errors;
  await page.goto('/');
  await expect(page.locator('#decoderPill')).toHaveAttribute('data-kind', 'ok', { timeout: 20000 });
});
test.afterEach(async ({ page }) => { expect(page.errors).toEqual([]); });

test('no third-party requests at runtime', async ({ page }) => {
  const foreign = [];
  page.on('request', r => { if (!r.url().startsWith('http://localhost:8765/') && !r.url().startsWith('data:') && !r.url().startsWith('blob:')) foreign.push(r.url()); });
  await page.reload();
  await expect(page.locator('#decoderPill')).toHaveAttribute('data-kind', 'ok', { timeout: 20000 });
  await newFile(page, 'Net check');
  await addByHand(page, { serial: 'FJC1111AAAA' });
  expect(foreign).toEqual([]);
});

test('each file is its own data set: numbering and duplicates', async ({ page }) => {
  await newFile(page, 'Site A');
  for (const s of ['FJC1111AAAA', 'FJC2222AAAA', 'fjc1111aaaa']) await addByHand(page, { serial: s });
  await expect(page.locator('#devices .num')).toHaveText(['3', '2', '1']);
  await expect(page.locator('#stDup')).toHaveText('2');
  await home(page);
  await newFile(page, 'Site B');
  await addByHand(page, { serial: 'FJC1111AAAA' });
  await expect(page.locator('#devices .num')).toHaveText(['1']);
  await expect(page.locator('#stDup')).toHaveText('0');
});

test('delete one file and all files', async ({ page }) => {
  await newFile(page, 'One'); await home(page);
  await newFile(page, 'Two'); await home(page);
  await expect(page.locator('#files li')).toHaveCount(2);
  const del = page.locator('#files li').first().locator('.fdel');
  await del.click(); await expect(del).toHaveText('Delete'); await del.click();
  await expect(page.locator('#files li')).toHaveCount(1);
  await page.click('#viewHome details summary');
  await page.click('#btnDelAll'); await page.click('#btnDelAll');
  await expect(page.locator('#files li')).toHaveCount(0);
  await expect(page.locator('#homeEmpty')).toBeVisible();
});

test('data survives a reload', async ({ page }) => {
  await newFile(page, 'Persist');
  await addByHand(page, { assetTag: '001234', serial: 'FJC2611ABCD' });
  await page.reload();
  await expect(page.locator('#devices .card')).toHaveCount(1);
  await page.goto('/');
  await expect(page.locator('#files .name')).toHaveText(['Persist']);
});

test('no horizontal scroll at 360 px', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await newFile(page, 'Narrow');
  await addByHand(page, { serial: 'FJC2611ABCD', mac: 'F4B82188DE00' });
  for (const view of ['file', 'home']) {
    const w = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(w, view).toBeLessThanOrEqual(360);
    if (view === 'file') await home(page);
  }
});
