// @core/search on the sample list: the box filters the list, a phrase, -word, an operator and a misspelt operator
// behave, "/" focuses the box, and the page passes axe with a query typed.
import { test, expect, signIn, add, uniq } from './fixtures.mjs';
import AxeBuilder from './axe.mjs';

// the add form clears itself a moment after the item shows; wait for that before the next one
const addOne = async (page, text) => { await add(page, text); await expect(page.locator('#new-text')).toHaveValue(''); };
const shown = page => page.locator('#items li button').allTextContents();

test('the search box narrows the list, with phrase, leave-out, operators and a hint', async ({ phone }) => {
  const a = await phone();
  await signIn(a, 'member');
  const tag = uniq('s').replace(/[^a-z]/g, '');
  await addOne(a, `${tag} spinal for knee`);
  await addOne(a, `${tag} epidural for hip, 12 hours`);
  await addOne(a, `${tag} spinal day surgery`);
  const q = a.locator('#q');

  await q.fill(`${tag} spinal`);
  await expect.poll(() => shown(a)).toHaveLength(2);
  await expect(a.locator('#count')).toHaveText(/^2 of \d+ items$/)   // the list may hold other tests' items;

  await q.fill(`${tag} -spinal`);
  await expect.poll(() => shown(a)).toEqual([`${tag} epidural for hip, 12 hours`]);

  await q.fill(`"${tag} spinal day"`);
  await expect.poll(() => shown(a)).toEqual([`${tag} spinal day surgery`]);

  await q.fill(`${tag} has:number`);
  await expect.poll(() => shown(a)).toEqual([`${tag} epidural for hip, 12 hours`]);

  await q.fill(`${tag} hsa:number`);
  await expect(a.locator('#search-msg')).toHaveText('Did you mean has:?');

  await q.fill(`${tag} nothing-like-this`);
  await expect(a.locator('#search-msg')).toHaveText('No matches');

  await q.fill('');
  await expect(a.locator('#count')).toHaveText(/^\d+ items$/);
  expect((await shown(a)).filter(t => t.startsWith(tag))).toHaveLength(3);
});

test('"/" focuses the search box; axe passes with a query typed', async ({ phone }) => {
  const a = await phone();
  await signIn(a, 'member');
  // (the "Added" toast springs in once the form clears: wait for that, so axe's wait for animations covers it)
  await addOne(a, uniq('axe'));
  await a.locator('body').press('/');
  await expect(a.locator('#q')).toBeFocused();
  await a.fill('#q', 'is:long');
  expect(await AxeBuilder(a)).toEqual([]);
});
