// Phase 2: confidence, validators, repeat prompt, undo, merge.
import { test, expect } from '@playwright/test';
import { newFile, addByHand } from './helpers.mjs';

const photo = name => new URL(`../fixtures/${name}`, import.meta.url).pathname;

test.beforeEach(async ({ page }) => {
  page.errors = [];
  page.on('pageerror', e => page.errors.push(e.message));
  await page.goto('/');
  await expect(page.locator('#decoderPill')).toHaveAttribute('data-kind', 'ok', { timeout: 30000 });
});
test.afterEach(async ({ page }) => { expect(page.errors).toEqual([]); });

async function addPhoto(page, name) {
  await page.setInputFiles('#inCam', photo(name));
}

test('photo scan: confidence dots, serial date code, OUI check, hardware rev', async ({ page }) => {
  await newFile(page, 'Photos', 'AP');
  await addPhoto(page, 'ap.jpg');
  await expect(page.locator('#devices .card')).toHaveCount(1, { timeout: 60000 });
  const card = page.locator('#devices .card').first();
  await expect(card.locator('.conf.confirmed').first()).toBeVisible();
  await expect(card.locator('.fmsg.ok', { hasText: 'Site FJC · mfg 2025 wk 50' })).toBeVisible();
  await expect(card.locator('.fmsg.ok', { hasText: 'Meraki OUI' })).toBeVisible();
  await expect(card.locator('input[data-field="hwRev"]')).toHaveValue('V06');
  // typing makes the value "typed"; an odd MAC gets a warning (not blocked)
  const mac = card.locator('input[data-field="mac"]');
  await mac.fill('00:11:22:33:44:55'); await mac.dispatchEvent('change');
  await expect(card.locator('.fmsg.warn', { hasText: 'Unusual OUI 00:11:22' })).toBeVisible();
  await expect(mac.locator('xpath=..').locator('.conf.manual')).toBeVisible();
  await expect(mac).toHaveValue('001122334455');
});

test('repeat scan asks: Open existing merges, Add as new adds a flagged duplicate', async ({ page }) => {
  await newFile(page, 'Repeats', 'AP');
  await addPhoto(page, 'ap.jpg');
  await expect(page.locator('#devices .card')).toHaveCount(1, { timeout: 60000 });
  await addPhoto(page, 'ap.jpg');
  await expect(page.locator('#dlgAsk')).toBeVisible({ timeout: 60000 });
  await expect(page.locator('#askTitle')).toHaveText('Already in this file as #1');
  await page.click('#askBtns button[value="open"]');
  await expect(page.locator('#devices .card')).toHaveCount(1);
  await addPhoto(page, 'ap.jpg');
  await expect(page.locator('#dlgAsk')).toBeVisible({ timeout: 60000 });
  await page.click('#askBtns button[value="new"]');
  await expect(page.locator('#devices .card')).toHaveCount(2);
  await expect(page.locator('#stDup')).toHaveText('2');
});

test('delete with undo; merge into another device with undo', async ({ page }) => {
  await newFile(page, 'Edits', 'Switch');
  await addByHand(page, { serial: 'FJC302010KM', mac: 'F4B82188DE00' });
  await addByHand(page, { assetTag: '298366', serial: 'FJC302010KM' });
  await expect(page.locator('#devices .card')).toHaveCount(2);
  // delete #2, undo
  await page.locator('#devices .card').first().locator('[data-act="del"]').click();
  await expect(page.locator('#devices .card')).toHaveCount(1);
  await expect(page.locator('#toast')).toBeVisible();
  await page.click('#btnUndo');
  await expect(page.locator('#devices .card')).toHaveCount(2);
  // merge #2 (asset tag) into #1 (MAC)
  await page.locator('#devices .card').first().locator('[data-act="merge"]').click();
  await page.locator('#askBtns button.listbtn').first().click();
  await expect(page.locator('#devices .card')).toHaveCount(1);
  const card = page.locator('#devices .card').first();
  await expect(card.locator('input[data-field="assetTag"]')).toHaveValue('298366');
  await expect(card.locator('input[data-field="mac"]')).toHaveValue('F4B82188DE00');
  await page.click('#btnUndo');
  await expect(page.locator('#devices .card')).toHaveCount(2);
  // the undo window closes after 5 s
  await page.locator('#devices .card').first().locator('[data-act="del"]').click();
  await expect(page.locator('#toast')).toBeHidden({ timeout: 7000 });
  await expect(page.locator('#devices .card')).toHaveCount(1);
});

test('export warns about values read only once', async ({ page }) => {
  await newFile(page, 'Once', 'Switch');
  await addPhoto(page, 'switch.jpg');   // the photo pipeline reads the Code39 asset tag in one pass only
  await expect(page.locator('#devices .card')).toHaveCount(1, { timeout: 60000 });
  await page.click('#btnExport');
  await expect(page.locator('#exOnceCallout')).toContainText('read only once');
  await expect(page.locator('#exOnceCallout')).toContainText('#1 Asset tag');
});
