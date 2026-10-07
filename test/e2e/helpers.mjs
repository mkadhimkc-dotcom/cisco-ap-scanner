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
