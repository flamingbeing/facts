// The Add tab (owner only): one box for one fact or a paste; /api/file runs its two passes against the canned model of
// local runs (worker/file.js localAsk: every line goes to the first topic, drugs/demo-drug; a line that repeats one of its
// lines is a duplicate, "More: ..." merges with its first line, "Not: ..." corrects it, anything else is new). A new card
// Confirms to an 'add' verdict, a merge or correct to an 'edit' verdict; duplicates are set aside, collapsed.
// Its own file: it only adds 'add:' and 'edit:' verdicts, which the Align tests' clean-up (their beforeEach) would also remove.
import { test, expect, signIn, db } from './fixtures.mjs';
import { DEFAULT_ADMINS } from '../worker/members.js';

const tab = '.ui-tab[data-tab-page="#add-page"]:visible, .ui-side-link[data-tab-page="#add-page"]:visible';
const mine = async () => (await db.list('spaces/_/verdicts')).filter(d => /^(add|edit):/.test(d.fact));
// one worker for this file: each test's clean-up (beforeEach) would otherwise remove the other's verdicts mid-run
test.describe.configure({ mode: 'serial' });
test.beforeEach(async () => { for (const d of await mine()) await db.del(`spaces/_/verdicts/${d.by}~${d.fact.replaceAll(/[/#]/g, '~')}`); });

/** @param {import('@playwright/test').Page} page */
async function openAdd(page) {
  await page.evaluate(() => { scrollTo(0, 0); document.querySelector('.ui-tabbar')?.classList.remove('is-minimised'); });
  await page.locator(tab).first().click();
  await expect(page.locator('#add-page')).toBeVisible();
  await expect(page.locator('#add-topics option')).toHaveCount(3);   // the topic list is loaded (demo-drug first)
}
/** @param {import('@playwright/test').Page} page */
async function asOwner(page) {
  await signIn(page, 'member');   // (then the owner's account: admin by default, no role doc)
  await page.evaluate(e => window.starter.signInAs(e), DEFAULT_ADMINS[0]);
  await expect(page.locator('#tab-add')).toBeVisible();
  await openAdd(page);
}

test('a member has no Add tab', async ({ phone }) => {
  const page = await phone();
  await signIn(page, 'member');
  await expect(page.locator('#tab-add')).toBeHidden();
  await expect(page.locator('#side-add')).toBeHidden();
});

test('one box, one route; the model toggle is Haiku by default and remembered on this device', async ({ phone }) => {
  const page = await phone();
  await asOwner(page);
  await expect(page.locator('#add-mode')).toHaveCount(0);
  await expect(page.locator('#add-text')).toHaveAttribute('maxlength', '60000');
  await expect(page.locator('#add-model')).toHaveText('Model: Haiku');
  await expect(page.locator('#add-model')).toHaveAttribute('aria-pressed', 'false');
  await page.locator('#add-text').fill('Made-up fact: dose 3 mg/kg');
  let req = page.waitForRequest(r => r.url().endsWith('/api/file'));
  await page.locator('#add-file').click();
  expect((await req).postDataJSON()).toMatchObject({ text: 'Made-up fact: dose 3 mg/kg', model: 'haiku' });
  await expect(page.locator('#add-cards .add-card')).toHaveCount(1);
  await page.locator('#add-model').click();
  await expect(page.locator('#add-model')).toHaveText('Model: Sonnet');
  await page.reload();
  await openAdd(page);
  await expect(page.locator('#add-model')).toHaveText('Model: Sonnet');
  await expect(page.locator('#add-model')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#add-text').fill('Made-up fact');
  req = page.waitForRequest(r => r.url().endsWith('/api/file'));
  await page.locator('#add-file').click();
  expect((await req).postDataJSON().model).toBe('sonnet');
  await page.locator('#add-model').click();   // back to Haiku for the other tests
  await expect(page.locator('#add-model')).toHaveText('Model: Haiku');
  // nothing typed: a plain message, no call
  await page.locator('#add-text').fill('');
  await page.locator('#add-file').click();
  await expect(page.locator('#add-status')).toContainText('Type or paste a fact first');
});

test('the four card kinds: new, merge, correct, and duplicates set aside', async ({ phone }) => {
  const page = await phone();
  await asOwner(page);
  await page.locator('#add-text').fill('- Made-up brand new fact\n- Made-up line with no question\n- More: given slowly\n- Not: Dose 3 mg/kg IV\n- Another made-up fact');
  await page.locator('#add-file').click();
  const cards = page.locator('#add-cards .add-card');
  await expect(cards).toHaveCount(4);
  await expect(cards.nth(0)).toHaveAttribute('data-action', 'new');
  await expect(cards.nth(0).locator('.add-c-line')).toHaveValue('Made-up brand new fact');
  await expect(cards.nth(0).locator('.add-c-section')).toHaveValue('Notes');
  // merge: the old line and the merged one; no topic or section to edit
  const merge = cards.nth(1);
  await expect(merge).toHaveAttribute('data-action', 'merge');
  await expect(merge.locator('.add-c-old')).toHaveText('Was: Dose **2 mg/kg** IV');
  await expect(merge.locator('.add-c-line')).toHaveValue('Dose **2 mg/kg** IV; given slowly');
  await expect(merge.locator('.add-c-topic')).toHaveCount(0);
  await expect(merge.locator('.add-c-confirm')).toHaveText('Confirm change');
  // correct: the old line, the replacement and why
  const correct = cards.nth(2);
  await expect(correct).toHaveAttribute('data-action', 'correct');
  await expect(correct.locator('.add-c-old')).toHaveText('Was: Dose **2 mg/kg** IV');
  await expect(correct.locator('.add-c-line')).toHaveValue('Dose 3 mg/kg IV');
  await expect(correct.locator('.add-c-why')).toContainText('Made-up correction');
  // duplicate: pre-discarded, collapsed
  await expect(page.locator('#add-dups')).toBeVisible();
  await expect(page.locator('#add-dups-sum')).toHaveText('1 already there');
  await expect(page.locator('#add-dup-list .add-dup')).toBeHidden();
  await page.locator('#add-dups-sum').click();
  await expect(page.locator('#add-dup-list .add-dup')).toContainText('Already there: Made-up line with no question');
  await expect(page.locator('#add-status')).toContainText('4 to check.');
  // Confirm all says it includes the changes
  await expect(page.locator('#add-confirm-all')).toHaveText('Confirm all (incl. 2 changes)');

  // confirm the correction alone: an 'edit' verdict with the old line and why
  const flushed = page.waitForResponse(r => r.url().endsWith('/api/flush'));
  await correct.locator('.add-c-confirm').click();
  expect((await flushed).status()).toBe(200);
  await expect(cards).toHaveCount(3);
  await expect(page.locator('#add-confirm-all')).toHaveText('Confirm all (incl. 1 change)');
  await expect.poll(async () => (await mine()).length, { timeout: 15_000 }).toBe(1);
  const [e] = await mine();
  expect(e).toMatchObject({ choice: 'edit', text: 'Dose 3 mg/kg IV', section: 'Dosage', old: 'Dose **2 mg/kg** IV', why: 'Made-up correction.' });
  expect(e.fact).toMatch(/^edit:drugs\/demo-drug#aaa111@[a-z0-9]+$/);

  // discard the merge; "Add anyway" brings the duplicate back as a new card
  await merge.locator('.add-c-discard').click();
  await expect(page.locator('#add-confirm-all')).toHaveText('Confirm all');
  await page.locator('#add-dup-list .add-d-add').click();
  await expect(page.locator('#add-dups')).toBeHidden();
  await expect(cards).toHaveCount(3);
  // break one; Confirm all queues the others and keeps the broken one with its reason
  await cards.nth(1).locator('.add-c-topic').fill('nonsense');
  await page.locator('#add-confirm-all').click();
  await expect(cards).toHaveCount(1);
  await expect(cards.nth(0)).toContainText('area/name');
  await expect.poll(async () => (await mine()).length, { timeout: 15_000 }).toBe(3);
  const adds = (await mine()).filter(d => d.choice === 'add');
  expect(adds.map(d => d.text).sort()).toEqual(['Made-up brand new fact', 'Made-up line with no question']);
  for (const d of adds) expect(d.fact).toMatch(/^add:drugs\/demo-drug#[a-z0-9]+$/);
  // Discard all
  await page.locator('#add-discard-all').click();
  await expect(page.locator('#add-stack')).toBeHidden();
  expect((await mine()).length).toBe(3);
});

test('Confirm all queues a merge too', async ({ phone }) => {
  const page = await phone();
  await asOwner(page);
  await page.locator('#add-text').fill('More: made-up detail');
  await page.locator('#add-file').click();
  await expect(page.locator('#add-cards .add-card')).toHaveCount(1);
  await expect(page.locator('#add-confirm-all')).toHaveText('Confirm all (incl. 1 change)');
  await page.locator('#add-confirm-all').click();
  await expect.poll(async () => (await mine()).length, { timeout: 15_000 }).toBe(1);
  expect((await mine())[0]).toMatchObject({ choice: 'edit', text: 'Dose **2 mg/kg** IV; made-up detail', old: 'Dose **2 mg/kg** IV', section: 'Dosage' });
});

test('Draft on a topic: cards are marked model-drafted, no Confirm all, and Confirm queues with q model-drafted', async ({ phone }) => {
  const page = await phone();
  await asOwner(page);
  await page.locator('#add-draft').click();
  await expect(page.locator('#add-draft')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#add-text')).toHaveAttribute('maxlength', '200');
  await page.locator('#add-text').fill('Made-up topic');
  await page.locator('#add-file').click();
  const cards = page.locator('#add-cards .add-card');
  await expect(cards).toHaveCount(1);
  await expect(cards.nth(0)).toContainText('Model-drafted');
  await expect(page.locator('#add-confirm-all')).toBeHidden();
  const flushed = page.waitForResponse(r => r.url().endsWith('/api/flush'));
  await cards.nth(0).locator('.add-c-confirm').click();
  expect((await flushed).status()).toBe(200);
  await expect.poll(async () => (await mine()).length, { timeout: 15_000 }).toBe(1);
  expect((await mine())[0]).toMatchObject({ choice: 'add', q: 'model-drafted' });
  await page.locator('#add-draft').click();
  await expect(page.locator('#add-text')).toHaveAttribute('maxlength', '60000');
});
