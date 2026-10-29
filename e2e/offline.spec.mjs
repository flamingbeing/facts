// The service worker installs the whole app (the generated SHELL in public/sw.js: the page, its files, vendored
// Firebase and the pinned core files), so a phone that has opened the app once starts it with no network at all.
import { test, expect, setOffline, signIn, seenOne, verdictHas, synced } from './fixtures.mjs';

// every file of sw.js's SHELL is in a cache (the worker takes charge, and WebKit's and Firefox's even report a controller,
// before the cache is full: going offline then leaves the page without the files that were still on their way)
const shellCached = page => page.evaluate(async () => {
  const text = await (await fetch('sw.js', { cache: 'no-store' })).text();
  const list = (text.match(/const SHELL = \[([\s\S]*?)\];/)[1].match(/'([^']+)'/g) ?? []).map(q => new URL(q.slice(1, -1), location.href.split('?')[0]).href.split('?')[0]);
  if (!list.some(u => /\/vendor\/firebase\/[^/]+\/firebase-firestore\.js$/.test(u)) || !list.some(u => /core\.anawj\.com\/sync\/[^/]+\/src\/runner\.js$/.test(u))) throw new Error('SHELL list not read from sw.js');
  const cached = new Set();
  for (const k of await caches.keys()) for (const r of await (await caches.open(k)).keys()) cached.add(r.url.split('?')[0]);
  return list.filter(u => !cached.has(u));
});
const shellFilled = page => expect.poll(() => shellCached(page), { message: 'every SHELL file cached', timeout: 30_000 }).toEqual([]);

test('with no network, the app starts from the service worker and shows Align', async ({ phone }) => {
  const page = await phone();
  const { uid } = await signIn(page, 'member', { path: '/app/?emulator&sw' });
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller), { timeout: 30_000 }).toBe(true);
  await shellFilled(page);
  await seenOne(page);
  await synced(page);
  await setOffline(page.context(), true);
  await page.goto(page.url(), { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#align-view')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('#align-count')).toBeVisible();
  await setOffline(page.context(), false);
});

test('with no network and an expired sign-in token, the app still starts and shows Align', async ({ phone, browserName }) => {
  const page = await phone();
  const { uid } = await signIn(page, 'member', { path: '/app/?emulator&sw' });
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller), { timeout: 30_000 }).toBe(true);
  await shellFilled(page);
  await seenOne(page);
  await synced(page);
  const errors = [];
  // (WebKit reports a Firestore channel request that the route aborted as an uncaught error whose message is just its URL)
  page.on('pageerror', e => { if (!(browserName === 'webkit' && /^\/?127\.0\.0\.1:8080\/google\.firestore\.v1\.Firestore\//.test(e.message))) errors.push(e.message); });
  await setOffline(page.context(), true);
  // the ID token lasts an hour: two hours on, Firebase can't refresh it with no network
  await page.clock.install({ time: Date.now() + 2 * 3600_000 });
  await page.clock.resume();
  await page.goto(page.url(), { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#align-view')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('#align-count')).toBeVisible();
  expect(errors, 'uncaught errors').toEqual([]);
  // back online, it gets a new token and saves reach the server again
  await setOffline(page.context(), false);
  await expect.poll(() => page.evaluate(() => window.starter.ready)).toBe(true);
  const fact = await seenOne(page);
  await verdictHas(uid, fact);
});
