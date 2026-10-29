// The 1.0 engine features the starter shows: sign-out keeps this device's data, forget wipes it, and "Check for updates".
import { test, expect, signIn, seenOne, verdictHas, synced, APP, openSettings, openAlign } from './fixtures.mjs';

const kept = page => page.evaluate(async () => {
  let n = 0;
  for (const { name } of await indexedDB.databases()) {
    if (!/facts/.test(name || '')) continue;
    n += await new Promise(res => {
      const r = indexedDB.open(name);
      r.onsuccess = async () => {
        const d = r.result; let c = 0;
        for (const s of d.objectStoreNames) c += await new Promise(ok => { const q = d.transaction(s).objectStore(s).count(); q.onsuccess = () => ok(q.result); q.onerror = () => ok(0); });
        d.close(); res(c);
      };
      r.onerror = () => res(0);
    });
  }
  return n;
});

test('sign-out keeps the phone’s data and unsent saves; the same account carries on', async ({ phone }) => {
  const page = await phone();
  const { uid, email } = await signIn(page, 'member');
  await synced(page);
  await page.context().setOffline(true);
  const fact = await seenOne(page);
  await openSettings(page);
  await page.click('#sign-out');
  await openAlign(page);
  await expect(page.locator('#signed-out')).toBeVisible();
  await expect(page.locator('#sign-out-msg')).toContainText('kept on this device');
  expect(await kept(page)).toBeGreaterThan(0);
  await page.context().setOffline(false);
  await page.evaluate(e => window.starter.signInAs(e), email);
  await expect(page.locator('#align-count')).toBeVisible();
  await verdictHas(uid, fact);
});

test('forget this device: refused while unsent, then wipes the phone', async ({ phone }) => {
  const page = await phone();
  await signIn(page, 'member');
  await synced(page);
  await page.context().setOffline(true);
  await seenOne(page);
  // a swipe made as the notes arrive is lost when the deck is rebuilt, so swipe again until a save is queued (status leaves 'synced')
  await expect.poll(() => page.evaluate(() => { if (window.starter.status !== 'synced') return true; window.align?.go(1); return false; }), { timeout: 20_000 }).toBe(true);
  await openSettings(page);
  await page.click('#sign-out');
  await openAlign(page);
  await page.click('#forget');
  await expect(page.locator('#forget-msg')).toContainText('not sent yet');
  await expect(page.locator('#forget-force')).toBeVisible();
  await page.click('#forget-force');
  await expect(page.locator('#forget-msg')).toContainText('Forgotten');
  expect(await kept(page)).toBe(0);
});

test('check for updates: a new version takes over at once', async ({ phone }) => {
  const page = await phone();
  await page.goto(APP + '&sw', { waitUntil: 'domcontentloaded' });
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller), { timeout: 30_000 }).toBe(true);
  await page.evaluate(() => { window.__same = true; });
  await page.request.get('/__test/bump');
  await openSettings(page);   // the About rows are in Settings
  await page.locator('.ui-check-update').click();
  await expect.poll(() => page.evaluate(() => window.__same).catch(() => undefined), { timeout: 30_000 }).toBeUndefined();
});
