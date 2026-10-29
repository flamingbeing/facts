// The 1.0 engine features the starter shows: sign-out keeps this device's data, forget wipes it, refused saves wait
// in a list, the edit sheet follows its item live (watchDoc), the list marks what changed, and "Check for updates".
import { test, expect, clickOpens, signIn, signInAgain, add, synced, serverHas, uniq, db, itemIdOf, APP, openSettings, openItems } from './fixtures.mjs';

const kept = page => page.evaluate(async () => {
  let n = 0;
  for (const { name } of await indexedDB.databases()) {
    if (!/starter-app/.test(name || '')) continue;
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
  const { email } = await signIn(page, 'member');
  await synced(page);
  const t = uniq('kept');
  await page.context().setOffline(true);
  await add(page, t);
  await openSettings(page);
  await page.click('#sign-out');
  await openItems(page);
  await expect(page.locator('#signed-out')).toBeVisible();
  await expect(page.locator('#sign-out-msg')).toContainText('kept on this device');
  expect(await kept(page)).toBeGreaterThan(0);
  await page.context().setOffline(false);
  await page.evaluate(e => window.starter.signInAs(e), email);
  await expect(page.locator('#list-view')).toBeVisible();
  await expect(page.locator('#items')).toContainText(t);
  await serverHas(t);
});

test('forget this device: refused while unsent, then wipes the phone', async ({ phone }) => {
  const page = await phone();
  await signIn(page, 'member');
  await synced(page);
  await page.context().setOffline(true);
  await add(page, uniq('unsent'));
  await openSettings(page);
  await page.click('#sign-out');
  await openItems(page);
  await page.click('#forget');
  await expect(page.locator('#forget-msg')).toContainText('not sent yet');
  await expect(page.locator('#forget-force')).toBeVisible();
  await page.click('#forget-force');
  await expect(page.locator('#forget-msg')).toContainText('Forgotten');
  expect(await kept(page)).toBe(0);
});

test('a save the server refuses waits in a list until retried or discarded', async ({ phone }) => {
  const page = await phone();
  await signIn(page, 'member');
  await synced(page);
  // the rules refuse text over 500. app-sync may reject the save at once (a fast refusal) or queue it first; either way
  // the add resolves (to '' or the reason), never throws into the page, and the copy waits in the refused list
  const said = await page.evaluate(() => window.starter.add('x'.repeat(501)));
  expect(typeof said).toBe('string');
  await expect(page.locator('#refused li')).toHaveCount(1, { timeout: 15_000 });
  await page.click('#refused li button.discard');
  await expect(page.locator('#refused li')).toHaveCount(0);
  await synced(page);
});

test('the edit sheet follows its item: a change elsewhere shows, a delete elsewhere closes it', async ({ phone }) => {
  const a = await phone(), b = await phone();
  const { email } = await signIn(a, 'member');
  await signInAgain(b, email);
  const t = uniq('live');
  // the watch says what changed: note every item marked so (other tests share the list, and their saves move the mark)
  await b.evaluate(() => {
    const seen = window.changedSeen = /** @type {string[]} */ ([]);
    new MutationObserver(() => document.querySelectorAll('#items li.changed').forEach(li => seen.push(li.textContent || '')))
      .observe(document.getElementById('items'), { subtree: true, childList: true, attributes: true, attributeFilter: ['class'] });
  });
  await add(a, t);
  await expect(b.locator('#items')).toContainText(t);
  await expect.poll(() => b.evaluate(t => window.changedSeen.some(x => x.includes(t)), t)).toBe(true);
  await clickOpens(b.getByRole('button', { name: t }), b.locator('#edit'));
  const itemId = await itemIdOf(t);
  const doc = await db.get(`spaces/_/items/${itemId}`);
  const noNulls = JSON.parse(JSON.stringify(doc, (k, v) => v === null ? undefined : v));   // (the admin helper can't write null)
  await db.put(`spaces/_/items/${itemId}`, { ...noNulls, text: t + '-2', updatedAt: Date.now() });
  await expect(b.locator('#edit-live')).toContainText(t + '-2');
  await db.del(`spaces/_/items/${itemId}`);
  await expect(b.locator('#edit')).not.toBeVisible();
  await expect(b.locator('#edit-msg')).toContainText('deleted on another device');
});

test('a delete elsewhere keeps a draft in the edit sheet; saving it adds it back', async ({ phone }) => {
  const a = await phone(), b = await phone();
  const { email } = await signIn(a, 'member');
  await signInAgain(b, email);
  const t = uniq('draft');
  await add(a, t);
  await expect(b.locator('#items')).toContainText(t);
  await clickOpens(b.getByRole('button', { name: t }), b.locator('#edit'));
  await b.fill('#edit-text', t + '-typed');
  await db.del(`spaces/_/items/${await itemIdOf(t)}`);
  await expect(b.locator('#edit-live')).toContainText('deleted on another device');
  await expect(b.locator('#edit')).toBeVisible();
  await b.click('#edit-save');
  await expect(b.locator('#items')).toContainText(t + '-typed');
  await serverHas(t + '-typed');
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
