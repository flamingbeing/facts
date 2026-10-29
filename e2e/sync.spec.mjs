// Offline saves, two phones and conflicts (sign-out and forget: modules.spec.mjs).
import { test, expect, clickOpens, signIn, signInAgain, add, synced, serverHas, uniq, APP } from './fixtures.mjs';

test('a save made offline is kept on the phone and sent once back online, even after closing the page', async ({ phone }) => {
  const page = await phone();
  await signIn(page, 'member');
  await synced(page);
  const t = uniq('offline');
  await page.context().setOffline(true);
  await add(page, t);
  await expect.poll(() => page.evaluate(() => window.starter.status)).not.toBe('synced');
  // the page closes while offline; the outbox (IndexedDB) still holds the save
  const again = await page.context().newPage();
  await page.close();
  await page.context().setOffline(false);
  // still signed in on this phone: the list shows straight away, and the outbox sends what it kept
  await again.goto(APP, { waitUntil: 'domcontentloaded' });
  await expect(again.locator('#list-view')).toBeVisible();
  await serverHas(t);
  await synced(again);
});

test('two phones see each other’s changes', async ({ phone }) => {
  const a = await phone(), b = await phone();
  const { email } = await signIn(a, 'member');
  await signInAgain(b, email);
  const t = uniq('shared');
  await add(a, t);
  await expect(b.locator('#items')).toContainText(t, { timeout: 15_000 });
});

test('an edit that meets a change from another phone waits for a choice; keep mine wins everywhere', async ({ phone }) => {
  const a = await phone(), b = await phone();
  const { email } = await signIn(a, 'member');
  await signInAgain(b, email);
  const t = uniq('both');
  await add(a, t);
  await expect(b.locator('#items')).toContainText(t, { timeout: 15_000 });
  await synced(b);

  await b.context().setOffline(true);
  await clickOpens(b.getByRole('button', { name: t }), b.locator('#edit'));
  await b.fill('#edit-text', t + ' from b');
  await b.click('#edit-save');
  await clickOpens(a.getByRole('button', { name: t }), a.locator('#edit'));
  await a.fill('#edit-text', t + ' from a');
  await a.click('#edit-save');
  await serverHas(t + ' from a');
  await b.context().setOffline(false);

  await expect(b.locator('#attention')).toBeVisible({ timeout: 20_000 });
  // only the phone whose save was held is asked; the other phone has nothing to answer
  await expect(a.locator('#attention')).toBeHidden();
  await b.click('#attention');
  // both versions side by side, each with when it changed (SGT) and who changed it
  const sides = b.locator('#conflict-list .sides');
  await expect(sides).toContainText(t + ' from a');
  await expect(sides).toContainText(t + ' from b');
  await expect(sides).toContainText(/\d\d:\d\d/);
  await expect(sides).toContainText(email);
  await expect(sides).toContainText('Computer');
  await b.getByRole('button', { name: 'Keep mine' }).click();
  await serverHas(t + ' from b');
  await expect(a.locator('#items')).toContainText(t + ' from b', { timeout: 15_000 });
  await expect(b.locator('#attention')).toBeHidden();
});

test('keep theirs drops this phone’s held change and nothing else', async ({ phone }) => {
  const a = await phone(), b = await phone();
  const { email } = await signIn(a, 'member');
  await signInAgain(b, email);
  const t = uniq('theirs');
  await add(a, t);
  await expect(b.locator('#items')).toContainText(t, { timeout: 15_000 });
  await synced(b);
  await b.context().setOffline(true);
  await clickOpens(b.getByRole('button', { name: t }), b.locator('#edit'));
  await b.fill('#edit-text', t + ' from b');
  await b.click('#edit-save');
  await clickOpens(a.getByRole('button', { name: t }), a.locator('#edit'));
  await a.fill('#edit-text', t + ' from a');
  await a.click('#edit-save');
  await serverHas(t + ' from a');
  await b.context().setOffline(false);
  await expect(b.locator('#attention')).toBeVisible({ timeout: 20_000 });
  // an unanswered conflict stays visible in the chip
  await expect(b.locator('#status')).toHaveAttribute('data-state', 'attention');
  await b.click('#attention');
  await b.getByRole('button', { name: 'Keep theirs' }).click();
  await expect(b.locator('#items')).toContainText(t + ' from a', { timeout: 15_000 });
  await expect(b.locator('#attention')).toBeHidden();
});
