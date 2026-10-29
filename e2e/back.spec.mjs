// Back with tabs (app-ui tabBack): switching tabs adds at most one history step; Back on another tab goes to the
// first tab; Back on the first tab shows "Press Back again to close", and a second Back within 2 s leaves the app.
import { test, expect, signIn } from './fixtures.mjs';

const tap = (page, sel) => page.evaluate(s => /** @type {HTMLElement} */ (document.querySelector(s)).click(), sel);
const current = page => page.evaluate(() => document.querySelector('.ui-tabbar .ui-tab[aria-current="page"]')?.getAttribute('data-tab-page'));

test('tabs add at most one Back step; Back goes to the first tab, then leaves', async ({ phone }) => {
  const page = await phone();
  await signIn(page, 'admin');
  await expect.poll(() => current(page)).toBe('#align-page');
  const before = await page.evaluate(() => history.length);

  for (const id of ['#add-page', '#settings-page']) {
    await tap(page, `.ui-tabbar .ui-tab[data-tab-page="${id}"]`);
    await expect.poll(() => current(page)).toBe(id);
  }
  expect(await page.evaluate(() => history.length)).toBeLessThanOrEqual(before + 1);

  await page.goBack();
  await expect.poll(() => current(page)).toBe('#align-page');

  const app = page.url();
  await tap(page, 'body');   // Chrome skips the guard until the first tap
  await page.goBack();
  await expect(page.getByText('Press Back again to close')).toBeVisible();
  expect(page.url()).toBe(app);
  const left = await page.goBack();
  expect(left === null || page.url() !== app).toBe(true);
});
