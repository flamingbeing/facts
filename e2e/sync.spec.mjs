// Offline saves and two phones, with Align's verdicts as the saves (sign-out and forget: modules.spec.mjs).
import { test, expect, signIn, signInAgain, seenOne, verdictHas, synced, APP } from './fixtures.mjs';

test('a save made offline is kept on the phone and sent once back online, even after closing the page', async ({ phone }) => {
  const page = await phone();
  const { uid } = await signIn(page, 'member');
  await synced(page);
  await expect(page.locator('#align-count')).toContainText('1 of');
  await page.context().setOffline(true);
  const fact = await seenOne(page);
  await expect.poll(() => page.evaluate(() => window.starter.status)).not.toBe('synced');
  // the page closes while offline; the outbox (IndexedDB) still holds the save
  const again = await page.context().newPage();
  await page.close();
  await page.context().setOffline(false);
  // still signed in on this phone: Align shows straight away, and the outbox sends what it kept
  await again.goto(APP, { waitUntil: 'domcontentloaded' });
  await expect(again.locator('#align-view')).toBeVisible();
  await verdictHas(uid, fact);
  await synced(again);
});

test('two phones: an answer on one puts the line at the back of the deck on the other', async ({ phone }) => {
  const a = await phone(), b = await phone();
  const { uid, email } = await signIn(a, 'member');
  await expect(a.locator('#align-count')).toContainText('1 of');
  const fact = await seenOne(a);
  await verdictHas(uid, fact);
  await synced(a);
  await signInAgain(b, email);
  await expect(b.locator('#align-count')).toContainText('1 of');
  await expect.poll(() => b.evaluate(() => window.align.deck().at(-1)), { timeout: 15_000 }).toBe(fact);
});
