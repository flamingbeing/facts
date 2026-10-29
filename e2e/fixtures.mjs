// Shared steps for the specs. Every test uses its own made-up accounts and its own item texts, so tests run side by
// side on the one shared list. A page that reports a Content-Security-Policy violation fails its test.
import { test as base, expect, webkit } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
// cloud{ the emulators (a static app has none: tools/flavour.mjs)
import { fsAdmin } from '../.devkit/playwright/helpers.mjs';

export const db = fsAdmin('demo-facts');
export const APP = '/app/?emulator';
// }cloud
/* static{
// ?test: no service worker unless ?sw is given too (app.js)
export const APP = '/app/?test';
}static */
export const uniq = (p = 't') => `${p}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

// SYNC_DIR: a local app-sync build (its entry files and src/) served in place of core.anawj.com/sync/<version>/, so
// app-sync's CI can run these tests against a candidate before it is released (its consumer-test job).
const SYNC_DIR = process.env.SYNC_DIR ? path.resolve(process.env.SYNC_DIR) : '';
async function routeSync(context, served) {
  await context.route(/^https:\/\/core\.anawj\.com\/sync\/[^/]+\/(.+)$/, route => {
    const rel = new URL(route.request().url()).pathname.split('/').slice(3).join('/');
    const file = path.join(SYNC_DIR, rel);
    if (!file.startsWith(SYNC_DIR + path.sep) || !fs.existsSync(file)) return route.fulfill({ status: 404, body: 'not in SYNC_DIR' });
    served.n++;
    return route.fulfill({ status: 200, contentType: 'text/javascript', headers: { 'access-control-allow-origin': '*' }, body: fs.readFileSync(file) });
  });
}

// UI_DIR: a local app-ui checkout served in place of core.anawj.com/ui/<version>/, so a candidate (an unreleased
// app-ui change) can be tried in this app before it is released
const UI_DIR = process.env.UI_DIR ? path.resolve(process.env.UI_DIR) : '';
const TYPES = { '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' };
async function routeUi(context) {
  await context.route(/^https:\/\/core\.anawj\.com\/ui\/[^/]+\/(.+)$/, route => {
    const rel = new URL(route.request().url()).pathname.split('/').slice(3).join('/');
    const file = path.join(UI_DIR, rel);
    if (!file.startsWith(UI_DIR + path.sep) || !fs.existsSync(file)) return route.fulfill({ status: 404, body: 'not in UI_DIR' });
    return route.fulfill({ status: 200, contentType: TYPES[path.extname(file)] ?? 'application/octet-stream', headers: { 'access-control-allow-origin': '*' }, body: fs.readFileSync(file) });
  });
}

// The UI kit (core.anawj.com/ui/) loads live, as the app does. One failed fetch there (a 5xx, a reset) leaves the app
// unbooted, so a failed fetch is tried again; after that the page's own request goes out as it would have.
async function routeUiRetry(context) {
  await context.route(/^https:\/\/core\.anawj\.com\/ui\//, async route => {
    for (let i = 0; i < 3; i++) {
      let response = null;
      try { response = await route.fetch({ timeout: 8_000 }); } catch { /* retry */ }
      if (response && response.status() < 500) return route.fulfill({ response }).catch(() => {});   // closed page: nothing to serve
      await new Promise(r => setTimeout(r, 300 * (i + 1)));
    }
    await route.continue().catch(() => {});
  });
}

// Hermetic for the rest: the pages load the sync and update modules from core.anawj.com, a stylesheet from
// design.flamingbeing.com and (Firebase Auth's SDK) Google's gapi scripts. A stalled fetch to any of them made tests swing
// with the internet, so those core files come from e2e/fixtures/core/ (a copy of the pinned versions: refresh with
// tools/refresh-core-fixtures.sh after changing a version), the stylesheet is empty and the Google hosts are refused. A
// core file not in the copy fails loudly. The UI kit falls through to the live route above (or UI_DIR).
const CORE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'core');
// Under app-sync's consumer test (app-devkit serve-candidate) the engine and update module come from the candidate:
// its route sits under this one, so /sync/ and /update/ fall through to it.
const CANDIDATE = !!process.env.SERVE_CANDIDATE_SYNC;
async function routeHermetic(context) {
  await routeUiRetry(context);
  await context.route(/^https:\/\/core\.anawj\.com\//, route => {
    const rel = decodeURIComponent(new URL(route.request().url()).pathname);
    if (rel.startsWith('/ui/')) return route.fallback();
    if (CANDIDATE && /^\/(sync|update)\//.test(rel)) return route.fallback();
    const file = path.join(CORE, rel);
    if (!file.startsWith(CORE + path.sep) || !fs.existsSync(file)) return route.fulfill({ status: 404, body: `not in e2e/fixtures/core: ${rel}` });
    return route.fulfill({ status: 200, contentType: TYPES[path.extname(file)] || 'application/octet-stream', headers: { 'access-control-allow-origin': '*' }, body: fs.readFileSync(file) });
  });
  if (UI_DIR) await routeUi(context);   // registered later: wins over both routes above
  await context.route('https://design.anawj.com/**', route => route.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  await context.route(/^https:\/\/(apis|www)\.google\.com\//, route => route.abort('blockedbyclient'));
}

// every new context: collect CSP reports; and the glass guard has already found this device fast (theme/guard.js),
// so a slow CI runner's frames can't turn glass down mid-test (looks.spec runs the guard itself, on its own context)
const seed = () => {
  // Firebase Auth's SDK adds Google's gapi script (apis.google.com); Playwright's route cannot refuse it on a page the service
  // worker controls (Firefox and WebKit don't route the worker's own fetches), and it ran live there: so it never loads, and
  // its load fails as a blocked request does.
  const { get, set } = Object.getOwnPropertyDescriptor(HTMLScriptElement.prototype, 'src');
  Object.defineProperty(HTMLScriptElement.prototype, 'src', { configurable: true, get, set(url) {
    if (/^https:\/\/apis\.google\.com\//.test(url)) return void setTimeout(() => this.dispatchEvent(new Event('error')));
    set.call(this, url);
  } });
  window.__csp = [];
  addEventListener('securitypolicyviolation', e => window.__csp.push(`${e.violatedDirective} ${e.blockedURI}`));
  try {
    if (!localStorage.getItem('core-glass-guard')) localStorage.setItem('core-glass-guard', JSON.stringify({ solid: false, why: '' }));
  } catch { /* an opaque origin: nothing to keep */ }
};

// Firefox has no mobile emulation (isMobile throws); touch and the viewport work everywhere
const touch = (browserName, mobile = true) => ({ hasTouch: true, ...(mobile && browserName !== 'firefox' ? { isMobile: true } : {}) });

// A fresh context. WebKit's ephemeral contexts cannot keep a Blob in IndexedDB (the write fails with a null error, so the
// files module's add() throws), a persistent profile can (`blobs`: each context is then its own browser on a new temp
// profile). But a persistent profile's Cache API stays empty for the service worker, so only the files tests ask for it.
async function newContext(browser, browserName, options, blobs = false) {
  if (browserName !== 'webkit' || !blobs) return browser.newContext(options);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-webkit-'));
  const context = await webkit.launchPersistentContext(dir, options);
  context.once('close', () => fs.rmSync(dir, { recursive: true, force: true }));
  return context;
}

// Offline for a context. In WebKit, setOffline also fails the reload that the service worker should answer ("WebKit
// encountered an internal error") and blob: images; in Firefox that reload can hang. A route that aborts the page's other
// requests does neither. (Chromium keeps setOffline.)
const routed = new WeakMap(), NETWORK = /^https?:/;
export async function setOffline(context, offline) {
  const engine = context.browser()?.browserType().name() ?? 'webkit';   // (no browser: a persistent profile, WebKit only)
  if (engine === 'chromium') return context.setOffline(offline);
  const handler = route => route.request().resourceType() === 'document' ? route.continue() : route.abort('internetdisconnected');   // (a navigation is the worker's to answer; the route sees it first)
  if (offline && !routed.has(context)) { routed.set(context, handler); await context.route(NETWORK, handler); }
  else if (!offline && routed.has(context)) { await context.unroute(NETWORK, routed.get(context)); routed.delete(context); }
}

export const test = base.extend({
  // a new phone: its own browser context; CSP reports collected for the check after the test
  phone: async ({ browser, browserName }, use) => {
    const made = [];
    await use(async ({ blobs = false } = {}) => {
      const context = await newContext(browser, browserName, { viewport: { width: 390, height: 844 }, ...touch(browserName) }, blobs);
      await context.addInitScript(seed);
      const served = { n: 0, built: 0 };
      await routeHermetic(context);
      if (SYNC_DIR) await routeSync(context, served);
      // APP_DIR (a Vite build, e2e/serve.mjs): count the built bundle's loads, so the run proves it tested dist/
      if (process.env.APP_DIR) context.on('request', r => { if (/\/app\/assets\/[^/]+\.js$/.test(r.url())) served.built++; });
      const page = await context.newPage();
      made.push({ context, page, served });
      return page;
    });
    await check(made);
  },
  // a touch screen of this width (390 phone, 820 tablet, 1280 laptop with touch): the same CSP check after the test
  sized: async ({ browser, browserName }, use) => {
    const made = [];
    await use(async (/** @type {number} */ width) => {
      const height = width < 600 ? 844 : width < 1000 ? 1180 : 800;
      const context = await newContext(browser, browserName, { viewport: { width, height }, ...touch(browserName, width < 1000) });
      await context.addInitScript(seed);
      await routeHermetic(context);
      const page = await context.newPage();
      made.push({ context, page, served: null });
      return page;
    });
    await check(made);
  },
});
export { expect };

// close each context and fail the test on any CSP report (and, for the phone, on what SYNC_DIR / APP_DIR must have served)
async function check(made) {
  for (const { context, page, served } of made) {
    const v = await page.evaluate(() => window.__csp || []).catch(() => []);
    await context.close();
    expect(v, 'CSP violations').toEqual([]);
    if (!served) continue;
    if (SYNC_DIR) expect(served.n, 'app-sync files served from SYNC_DIR').toBeGreaterThan(0);
    if (process.env.APP_DIR) expect(served.built, 'the built bundle (APP_DIR) loaded').toBeGreaterThan(0);
  }
}

// cloud{ sign-in and the server's copy
// Sign in as a new made-up Google account; with a role, an admin "adds" it (the role doc) and the page picks the
// new claims up by itself. -> { uid, email }
export async function signIn(page, role = 'member', { path = APP } = {}) {
  const email = `${uniq('u')}@example.com`;
  // (not 'load': that waits on the design kit and core files over the internet, which can stall for a minute; the next line waits for the page itself)
  await page.goto(path, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#signed-out')).toBeVisible();
  await page.evaluate(e => window.starter.signInAs(e), email);
  await expect(page.locator('#no-access')).toBeVisible();
  const uid = await page.locator('#uid').textContent();
  if (role) {
    await db.put(`members/${uid}`, { role, v: 1 });
    await expect(page.locator('#align-view')).toBeVisible();
    await expect.poll(() => page.evaluate(() => window.starter.ready)).toBe(true);
  }
  return { uid, email };
}

// The same account on a second phone (a new context signs in with the same made-up Google credential)
export async function signInAgain(page, email) {
  await page.goto(APP, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#signed-out')).toBeVisible();
  await page.evaluate(e => window.starter.signInAs(e), email);
  await expect(page.locator('#align-view')).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.starter.ready)).toBe(true);
}

// }cloud
/* static{
// A static app has no sign-in: the step a cloud app's tests sign in with only opens the list. -> {}
export async function signIn(page, role = 'member', { path = APP } = {}) {
  await page.goto(path, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#align-view')).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.starter.ready)).toBe(true);
  return {};
}
}static */

// Open a dialog from its button and wait for the dialog. The list redraws its buttons whenever a snapshot lands (the files
// snapshot follows the first list one); a pointer click whose button is swapped out between press and release is dropped
// (Firefox). The click event is sent in one step instead, to the button as it is now: nothing in between to be swapped.
// The Settings page and Align (tabs on a phone, side-bar links from 600 px)
const tabLink = id => `.ui-tab[data-tab-page="#${id}"]:visible, .ui-side-link[data-tab-page="#${id}"]:visible`;
// (the tab bar folds its other tabs away once the page scrolls down: back at the top they show)
const toTop = page => page.evaluate(() => { scrollTo(0, 0); document.querySelector('.ui-tabbar')?.classList.remove('is-minimised'); });
export const openSettings = async page => { await toTop(page); await page.locator(tabLink('settings-page')).first().click(); await expect(page.locator('#settings-host')).toBeVisible(); };
export const openAlign = async page => { await toTop(page); await page.locator(tabLink('align-page')).first().click(); await expect(page.locator('#align-page')).toBeVisible(); };
export const clickOpens = async (button, dialog) => { await button.dispatchEvent('click'); await expect(dialog).toBeVisible(); };
// An Align card swiped on: its 'seen' verdict is the app's one small save. -> the line it was saved for
export const seenOne = page => page.evaluate(() => { const line = window.align.deck()[window.align.index()]; window.align.go(1); return line; });
// cloud{
export const verdictHas = (uid, fact) => expect.poll(async () => (await db.list('spaces/_/verdicts')).some(d => d.by === uid && d.fact === fact), { timeout: 15_000 }).toBe(true);
// }cloud
export const synced = page => expect.poll(() => page.evaluate(() => window.starter.status), { timeout: 15_000 }).toBe('synced');
