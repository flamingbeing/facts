// Soak specs for a static app (soak/static-soak.mjs copies this file into the generated app's e2e/). Made-up data only.
// Invariants: a save the list has shown survives a reload; a lost or refused IndexedDB never crashes the page;
// whatever the page did, a reload ends in a working list.
import { test, expect, setOffline, uniq, signIn, add } from './fixtures.mjs';

const engine = page => page.context().browser()?.browserType().name();
// SOAK_THROTTLE=n: Chromium runs n times slower (a cheap phone); other browsers ignore it
const slow = async page => {
  const n = +process.env.SOAK_THROTTLE || 1;
  if (n > 1 && engine(page) === 'chromium') await (await page.context().newCDPSession(page)).send('Emulation.setCPUThrottlingRate', { rate: n });
  return page;
};
// the app reloads itself when a new worker takes over; a test reload that lands on that one is aborted, not a failure
// (then wait for that reload's document). Firefox: page.reload can hang when the worker answers (see setOffline in
// fixtures.mjs), so it goes to the same URL (the app's URLs carry no hash)
const reload = page => (engine(page) === 'firefox' ? page.goto(page.url(), { waitUntil: 'domcontentloaded' }) : page.reload({ waitUntil: 'domcontentloaded' }))
  .catch(async e => { if (!/ERR_ABORTED|interrupted by another navigation/.test(e.message)) throw e; await page.waitForLoadState('domcontentloaded'); });
const ready = page =>
  expect.poll(() => page.evaluate(() => window.starter.ready).catch(() => false), { timeout: 20_000 })   // (a worker update may reload the page under the poll)
  .toBe(true);
const texts = page => page.locator('#items').evaluate(el => el.textContent);

test('offline: saves made with no network are there after an offline reload', async ({ phone }) => {
  const page = await slow(await phone());
  await signIn(page, 'member', { path: '/app/?test&sw' });
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller), { timeout: 30_000 }).toBe(true);
  await setOffline(page.context(), true);
  const t = [uniq('off'), uniq('off'), uniq('off')];
  for (const x of t) await add(page, x);
  await reload(page);
  await ready(page);
  for (const x of t) await expect(page.locator('#items')).toContainText(x);
  await setOffline(page.context(), false);
  await reload(page);
  await ready(page);
  for (const x of t) await expect(page.locator('#items')).toContainText(x);
});

test('reload in the middle of a save: shown means kept, never doubled', async ({ phone }) => {
  const page = await slow(await phone());
  await signIn(page);
  const kept = [];
  for (let i = 0; i < 8; i++) {
    const x = uniq('mid' + i);
    await page.fill('#new-text', x);
    await page.click('#add button[type=submit]');
    if (i % 2) await page.waitForTimeout(i * 7);   // 0..49 ms: the reload lands before, during or after the write
    const shown = await page.locator('#items').evaluate((el, x) => el.textContent.includes(x), x).catch(() => false);
    await reload(page);
    await ready(page);
    const body = await texts(page);
    if (shown) { expect(body, `${x} was shown before the reload`).toContain(x); kept.push(x); }
    if (body.includes(x)) kept.includes(x) || kept.push(x);
  }
  const body = await texts(page);
  for (const x of kept) expect(body.split(x).length - 1, `${x} once`).toBe(1);
});

test('IndexedDB deleted under a running page: no crash, a reload gives an empty working list', async ({ phone }) => {
  const page = await slow(await phone());
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await signIn(page);
  const x = uniq('gone');
  await add(page, x);
  await page.evaluate(async () => {
    for (const { name } of await indexedDB.databases()) await new Promise(r => { const q = indexedDB.deleteDatabase(name); q.onsuccess = q.onerror = q.onblocked = () => r(); });
  });
  await reload(page);
  await ready(page);
  await expect(page.locator('#items')).not.toContainText(x);
  const y = uniq('after');
  await add(page, y);
  await reload(page);
  await ready(page);
  await expect(page.locator('#items')).toContainText(y);
  expect(errors, 'page errors').toEqual([]);
});

test('IndexedDB refuses writes (quota): the page keeps working, the next start is clean', async ({ phone }) => {
  const page = await slow(await phone());
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await signIn(page);
  const before = uniq('before');
  await add(page, before);
  await page.evaluate(() => {
    const quota = () => { throw new DOMException('The quota has been exceeded.', 'QuotaExceededError'); };
    for (const m of ['put', 'add']) IDBObjectStore.prototype[m] = quota;
    IDBTransaction.prototype.commit = quota;
  });
  const x = uniq('quota');
  await page.fill('#new-text', x);
  await page.click('#add button[type=submit]');
  await page.waitForTimeout(300);
  await expect(page.locator('#list-view')).toBeVisible();   // still there, not a blank page
  await reload(page);     // new document: the stub is gone
  await ready(page);
  await expect(page.locator('#items')).toContainText(before);
  const y = uniq('ok');
  await add(page, y);
  await reload(page);
  await ready(page);
  await expect(page.locator('#items')).toContainText(y);
});

// How a browser says "no storage" (private windows, blocked cookies, lockdown): each way must leave a working list.
const NO_STORAGE = {
  'indexedDB.open fails with an error event': () => {
    const fail = () => { const r = {}; setTimeout(() => { r.error = new DOMException('denied', 'SecurityError'); r.onerror?.({ target: r, preventDefault() {} }); }, 0); return r; };
    IDBFactory.prototype.open = fail;
  },
  'indexedDB.open throws': () => { IDBFactory.prototype.open = () => { throw new DOMException('denied', 'SecurityError'); }; },
  'localStorage throws': () => { Object.defineProperty(window, 'localStorage', { configurable: true, get() { throw new DOMException('denied', 'SecurityError'); } }); },
  // the window.indexedDB getter itself throws (Firefox with cookies blocked); an app-sync edge, see soak/FINDINGS in the Life notes
  'indexedDB getter throws': () => { Object.defineProperty(window, 'indexedDB', { configurable: true, get() { throw new DOMException('denied', 'SecurityError'); } }); },
};
for (const [how, stub] of Object.entries(NO_STORAGE)) {
  test(`storage unavailable (${how}): the list works for the page, no crash`, async ({ phone }) => {
    test.fixme(how === 'indexedDB getter throws' && !process.env.SOAK_STRICT, 'app-sync store.js: typeof indexedDB throws');
    const page = await slow(await phone());
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.context().addInitScript(`(${stub})()`);
    await page.goto('/app/?test', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#list-view')).toBeVisible();
    await ready(page);
    const x = uniq('mem');
    await add(page, x);
    expect(errors, 'page errors').toEqual([]);
  });
}

test('a new version found while the list has saved items: nothing lost, online or offline', async ({ phone }) => {
  const page = await slow(await phone());
  await signIn(page, 'member', { path: '/app/?test&sw' });
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller), { timeout: 30_000 }).toBe(true);
  const x = uniq('upd');
  await add(page, x);
  await page.request.get('/__test/bump');
  await page.evaluate(() => navigator.serviceWorker.getRegistration().then(r => r.update()));
  await page.waitForTimeout(500);
  await reload(page);
  await ready(page);
  await expect(page.locator('#items')).toContainText(x);
  await setOffline(page.context(), true);
  await reload(page);
  await ready(page);
  await expect(page.locator('#items')).toContainText(x);
});
