// Phase 5: offline via the service worker, update flow, themes, accessibility (axe-core, WCAG 2.1 AA).
import { test, expect } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { newFile, addByHand } from './helpers.mjs';

const AXE = new URL('../../node_modules/axe-core/axe.min.js', import.meta.url).pathname;

async function ready(page) {
  await expect(page.locator('#decoderPill')).toHaveAttribute('data-kind', 'ok', { timeout: 30000 });
}
async function swControlled(page) {
  await page.waitForFunction(() => navigator.serviceWorker && navigator.serviceWorker.controller, null, { timeout: 30000 });
}

test('works offline after the first visit (app shell, decoder, fonts from the cache)', async ({ page, context }) => {
  await page.goto('/');
  await ready(page);
  await swControlled(page);
  await context.setOffline(true);
  await page.reload();
  await ready(page);
  await newFile(page, 'Offline closet', 'Switch');
  await page.setInputFiles('#inCam', new URL('../fixtures/switch.jpg', import.meta.url).pathname);
  await expect(page.locator('#devices .card input[data-field="serial"]')).toHaveValue('FJC302010KM', { timeout: 60000 });
  expect(await page.evaluate(() => document.fonts.check('16px "IBM Plex Sans"'))).toBe(true);
  await context.setOffline(false);
});

test('a new version shows "Update ready" and Reload switches to it', async ({ page }) => {
  await page.goto('/');
  await ready(page);
  await swControlled(page);
  // publish a "new version": the server reads site/ from disk, so change sw.js there and put it back after
  const path = new URL('../../site/sw.js', import.meta.url).pathname;
  const original = readFileSync(path, 'utf8');
  try {
    writeFileSync(path, original.replace(/const BUILD = '[0-9a-f]*'/, "const BUILD = 'testupdate'"));
    await page.evaluate(() => navigator.serviceWorker.getRegistration().then(r => r.update()));
    await expect(page.locator('#updateBar')).toBeVisible({ timeout: 30000 });
    await Promise.all([page.waitForEvent('load'), page.click('#btnUpdate')]);
    await expect.poll(() => page.evaluate(() => caches.keys())).toEqual(['label-scanner-2.0.0-testupdate']);
    await expect(page.locator('#updateBar')).toBeHidden();
  } finally {
    writeFileSync(path, original);
  }
});

for (const theme of ['light', 'dark']) {
  test(`accessibility (${theme} theme): no WCAG 2.1 AA violations on any screen`, async ({ page }) => {
    await page.goto('/');
    await ready(page);
    await page.evaluate(t => { document.documentElement.dataset.theme = t; }, theme);
    const check = async (where) => {
      await page.addScriptTag({ path: AXE });
      const r = await page.evaluate(async () => (await window.axe.run(document, { runOnly: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] })).violations
        .map(v => ({ id: v.id, impact: v.impact, nodes: v.nodes.slice(0, 3).map(n => n.target.join(' ') + ' :: ' + (n.failureSummary || '').split('\n')[1]) })));
      expect(r, where).toEqual([]);
    };
    await page.click('#viewHome details summary');
    await check('home');
    await page.click('#btnNew');
    await check('new file sheet');
    await page.click('#newForm button[type=submit]');
    await page.waitForSelector('#viewFile:not([hidden])');
    await addByHand(page, { serial: 'FJC302010KM', mac: '001122334455' });
    await addByHand(page, { serial: 'FJC302010KM' });
    await check('file with cards, warnings and a duplicate');
    await page.click('#btnExport');
    await check('export');
    await page.click('#btnTplNew');
    await check('template editor');
  });
}

test('theme setting is applied and remembered', async ({ page }) => {
  await page.goto('/');
  await ready(page);
  await page.click('#viewHome details summary');
  await page.selectOption('#theme', 'dark');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  expect(bg).toBe('rgb(15, 20, 27)');
});
