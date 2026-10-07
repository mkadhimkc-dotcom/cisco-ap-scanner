// Live scan of the switch label stack from the fake camera (test/fixtures/switch.y4m).
import { test, expect } from '@playwright/test';
import { existsSync } from 'node:fs';
import { feed, fakeCamera, liveRun } from './helpers.mjs';

test.skip(!existsSync(feed('switch')), 'run `npm run fixtures:video` first');
test.use(fakeCamera('switch'));

test('switch feed: every switch field read and confirmed', async ({ page }) => {
  const r = await liveRun(page, 'Switch', ['assetTag', 'mac', 'serial', 'pid', 'partNo', 'clei'], 20000);
  expect(r.longTasks.filter(d => d > 50)).toEqual([]);
  expect(r.values).toEqual({ assetTag: '298366', mac: 'F4B82188DE00', serial: 'FJC302010KM', pid: 'C9300-48UN-A V10', partNo: '800-107831-05 D0', clei: 'INMGV10CRE' });
});

test('Scan asset tag: single-code mode fills the asset tag and returns', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#decoderPill')).toHaveAttribute('data-kind', 'ok', { timeout: 30000 });
  const { newFile, addByHand } = await import('./helpers.mjs');
  await newFile(page, 'Asset tag', 'Switch');
  await addByHand(page, { serial: 'FJC302010KM' });
  await page.locator('#devices .card').first().locator('[data-act="asset"]').click();
  await expect(page.locator('#livePanel')).toBeHidden({ timeout: 15000 });
  await expect(page.locator('#devices .card input[data-field="assetTag"]')).toHaveValue('298366');
  await expect(page.locator('#status')).toContainText('Asset tag 298366 added to #1');
  await expect(page.locator('#devices .card input[data-field="mac"]')).toHaveValue('', { timeout: 1 });
});
