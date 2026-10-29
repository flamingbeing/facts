// The Test tab: every line with a question from the made-up notes (e2e/fixtures/data/), scored and spaced. Answers are
// saved as per-person recall docs, "This fact is wrong" as a 'wrong:<line>' verdict (choice flag) for the queue, and the
// owner's open flags (e2e/fixtures/flags.json) leave their lines out of the deck.
import { test, expect, signIn, synced, db, APP } from './fixtures.mjs';
import { DEFAULT_ADMINS } from '../worker/members.js';

// the recall docs are one shared set ('_'), so these tests run one at a time, each from none. The sent-back verdicts are
// cleared here and only here (align.spec.mjs leaves them alone: it runs in another worker)
test.describe.configure({ mode: 'serial' });
test.beforeEach(async () => {
  for (const d of await db.list('spaces/_/recall')) await db.del(`spaces/_/recall/${d.by}~${d.fact.replaceAll(/[/#]/g, '~')}`);
  for (const d of await db.list('spaces/_/verdicts')) if (d.fact.startsWith('wrong:')) await db.del(`spaces/_/verdicts/${d.by}~${d.fact.replaceAll(/[/#]/g, '~')}`);
});

const tabLink = '.ui-tab[data-tab-page="#test-page"]:visible, .ui-side-link[data-tab-page="#test-page"]:visible';
/** @param {import('@playwright/test').Page} page */
const openTest = async page => {
  await page.evaluate(() => { scrollTo(0, 0); document.querySelector('.ui-tabbar')?.classList.remove('is-minimised'); });
  await page.locator(tabLink).first().click();
  await expect(page.locator('#test-count')).toContainText(/\d of \d/);
};
const deck = (/** @type {import('@playwright/test').Page} */ page) => page.evaluate(() => window.quiz.deck());
// the card shown (the pager's middle slot moves as it turns, so find it by its line)
const card = async (/** @type {import('@playwright/test').Page} */ page) => page.locator(`#test-deck .test-card[data-line="${await page.evaluate(() => window.quiz.deck()[window.quiz.index()])}"]`);
/** @param {string} fact */
const recallOf = async fact => {
  let doc;
  await expect.poll(async () => { doc = (await db.list('spaces/_/recall')).find(d => d.fact === fact); return !!doc; }, { timeout: 15_000 }).toBe(true);
  return doc;
};

test('an MCQ is graded from the pick: right is saved as a state due in days, and the topic score moves', async ({ phone }) => {
  const page = await phone();
  await signIn(page, 'member');
  await synced(page);
  await openTest(page);
  expect(await deck(page)).toEqual(['drugs/demo-drug#aaa111', 'drugs/sample-agent#ccc333', 'airway/tubes#ddd444']);   // no question, no card
  await expect(page.locator('#test-score')).toHaveText('Score 0/0');
  const c = await card(page);
  await expect(c.locator('.align-stem')).toHaveText('What is the demo dose?');
  await c.getByRole('button', { name: '2 mg/kg' }).click();
  await expect(c.locator('.align-line')).toHaveText('Dose 2 mg/kg IV');
  await expect(page.locator('#test-score')).toHaveText(/^Score 1\/1 · .* 1\/1$/);
  await expect(page.locator('#test-topics li[data-topic="drugs/demo-drug"] .test-n')).toHaveText('1/1');
  const d = await recallOf('drugs/demo-drug#aaa111');
  expect([d.ok, d.reps, d.lapses]).toEqual([true, 1, 0]);
  expect(d.due - d.last).toBeGreaterThanOrEqual(864e5);
  await expect(c.getByRole('button', { name: 'Next' })).toBeVisible();
  await c.getByRole('button', { name: 'Next' }).click();
  await expect(page.locator('#test-count')).toHaveText('2 of 3');
});

test('a blank shows its answer, then Right or Wrong; a miss comes back sooner than a hit and the order changes', async ({ phone }) => {
  const page = await phone();
  await signIn(page, 'member');
  await synced(page);
  await openTest(page);
  let c = await card(page);
  await c.getByRole('button', { name: '1 mg/kg' }).click();   // aaa111 wrong (MCQ)
  await expect(page.locator('#test-score')).toHaveText(/^Score 0\/1/);
  await c.getByRole('button', { name: 'Next' }).click();
  await expect(page.locator('#test-count')).toHaveText('2 of 3');
  c = await card(page);
  await expect(c.locator('.align-stem')).toHaveText('Onset in ____');
  await expect(c.getByRole('button', { name: 'Right' })).toBeHidden();
  await c.getByRole('button', { name: 'Show answer' }).click();
  await expect(c.locator('.align-answer')).toHaveText('Answer: 60 s');
  await c.getByRole('button', { name: 'Right' }).click();   // ccc333 right
  const miss = await recallOf('drugs/demo-drug#aaa111'), hit = await recallOf('drugs/sample-agent#ccc333');
  expect([miss.ok, miss.lapses, hit.ok, hit.lapses]).toEqual([false, 1, true, 0]);
  expect(miss.due).toBeLessThan(hit.due);
  expect(miss.s).toBeLessThan(hit.s);
  await expect(page.locator('#test-score')).toHaveText(/^Score 1\/2/);
  await synced(page);
  // a new visit: the line never answered first, then the miss (due soonest), then the hit
  await page.reload();
  await page.locator('#test-page').waitFor({ state: 'attached' });
  await expect(page.locator('#tab-test, #side-test').first()).toBeAttached();
  await openTest(page);
  expect(await deck(page)).toEqual(['airway/tubes#ddd444', 'drugs/demo-drug#aaa111', 'drugs/sample-agent#ccc333']);
  await expect(page.locator('#test-score')).toHaveText(/^Score 1\/2/);
});

test('the area chips and find narrow the deck, as in Align', async ({ phone }) => {
  const page = await phone();
  await signIn(page, 'member');
  await openTest(page);
  await page.locator('#test-areas').getByRole('button', { name: 'Airway' }).click();
  expect(await deck(page)).toEqual(['airway/tubes#ddd444']);
  await page.locator('#test-areas').getByRole('button', { name: 'All' }).click();
  await page.locator('#test-find').fill('onset');
  await expect.poll(() => deck(page)).toEqual(['drugs/sample-agent#ccc333']);
});

test('the owner: lines with an open flag are left out, and "This fact is wrong" sends one back to Align', async ({ phone }) => {
  const page = await phone();
  await page.goto(APP, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#signed-out')).toBeVisible();
  await page.evaluate(e => window.starter.signInAs(e), DEFAULT_ADMINS[0]);
  await expect(page.locator('#tab-test, #side-test').first()).toBeAttached();
  await openTest(page);
  // F9001 and F9002 are open flags on the demo-drug and sample-agent lines
  await expect.poll(() => deck(page)).toEqual(['airway/tubes#ddd444']);
  const c = await card(page);
  await c.getByRole('button', { name: '7', exact: true }).click();   // the flag button is on the back of the card, which an answer turns over
  await c.getByRole('button', { name: 'This fact is wrong' }).click();
  await expect(page.locator('#test-toasts, #toasts')).toContainText('Sent back to Align');
  await expect.poll(async () => (await db.list('spaces/_/verdicts')).some(d => d.fact === 'wrong:airway/tubes#ddd444' && d.choice === 'flag')).toBe(true);
  await expect(page.locator('#test-deck')).toBeHidden();
  await expect(page.locator('#test-empty')).toBeVisible();
  // marked as sent back on this device and the next visit: not in the deck
  await page.reload();
  await expect(page.locator('#tab-test, #side-test').first()).toBeAttached();
  await openTest(page).catch(() => {});
  await expect.poll(() => page.evaluate(() => window.quiz?.deck() ?? [])).toEqual([]);
});

test('a member has no flag button; a viewer can answer and the state is saved', async ({ phone }) => {
  const page = await phone();
  await signIn(page, 'viewer');
  await openTest(page);
  const c = await card(page);
  await c.getByRole('button', { name: '2 mg/kg' }).click();
  await expect(c.getByRole('button', { name: 'This fact is wrong' })).toHaveCount(0);
  const d = await recallOf('drugs/demo-drug#aaa111');
  expect(d.ok).toBe(true);
});
