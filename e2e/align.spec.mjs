// Align: the cards from the made-up notes in e2e/fixtures/data/ (served at /data/ by worker/data.js), the answers
// saved as verdicts, a card left with no answer saved as 'seen', the fix sheet, the area chips and find, and viewers.
import { test, expect, signIn, synced, db, APP } from './fixtures.mjs';
import { DEFAULT_ADMINS } from '../worker/members.js';

// the verdicts are one shared set ('_'), so this file's tests run one at a time, each from none
test.describe.configure({ mode: 'serial' });
// every verdict there (ids are the person's uid and the line), each test from none
test.beforeEach(async () => { for (const d of await db.list('spaces/_/verdicts')) await db.del(`spaces/_/verdicts/${d.by}~${d.fact.replaceAll(/[/#]/g, '~')}`); });

const tabLink = '.ui-tab[data-tab-page="#align-page"]:visible, .ui-side-link[data-tab-page="#align-page"]:visible';
/** @param {import('@playwright/test').Page} page */
const openAlign = async page => {
  await page.evaluate(() => { scrollTo(0, 0); document.querySelector('.ui-tabbar')?.classList.remove('is-minimised'); });
  await page.locator(tabLink).first().click();
  await expect(page.locator('#align-view')).toBeVisible();
  await expect(page.locator('#align-count')).toContainText('1 of');
};
// the card shown (the pager's middle slot moves as it turns, so find it by its line)
const card = async page => page.locator(`#align-deck .align-card[data-line="${await page.evaluate(() => window.align.deck()[window.align.index()])}"]`);
/** @param {string} fact @param {string} [choice] */
const verdictOf = async (fact, choice) => {
  let doc;
  await expect.poll(async () => {
    doc = (await db.list('spaces/_/verdicts')).find(d => d.fact === fact && (!choice || d.choice === choice));
    return !!doc;
  }, { timeout: 15_000 }).toBe(true);
  return doc;
};

test('an MCQ card: a tap shows the line and the right option; an answer is saved and the next card comes', async ({ phone }) => {
  const page = await phone();
  await signIn(page, 'member');
  await synced(page);
  await openAlign(page);
  expect(await page.evaluate(() => window.align.deck())).toEqual(['drugs/demo-drug#aaa111', 'drugs/sample-agent#ccc333', 'airway/tubes#ddd444', 'drugs/demo-drug#bbb222']);
  const c = await card(page);
  await expect(c.locator('.align-stem')).toHaveText('What is the demo dose?');
  await expect(c.locator('.align-back')).toBeHidden();
  await c.getByRole('button', { name: '1 mg/kg' }).click();
  await expect(c.locator('.align-line')).toHaveText('Dose 2 mg/kg IV');
  await expect(c.getByRole('button', { name: '2 mg/kg' })).toHaveClass(/right/);
  await expect(c.getByRole('button', { name: '1 mg/kg' })).toHaveClass(/wrong/);
  await c.getByRole('button', { name: 'Agree' }).click();
  await expect(page.locator('#align-count')).toHaveText('2 of 4');
  const v = await verdictOf('drugs/demo-drug#aaa111', 'agree');
  expect(v.text).toBe('');
  expect(typeof v.by).toBe('string');
});

test('a card swiped on with no answer is saved as seen; a blank shows its answer on a tap', async ({ phone }) => {
  const page = await phone();
  await signIn(page, 'member');
  await openAlign(page);
  await page.evaluate(() => window.align.go(1));
  await expect(page.locator('#align-count')).toHaveText('2 of 4');
  await verdictOf('drugs/demo-drug#aaa111', 'seen');
  const c = await card(page);
  await expect(c.locator('.align-stem')).toHaveText('Onset in ____');
  await c.getByRole('button', { name: 'Show answer' }).click();
  await expect(c.locator('.align-answer')).toHaveText('Answer: 60 s');
  await expect(c.locator('.align-line')).toHaveText('Onset in 60 s');
});

test('"Notes wrong" opens the fix sheet with the line; Save keeps his text with the verdict', async ({ phone }) => {
  const page = await phone();
  await signIn(page, 'member');
  await openAlign(page);
  const c = await card(page);
  await c.getByRole('button', { name: '2 mg/kg' }).click();
  await c.getByRole('button', { name: 'Notes wrong' }).click();
  await expect(page.locator('#fix')).toBeVisible();
  await expect(page.locator('#fix-text')).toHaveValue('Dose 2 mg/kg IV');
  await page.locator('#fix-text').fill('Dose 3 mg/kg IV');
  await page.locator('#fix').getByRole('button', { name: 'Save' }).click();
  await expect(page.locator('#align-count')).toHaveText('2 of 4');
  expect((await verdictOf('drugs/demo-drug#aaa111', 'repo-wrong')).text).toBe('Dose 3 mg/kg IV');
});

test('the area chips and find narrow the deck', async ({ phone }) => {
  const page = await phone();
  await signIn(page, 'member');
  await openAlign(page);
  await page.locator('#align-areas').getByRole('button', { name: 'Airway' }).click();
  await expect.poll(() => page.evaluate(() => window.align.deck())).toEqual(['airway/tubes#ddd444']);
  await page.locator('#align-areas').getByRole('button', { name: 'All' }).click();
  await page.locator('#align-find').fill('onset');
  await expect.poll(() => page.evaluate(() => window.align.deck())).toEqual(['drugs/sample-agent#ccc333']);
  await page.locator('#align-find').fill('nothing like this');
  await expect(page.locator('#align-empty')).toContainText('No cards here');
});

test('answered lines go to the back of the deck next time', async ({ phone }) => {
  const page = await phone();
  await signIn(page, 'member');
  await openAlign(page);
  await (await card(page)).getByRole('button', { name: '2 mg/kg' }).click();
  await (await card(page)).getByRole('button', { name: 'Agree' }).click();
  await verdictOf('drugs/demo-drug#aaa111', 'agree');
  await synced(page);
  await page.reload();
  await openAlign(page);
  await expect.poll(() => page.evaluate(() => window.align.deck()[3])).toBe('drugs/demo-drug#aaa111');
  await expect((await card(page)).locator('.align-stem')).toHaveText('Onset in ____');
});

test('a viewer sees the cards but cannot answer', async ({ phone }) => {
  const page = await phone();
  await signIn(page, 'viewer');
  await openAlign(page);
  const c = await card(page);
  await c.getByRole('button', { name: '2 mg/kg' }).click();
  await expect(c.getByRole('button', { name: 'Agree' })).toBeDisabled();
});

test('the fix sheet closed with Escape saves nothing; a swipe past a line he fixed before keeps his fix', async ({ phone }) => {
  const page = await phone();
  await signIn(page, 'member');
  await openAlign(page);
  await (await card(page)).getByRole('button', { name: '2 mg/kg' }).click();
  await (await card(page)).getByRole('button', { name: 'Notes wrong' }).click();
  await page.locator('#fix-text').fill('Dose 3 mg/kg IV');
  await page.locator('#fix').getByRole('button', { name: 'Save' }).click();
  await expect(page.locator('#align-count')).toHaveText('2 of 4');
  // the next card: Edit, then Escape (the sheet's last close was a Save)
  const c = await card(page);
  await c.getByRole('button', { name: 'Show answer' }).click();
  await c.getByRole('button', { name: 'Edit' }).click();
  await expect(page.locator('#fix')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#fix')).toBeHidden();
  await expect(page.locator('#align-count')).toHaveText('2 of 4');
  // on past the rest (saved as seen), so next time the fixed line is the oldest, second after the one never seen
  const next = async n => { await page.evaluate(() => window.align.go(1)); await expect(page.locator('#align-count')).toHaveText(`${n} of 4`); };
  await next(3); await next(4);
  await verdictOf('airway/tubes#ddd444', 'seen');
  expect((await verdictOf('drugs/sample-agent#ccc333')).choice).toBe('seen');
  await synced(page);
  await page.reload();
  await openAlign(page);
  await expect.poll(() => page.evaluate(() => window.align.deck())).toEqual(['drugs/demo-drug#bbb222', 'drugs/demo-drug#aaa111', 'drugs/sample-agent#ccc333', 'airway/tubes#ddd444']);
  await next(2); await next(3);
  await verdictOf('drugs/demo-drug#bbb222', 'seen');
  await synced(page);
  const v = await verdictOf('drugs/demo-drug#aaa111');
  expect([v.choice, v.text]).toEqual(['repo-wrong', 'Dose 3 mg/kg IV']);
});

test('the owner gets the open flags first (high, clash, medium); an answer goes to the queue when the page hides', async ({ phone }) => {
  const page = await phone();
  await page.goto(APP, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#signed-out')).toBeVisible();
  await page.evaluate(e => window.starter.signInAs(e), DEFAULT_ADMINS[0]);   // the owner: admin by default, no role doc
  await expect(page.locator('#list-view')).toBeVisible();
  await openAlign(page);
  await expect.poll(() => page.evaluate(() => window.align.deck().slice(0, 4))).toEqual(['flag:F9002', 'flag:F9003', 'flag:F9001', 'drugs/demo-drug#aaa111']);
  const c = await card(page);
  await expect(c.locator('.align-where')).toHaveText('Flag · High · Sample agent');
  await expect(c.locator('.align-line')).toHaveText('Onset in 60 s');
  await expect(c.locator('.align-note')).toHaveText('Made-up note: onset seems slow.');
  await c.getByRole('button', { name: 'Fix as the note says' }).click();
  await expect(page.locator('#align-count')).toHaveText(/^2 of/);
  await verdictOf('flag:F9002', 'accept-fix');
  const clash = await card(page);
  await expect(clash.locator('.align-line')).toHaveText(['Made-up line A', 'Made-up line B']);
  // the page hides: the queue call goes now (locally the Worker lists what it would write)
  const flushed = page.waitForResponse(r => r.url().endsWith('/api/flush'));
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  expect((await flushed).status()).toBe(200);
  // the mark moved past his answer (a keepalive call's answer can't be read here; worker/test/flush.test.mjs has the items)
  const v = await verdictOf('flag:F9002', 'accept-fix');
  await expect.poll(async () => (await db.list('flush')).some(d => d.upto >= Date.parse(v.serverAt)), { timeout: 15_000 }).toBe(true);
});
