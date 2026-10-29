// A static app's list: this device only, no sign-in (app/src/local.js). It is kept in IndexedDB, so a reload and a
// start with no network (the service worker) show it again; other tabs hear each change.
import { test, expect, setOffline, uniq, signIn, add, clickOpens, openSettings, openItems } from './fixtures.mjs';

test('adds, edits and deletes; the list stays after a reload', async ({ phone }) => {
  const page = await phone();
  await signIn(page);
  const t = uniq('item');
  await add(page, t);
  await clickOpens(page.getByRole('button', { name: t }), page.locator('#edit'));
  await page.fill('#edit-text', t + ' edited');
  await page.click('#edit-save');
  await expect(page.locator('#items')).toContainText(t + ' edited');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.locator('#items')).toContainText(t + ' edited');

  await clickOpens(page.getByRole('button', { name: t + ' edited' }), page.locator('#edit'));
  await page.click('#edit-delete');
  await expect(page.locator('#items')).not.toContainText(t);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect.poll(() => page.evaluate(() => window.starter.ready)).toBe(true);
  await expect(page.locator('#items')).not.toContainText(t);
});

test('no sign-in: no account footer, no sync chip, settings open at once', async ({ phone }) => {
  const page = await phone();
  await signIn(page);
  await expect(page.locator('#signed-out, #sign-out, #sync-chip')).toHaveCount(0);
  await openSettings(page);
  await page.getByRole('switch', { name: /Show how many items/ }).check();
  await openItems(page);
  await expect(page.locator('#count')).toBeVisible();
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect.poll(() => page.evaluate(() => window.starter.ready)).toBe(true);
  await expect(page.locator('#count')).toBeVisible();
});

test('another tab of the app hears each change', async ({ phone }) => {
  const a = await phone();
  await signIn(a);
  const b = await a.context().newPage();
  await signIn(b);
  const t = uniq('both');
  await add(a, t);
  await expect(b.locator('#items')).toContainText(t);
});

test('with no network, the app starts from the service worker and shows the saved list', async ({ phone }) => {
  const page = await phone();
  await signIn(page, 'member', { path: '/app/?test&sw' });
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller), { timeout: 30_000 }).toBe(true);
  const cachedUrls = () => page.evaluate(async () => {
    const urls = [];
    for (const k of await caches.keys()) for (const r of await (await caches.open(k)).keys()) urls.push(r.url);
    return urls;
  });
  await expect.poll(async () => (await cachedUrls()).some(u => /core\.anawj\.com\/sync\/[^/]+\/src\/store\.js$/.test(u)), { message: 'core files precached', timeout: 30_000 }).toBe(true);
  const t = uniq('kept');
  await add(page, t);
  await setOffline(page.context(), true);
  await page.goto(page.url(), { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#list-view')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('#items')).toContainText(t);
  await setOffline(page.context(), false);
});
