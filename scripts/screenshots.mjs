// README screenshots: iPhone 13 viewport, Chromium, fake camera for the live view.
// Usage: npm run fixtures:video && node scripts/screenshots.mjs   (writes docs/screenshots/*.png)
import { spawn } from 'node:child_process';
import { chromium, devices } from '@playwright/test';

const root = new URL('..', import.meta.url).pathname;
const out = name => root + 'docs/screenshots/' + name + '.png';
const PORT = 8766, base = `http://localhost:${PORT}/`;
const server = spawn('node', [root + 'scripts/serve.mjs', String(PORT)], { stdio: 'ignore' });
await new Promise(r => setTimeout(r, 800));

const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream',
  `--use-file-for-fake-video-capture=${root}test/fixtures/ap.y4m`] });
try {
  const ctx = await browser.newContext({ ...devices['iPhone 13'], permissions: ['camera'] });
  const page = await ctx.newPage();
  await page.goto(base);
  await page.waitForSelector('#decoderPill[data-kind="ok"]', { timeout: 30000 });

  async function newFile(name, kind, location, rack) {
    await page.click('#btnNew');
    await page.fill('#newName', name);
    if (location) await page.fill('#newLocation', location);
    if (rack) await page.fill('#newRack', rack);
    await page.check(`#newForm input[name="kind"][value="${kind}"]`, { force: true });
    return page;
  }
  await newFile('Building 2 IDF', 'Switch', 'Building 2', 'IDF-2A');
  await page.click('#newForm button[type=submit]');
  await page.click('#btnBack');
  await newFile('Floor 3 APs', 'AP', 'Building 1, floor 3');
  await page.screenshot({ path: out('new-file') });
  await page.click('#newForm button[type=submit]');
  await page.waitForSelector('#viewFile:not([hidden])');

  await page.click('#btnLive');
  await page.waitForFunction(() => ['mac', 'serial', 'meraki', 'pid'].every(f => document.querySelector(`#found li[data-field="${f}"].got`)), null, { timeout: 30000 });
  await page.screenshot({ path: out('live-scan') });
  await page.click('#btnSaveDev');
  await page.click('#btnStop');

  await page.setInputFiles('#inCam', root + 'test/fixtures/ap.jpg');
  await page.waitForSelector('#dlgAsk[open]', { timeout: 60000 });
  await page.screenshot({ path: out('repeat-prompt') });
  await page.click('#askBtns button[value="new"]');
  await page.waitForFunction(() => document.querySelectorAll('#devices .card').length === 2);
  await page.screenshot({ path: out('file') });

  await page.click('#btnBack');
  await page.screenshot({ path: out('home') });

  await page.click('#files a.file:has-text("Floor 3")');
  await page.waitForSelector('#viewFile:not([hidden])');
  await page.click('#btnExport');
  await page.waitForSelector('#viewExport:not([hidden])');
  await page.screenshot({ path: out('export') });
  await ctx.close();
} finally {
  await browser.close();
  server.kill();
}
console.log('screenshots written to docs/screenshots/');
