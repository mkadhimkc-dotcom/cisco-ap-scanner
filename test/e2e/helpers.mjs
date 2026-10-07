export async function newFile(page, name, kind = 'AP') {
  await page.click('#btnNew');
  await page.fill('#newName', name);
  await page.check(`#newForm input[name="kind"][value="${kind}"]`, { force: true });
  await page.click('#newForm button[type=submit]');
  await page.waitForSelector('#viewFile:not([hidden])');
}
export async function addByHand(page, fields) {
  await page.click('#btnManual');
  const id = await page.$eval('#devices li', li => li.dataset.row);
  for (const [k, v] of Object.entries(fields)) {
    await page.fill(`#f-${id}-${k}`, v);
    await page.dispatchEvent(`#f-${id}-${k}`, 'change');
  }
  return id;
}
export async function home(page) {
  await page.click('#btnBack');
  await page.waitForSelector('#viewHome:not([hidden])');
}

import { expect } from '@playwright/test';
export const feed = name => new URL(`../fixtures/${name}.y4m`, import.meta.url).pathname;
export const fakeCamera = name => ({
  permissions: ['camera'],
  launchOptions: { args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-video-capture=${feed(name)}`] }
});

export async function liveRun(page, kind, fields, limitMs) {
  await page.goto('/');
  await expect(page.locator('#decoderPill')).toHaveAttribute('data-kind', 'ok', { timeout: 30000 });
  await newFile(page, 'Live ' + kind, kind);
  await page.evaluate(() => {
    window.__long = [];
    new PerformanceObserver(list => { for (const e of list.getEntries()) window.__long.push(Math.round(e.duration)); }).observe({ type: 'longtask' });
  });
  const t0 = Date.now();
  await page.click('#btnLive');
  const count = (cls) => page.waitForFunction(([fs, cl]) => fs.every(f => {
    const li = document.querySelector(`#found li[data-field="${f}"]`);
    return li && cl.some(c => li.classList.contains(c));
  }), [fields, cls], { timeout: cls.length > 1 ? limitMs : 20000, polling: 50 });
  await count(['got', 'single']);
  const readMs = Date.now() - t0;
  await count(['got']);
  const confirmedMs = Date.now() - t0;
  const longTasks = await page.evaluate(() => window.__long);
  const values = await page.$$eval('#found li.got', els => Object.fromEntries(els.map(e => [e.dataset.field, e.querySelector('.v').firstChild.textContent])));
  console.log(`${kind}: all read in ${readMs} ms, all confirmed in ${confirmedMs} ms, long tasks: ${JSON.stringify(longTasks)}`);
  return { readMs, confirmedMs, longTasks, values };
}

