// app-update: a new version takes over, but the page reloads only when nobody is typing.
import { test, expect, uniq } from './fixtures.mjs';

test('a new version waits while someone types, then reloads once', async ({ phone }) => {
  const page = await phone();
  // cloud{
  await page.goto('/app/?emulator&sw', { waitUntil: 'domcontentloaded' });
  // }cloud
  /* static{
  await page.goto('/app/?test&sw', { waitUntil: 'domcontentloaded' });
  }static */
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller), { timeout: 30_000 }).toBe(true);
  await page.evaluate(() => { window.__same = true; navigator.serviceWorker.addEventListener('controllerchange', () => { window.__updated = true; }); });
  // someone is typing (the sign-in screen has no input, so a stand-in)
  await page.evaluate(() => { const i = document.createElement('input'); i.id = 'typing'; i.setAttribute('aria-label', 'typing'); document.body.append(i); });
  await page.fill('#typing', uniq('words'));
  await page.request.get('/__test/bump');
  await page.evaluate(() => navigator.serviceWorker.getRegistration().then(r => r.update()));
  await expect.poll(() => page.evaluate(() => window.__updated), { timeout: 30_000 }).toBeTruthy();
  expect(await page.evaluate(() => window.__same)).toBe(true);   // no reload under their fingers
  await page.fill('#typing', '');
  await page.locator('#typing').blur();
  await expect.poll(() => page.evaluate(() => window.__same).catch(() => undefined), { timeout: 30_000 }).toBeUndefined();
});
