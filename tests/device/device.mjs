// Device test against a LIVE deployed copy of the app (not part of `npx playwright test`; run per starter release).
// Four checks, two "devices" signed in as the same test user:
//   1 offline save, force-quit, reopen, reconnect: the save is there and sent
//   2 two devices: edit + delete on one, seen on the other
//   3 offline save, sign out, sign in: nothing lost
//   4 installed app, new deploy, update works (two phases: `install` before the deploy, `update` after it)
// Extra checks (`--phase=extra`, run after the four on a good deploy; not part of `all`):
//   5 the same item edited offline on both devices: both reconnect, both end on the same text, nothing lost or doubled
//   6 twelve offline saves, force-quit, reconnect, then six saves while the network flaps: all arrive once, none doubled
// Device A is a phone-sized Chromium context, or real Chrome on an Android emulator with ANDROID=1 (Playwright's
// _android API over adb); device B is always a phone-sized Chromium context.
// Needs: DEVICE_URL (https://sandbox-app.flamingbeing.com), DEVICE_EMAIL, DEVICE_PASSWORD (the test-bot user; it must
// already hold the member role on that app: claim g._=member plus a members/<uid> doc, which the tests do not create),
// and the app's firebase config (read from DEVICE_URL's app/src/config.js).
// Run:  node tests/device/device.mjs [--phase=all|install|update|extra] [--out=tests/device/out]
// Needs @playwright/test's `playwright` package (1.56+). Exit code 0 only when every check passed. Writes
// <out>/results.json and one screenshot per check. Emulator: stop it afterwards (the script never leaves one running).
import { chromium, devices, _android } from 'playwright';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

const arg = (k, d) => (process.argv.find(a => a.startsWith(`--${k}=`)) || `--${k}=${d}`).split('=')[1];
const URL_ = (process.env.DEVICE_URL || '').replace(/\/$/, '');
const { DEVICE_EMAIL: email, DEVICE_PASSWORD: password } = process.env;
if (!URL_ || !email || !password) { console.error('set DEVICE_URL, DEVICE_EMAIL, DEVICE_PASSWORD'); process.exit(2); }
const phase = arg('phase', 'all');
const out = arg('out', 'tests/device/out');
mkdirSync(out, { recursive: true });
const stateFile = `${out}/install-state.json`;
// Every item the run adds starts with RUN_ID (default <host>-<time>; set DEVICE_RUN_ID=firetop-... per machine), so two
// machines can test the same live account at once: each only asserts on and cleans up its own items.
const RUN = process.env.DEVICE_RUN_ID || `${(process.env.HOSTNAME || 'dev').slice(0, 12)}-${Date.now().toString(36)}`;
const uniq = p => `${RUN}-${p}-${Math.random().toString(36).slice(2, 6)}`;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const results = [];

async function until(fn, what, ms = 20_000) {
  const end = Date.now() + ms;
  for (;;) {
    try { const v = await fn(); if (v) return v; } catch {}
    if (Date.now() > end) throw new Error(`timed out: ${what}`);
    await sleep(250);
  }
}

// Sign in through the identity REST API and hand the session to the page (the starter has Google sign-in only).
async function config() {
  const src = await (await fetch(`${URL_}/app/src/config.js`)).text();
  const pick = k => (src.match(new RegExp(`["']?${k}["']?\\s*:\\s*["']([^"']+)["']`)) || [])[1];
  return { apiKey: pick('apiKey'), authDomain: pick('authDomain') };
}
async function signIn(page, cfg) {
  await page.goto(`${URL_}/app/?sw`);
  await page.locator('#signed-out').waitFor({ state: 'visible', timeout: 20_000 });
  await page.evaluate(async ({ apiKey, authDomain, email, password }) => {
    const r = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${apiKey}`,
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password, returnSecureToken: true }) });
    const j = await r.json();
    if (!j.idToken) throw new Error('sign-in refused');
    const now = Date.now();   // the user shape app-devkit's signInViaApi stores (the page makes the call: the API key allows only the app's own origin)
    const user = { uid: j.localId, email: j.email, emailVerified: false, isAnonymous: false, apiKey, appName: '[DEFAULT]', authDomain,
      providerData: [{ providerId: 'password', uid: j.email, email: j.email, displayName: null, phoneNumber: null, photoURL: null }],
      stsTokenManager: { refreshToken: j.refreshToken, accessToken: j.idToken, expirationTime: now + Number(j.expiresIn || 3600) * 1000 }, createdAt: String(now), lastLoginAt: String(now) };
    const open = indexedDB.open('firebaseLocalStorageDb', 1);
    open.onupgradeneeded = () => open.result.createObjectStore('firebaseLocalStorage', { keyPath: 'fbase_key' });
    await new Promise((res, rej) => { open.onerror = () => rej(open.error); open.onsuccess = () => {
      const tx = open.result.transaction('firebaseLocalStorage', 'readwrite');
      tx.objectStore('firebaseLocalStorage').put({ fbase_key: `firebase:authUser:${apiKey}:[DEFAULT]`, value: user });
      tx.oncomplete = res; tx.onerror = () => rej(tx.error); }; });
  }, { ...cfg, email, password });
  await page.reload();
  await page.locator('#list-view').waitFor({ state: 'visible', timeout: 30_000 });
  await until(() => page.evaluate(() => window.starter?.ready), 'app ready');
}
const synced = page => until(() => page.evaluate(() => window.starter?.status === 'synced'), 'status synced', 30_000);
const add = async (page, text) => { await page.fill('#new-text', text); await page.click('#add button[type=submit]'); await page.locator('#items', { hasText: text }).waitFor(); };
// Click that survives the phone's soft keyboard resizing the viewport after a filled field (Android: the dialog's
// button is then reported not visible): drop focus, bring it into view, and fall back to a DOM click.
// (the confirm dialog's Delete button also matches the sheet's own #edit-delete: callers take .last(), the one on top)
const tap = async loc => {
  await loc.page().evaluate(() => document.activeElement?.blur?.()).catch(() => {});
  await loc.scrollIntoViewIfNeeded().catch(() => {});
  try { await loc.click({ timeout: 8_000 }); } catch { await loc.dispatchEvent('click'); }
};
const shot = (page, name) => page.screenshot({ path: `${out}/${name}.png` }).catch(() => {});

let note;
async function check(name, fn) {
  const t0 = Date.now(); note = undefined;
  try { await fn(); results.push({ name, pass: true, seconds: Math.round((Date.now() - t0) / 1000), ...(note && { note }) }); console.log('PASS', name, note || ''); }
  catch (e) {
    results.push({ name, pass: false, error: String(e.message || e).slice(0, 300) }); console.log('FAIL', name, '-', e.message);
    // a failed check must not leave device A offline or without a page for the next one
    await shot(a, `fail-${name.split(' ')[0]}`);
    await ctxA.setOffline(false).catch(() => {});
    if (a.isClosed()) a = await ctxA.newPage();
    await a.goto(`${URL_}/app/?sw`).catch(() => {});
  }
}

// Delete (to the bin, through the UI) only the items this run added.
async function cleanup(page) {
  if (!page || page.isClosed()) return;
  await page.goto(`${URL_}/app/?sw`).catch(() => {});
  for (let i = 0; i < 40; i++) {
    const row = page.locator('#items button', { hasText: RUN }).first();
    if (!(await row.count())) return;
    await row.click();
    await tap(page.locator('#edit-delete'));
    await tap(page.getByRole('button', { name: 'Delete', exact: true }).last());
    await sleep(500);
  }
}

const browser = await chromium.launch();
const phone = () => browser.newContext({ ...devices['Pixel 7'] });
let android, deviceA, ctxA;
try {
  if (process.env.ANDROID) {
    [android] = await _android.devices();
    if (!android) throw new Error('no Android device (start the emulator first)');
    // Playwright's launchBrowser needs Chrome to read its command-line file, which release Chrome ignores on a
    // non-rooted image (the socket Playwright waits for never appears). Chrome's own devtools socket is always there:
    // start Chrome, forward that socket, attach over CDP.
    await android.shell('am force-stop com.android.chrome');
    await android.shell('am start -a android.intent.action.VIEW -d about:blank com.android.chrome');
    const port = 9222 + Math.floor(Math.random() * 500);
    const adb = process.env.ADB || 'adb';
    await until(() => { try { execFileSync(adb, ['-s', android.serial(), 'forward', `tcp:${port}`, 'localabstract:chrome_devtools_remote']); return true; } catch { return false; } }, 'adb forward', 15_000);
    const cdp = await until(() => chromium.connectOverCDP(`http://127.0.0.1:${port}`), 'Chrome devtools socket on the device (first-run screen? decline any prompt on the emulator)', 60_000);
    ctxA = cdp.contexts()[0];
  } else ctxA = await phone();
  const ctxB = await phone();
  const cfg = await config();
  if (!cfg.apiKey) throw new Error('no firebase config on the live app');
  var a = await ctxA.newPage(); const b = await ctxB.newPage();

  if (phase !== 'update') {
    await signIn(a, cfg); await signIn(b, cfg);
  }
  if (phase !== 'update' && phase !== 'extra') {

    await check('1 offline save, force-quit, reopen, reconnect', async () => {
      const t = uniq('off');
      await ctxA.setOffline(true);
      await add(a, t);
      await a.close();                    // force-quit: the page goes away with the save unsent
      a = await ctxA.newPage();
      await a.goto(`${URL_}/app/?sw`);    // reopened still offline, from the service worker
      await a.locator('#items', { hasText: t }).waitFor({ timeout: 20_000 });
      await ctxA.setOffline(false);
      await synced(a);
      await until(async () => { await b.reload(); await b.locator('#list-view').waitFor(); return (await b.locator('#items').innerText()).includes(t); }, 'other device sees the save', 40_000);
      await shot(a, '1-offline-save');
    });

    await check('2 two devices: edit + delete on one, seen on the other', async () => {
      const t = uniq('two'), t2 = `${t}-edited`;
      await add(a, t); await synced(a);
      await b.locator('#items', { hasText: t }).waitFor({ timeout: 30_000 });
      await a.getByRole('button', { name: t }).click();
      await a.fill('#edit-text', t2); await a.click('#edit-save'); await synced(a);
      await b.locator('#items', { hasText: t2 }).waitFor({ timeout: 30_000 });
      await a.getByRole('button', { name: t2 }).click();
      await tap(a.locator('#edit-delete'));
      await tap(a.getByRole('button', { name: 'Delete', exact: true }).last());
      await synced(a);
      await until(async () => !(await b.locator('#items').innerText()).includes(t2), 'delete seen on the other device', 30_000);
      await shot(b, '2-two-devices');
    });

    await check('3 offline save, sign out, sign in: nothing lost', async () => {
      const t = uniq('out');
      await ctxA.setOffline(true);
      await add(a, t);
      await a.click('#sign-out').catch(() => {});
      await ctxA.setOffline(false);
      await signIn(a, cfg);
      await a.locator('#items', { hasText: t }).waitFor({ timeout: 30_000 });
      await synced(a);
      await until(async () => { await b.reload(); await b.locator('#list-view').waitFor(); return (await b.locator('#items').innerText()).includes(t); }, 'sent after sign-in', 40_000);
      await shot(a, '3-sign-out-in');
    });
  }

  if (phase === 'extra') {
    const ctxBx = b.context();
    const listB = async prefix => { await b.reload(); await b.locator('#list-view').waitFor(); return b.locator('#items button', { hasText: prefix }).allInnerTexts(); };
    const edit = async (page, from, to) => { await page.getByRole('button', { name: from }).click(); await page.fill('#edit-text', to); await tap(page.locator('#edit-save')); await page.locator('#items', { hasText: to }).waitFor(); };

    await check('5 same item edited offline on both devices: converges, nothing lost or doubled', async () => {
      const t = uniq('conf');
      await add(a, t); await synced(a);
      await b.locator('#items', { hasText: t }).waitFor({ timeout: 30_000 });
      await ctxA.setOffline(true); await ctxBx.setOffline(true);
      await edit(a, t, `${t}-A`); await edit(b, t, `${t}-B`);
      await ctxA.setOffline(false); await synced(a);
      await ctxBx.setOffline(false);
      // B's save meets A's edit: the kit holds it as a conflict until the person chooses (#attention -> Keep mine), then it sends
      await until(async () => await b.locator('#attention').isVisible() || await b.evaluate(() => window.starter?.status === 'synced'), 'B synced or holding a conflict', 30_000);
      if (await b.locator('#attention').isVisible()) { await b.click('#attention'); await b.getByRole('button', { name: 'Keep mine' }).first().click(); }
      await synced(b);
      let rows;
      await until(async () => {
        await a.reload(); await a.locator('#list-view').waitFor();
        const ra = await a.locator('#items button', { hasText: t }).allInnerTexts(); const rb = await listB(t);
        rows = [ra, rb];
        return ra.length === 1 && rb.length === 1 && ra[0] === rb[0];
      }, 'both devices end on one and the same item', 45_000);
      note = `winner: ${/-A/.test(rows[0][0]) ? 'A (first to reconnect)' : 'B'}`;
      await shot(a, '5-conflict');
    });

    await check('6 many offline saves, force-quit, reconnect, then a flapping network: all arrive once', async () => {
      const t = uniq('many');
      await ctxA.setOffline(true);
      for (let i = 0; i < 12; i++) await add(a, `${t}-q${String(i).padStart(2, '0')}`);
      await a.close();                         // force-quit with twelve unsent saves
      await ctxA.setOffline(false);
      a = await ctxA.newPage(); await a.goto(`${URL_}/app/?sw`); await a.locator('#list-view').waitFor();
      await synced(a);
      for (let i = 0; i < 6; i++) {            // network flaps while saving
        await ctxA.setOffline(i % 2 === 0);
        await add(a, `${t}-f${i}`);
        await sleep(300);
      }
      await ctxA.setOffline(false); await synced(a);
      await until(async () => (await listB(t)).length === 18, 'all 18 on the other device', 60_000);
      const rows = await listB(t);
      if (new Set(rows).size !== rows.length) throw new Error('doubled items on the other device');
      await shot(b, '6-many');
    });
  }

  if (phase === 'install' || phase === 'all') {
    await check('4a installed app: service worker in charge, version recorded', async () => {
      await a.goto(`${URL_}/app/?sw`);
      await until(() => a.evaluate(() => !!navigator.serviceWorker.controller), 'service worker in charge', 30_000);
      const sw = await (await fetch(`${URL_}/app/sw.js`)).text().catch(() => '');
      writeFileSync(stateFile, JSON.stringify({ sw: createHash('sha256').update(sw).digest('hex'), at: new Date().toISOString() }));
      await shot(a, '4a-installed');
    });
  }
  if (phase === 'update') {
    await check('4b after a new deploy the installed app updates', async () => {
      if (!existsSync(stateFile)) throw new Error('run --phase=install before the deploy first');
      const before = JSON.parse(readFileSync(stateFile, 'utf8')).sw;
      const now = createHash('sha256').update(await (await fetch(`${URL_}/app/sw.js`)).text()).digest('hex');
      if (now === before) throw new Error('the deployed sw.js is unchanged: deploy a new version first');
      await a.goto(`${URL_}/app/?sw`);     // the installed (old) worker starts the page
      await a.evaluate(() => { window.__same = true; });
      await a.evaluate(() => navigator.serviceWorker.getRegistration().then(r => r.update()));
      await until(() => a.evaluate(() => window.__same).then(v => v === undefined).catch(() => true), 'page reloaded onto the new version', 45_000);
      await a.locator('#list-view').waitFor({ timeout: 30_000 });
      await shot(a, '4b-updated');
    });
  }
} catch (e) { results.push({ name: 'setup', pass: false, error: String(e.message || e).slice(0, 300) }); console.log('FAIL setup -', e.message); }
finally {
  await ctxA?.setOffline(false).catch(() => {});
  await cleanup(a).catch(() => {});
  writeFileSync(`${out}/results.json`, JSON.stringify({ url: URL_, run: RUN, phase, android: !!process.env.ANDROID, at: new Date().toISOString(), results }, null, 2));
  await browser.close().catch(() => {});
  if (android) await android.close().catch(() => {});
}
process.exit(results.length && results.every(r => r.pass) ? 0 : 1);
