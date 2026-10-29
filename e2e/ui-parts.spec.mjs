// @core/ui parts on the sample screens: the delete confirm (keyboard, Esc, focus return), toasts, the empty state.
import AxeBuilder from './axe.mjs';
import { test, expect, clickOpens, signIn, add, uniq, APP } from './fixtures.mjs';

test('delete has no question: an Undo toast puts the item back (as a new item); the toast passes axe', async ({ phone }) => {
  const page = await phone();
  await signIn(page, 'member');
  const t = uniq('del');
  await add(page, t);
  await expect(page.locator('.toast', { hasText: 'Added' })).toBeVisible();

  await clickOpens(page.getByRole('button', { name: t }), page.locator('#edit'));
  await page.click('#edit-delete');
  await expect(page.locator('dialog.modal')).toHaveCount(0);
  await expect(page.locator('#items')).not.toContainText(t);
  const toast = page.locator('.toast', { hasText: 'Deleted' });
  await expect(toast).toBeVisible();
  expect(await AxeBuilder(page)).toEqual([]);

  await toast.getByRole('button', { name: 'Undo' }).click();
  await expect(page.locator('#items')).toContainText(t);
});

test('a toast can be dismissed', async ({ phone }) => {
  const page = await phone();
  await signIn(page, 'member');
  await add(page, uniq('note'));
  const toast = page.locator('.toast', { hasText: 'Added' });
  await expect(toast).toBeVisible();
  await toast.getByRole('button', { name: 'Dismiss' }).click();
  await expect(toast).toHaveCount(0);
});
