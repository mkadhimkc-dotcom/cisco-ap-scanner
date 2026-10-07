// Phase 1 acceptance: live scan from Chromium's fake camera fed with test/fixtures/ap.y4m (1920x1080).
// Generate the feed first: npm run fixtures:video
import { test, expect } from '@playwright/test';
import { existsSync } from 'node:fs';
import { feed, fakeCamera, liveRun } from './helpers.mjs';

test.skip(!existsSync(feed('ap')), 'run `npm run fixtures:video` first');
test.use(fakeCamera('ap'));

test('AP feed: MAC, serial, Meraki serial and PID read in < 8 s, no main-thread long tasks', async ({ page }) => {
  const r = await liveRun(page, 'AP', ['mac', 'serial', 'meraki', 'pid'], 8000);
  expect(r.readMs).toBeLessThan(8000);
  expect(r.longTasks.filter(d => d > 50)).toEqual([]);
  expect(r.values).toEqual({ mac: '780F810A68B0', serial: 'FJC295016BD', meraki: 'Q5AP-9XMF-374L', pid: 'CW9166I-B V06' });
});
