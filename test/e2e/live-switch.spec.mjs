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
