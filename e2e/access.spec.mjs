// Sign-in and roles from the role doc, on the first tab (Align): the gates show there, and a role change reaches the page.
import AxeBuilder from './axe.mjs';
import { test, expect, signIn, db, APP } from './fixtures.mjs';

test('signed out: the sign-in screen is on Align, accessible', async ({ phone }) => {
  const page = await phone();
  await page.goto(APP, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#align-page')).toBeVisible();
  await expect(page.locator('#signed-out')).toBeVisible();
  await expect(page.locator('#align-count')).toBeHidden();
  expect(await AxeBuilder(page)).toEqual([]);
});

test('an account with no role sees no cards until an admin adds it', async ({ phone }) => {
  const page = await phone();
  await signIn(page, null);
  await expect(page.locator('#no-access')).toBeVisible();
  await expect(page.locator('#align-count')).toBeHidden();
  await expect(page.locator('#uid')).not.toBeEmpty();
});

test('a role change reaches the page by itself, and removing the role closes access again', async ({ phone }) => {
  const page = await phone();
  const { uid } = await signIn(page, 'viewer');
  await expect(page.locator('#align-count')).toBeVisible();
  await db.put(`members/${uid}`, { role: 'member', v: 2 });
  await db.del(`members/${uid}`);
  await expect(page.locator('#no-access')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('#align-count')).toBeHidden();
});
