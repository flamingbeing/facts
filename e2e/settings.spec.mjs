// @core/settings on the Settings page: the look is a device value (kept across sign-out and reload), an account
// switch follows the new account, and the open page passes axe. The app has no account options yet (src/options.js).
import { test, expect, signIn, synced, seenOne, verdictHas, openSettings, openAlign } from './fixtures.mjs';
import AxeBuilder from './axe.mjs';

const open = openSettings;

test('the device value survives sign-out and a reload', async ({ phone }) => {
  const a = await phone();
  const { email } = await signIn(a, 'member');
  await open(a);
  await a.getByLabel('Bars and sheets').selectOption('solid');
  await expect(a.locator('html')).not.toHaveClass(/\bglass\b/);
  await a.click('#sign-out');
  await openAlign(a);
  await expect(a.locator('#signed-out')).toBeVisible();
  await a.reload({ waitUntil: 'domcontentloaded' });
  await expect(a.locator('#signed-out')).toBeVisible();
  await expect(a.locator('html')).not.toHaveClass(/\bglass\b/);
  await a.evaluate(e => window.starter.signInAs(e), email);
  await expect(a.locator('#align-count')).toBeVisible();
  await expect(a.locator('html')).not.toHaveClass(/\bglass\b/);
});

test('the Settings page passes axe', async ({ phone }) => {
  const a = await phone();
  await signIn(a, 'member');
  await open(a);
  expect(await AxeBuilder(a)).toEqual([]);
});

test('a direct switch from one account to another: the next answer is the new account’s', async ({ phone }) => {
  const b = await phone();
  const { uid, email } = await signIn(b, 'member');   // account B, on its own phone
  const a = await phone();
  await signIn(a, 'member');                      // account A
  await synced(a);
  // straight from A to B, no sign-out in between
  await a.evaluate(e => window.starter.signInAs(e), email);
  await expect(a.locator('#align-count')).toBeVisible();
  await expect.poll(() => a.evaluate(() => window.starter.ready)).toBe(true);
  // an answer now belongs to the new account
  await verdictHas(uid, await seenOne(a));
});
