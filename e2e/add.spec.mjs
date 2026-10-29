// The Add tab (owner only): a typed fact is filed by /api/file (canned in the tests: the first topic, section Notes), a
// confirm card shows topic, section and line, Confirm saves an 'add' verdict and flushes it; Discard clears the card.
// Its own file: it only adds 'add:' verdicts, which the Align tests' clean-up (their beforeEach) would also remove.
import { test, expect, signIn, db } from './fixtures.mjs';
import { DEFAULT_ADMINS } from '../worker/members.js';

const tab = '.ui-tab[data-tab-page="#add-page"]:visible, .ui-side-link[data-tab-page="#add-page"]:visible';
const addVerdicts = async () => (await db.list('spaces/_/verdicts')).filter(d => d.fact.startsWith('add:'));
test.beforeEach(async () => { for (const d of await addVerdicts()) await db.del(`spaces/_/verdicts/${d.by}~${d.fact.replaceAll(/[/#]/g, '~')}`); });

/** @param {import('@playwright/test').Page} page */
async function openAdd(page) {
  await page.evaluate(() => { scrollTo(0, 0); document.querySelector('.ui-tabbar')?.classList.remove('is-minimised'); });
  await page.locator(tab).first().click();
  await expect(page.locator('#add-page')).toBeVisible();
}

test('a member has no Add tab', async ({ phone }) => {
  const page = await phone();
  await signIn(page, 'member');
  await expect(page.locator('#tab-add')).toBeHidden();
  await expect(page.locator('#side-add')).toBeHidden();
});

test('the owner files a fact: the card shows topic, section and line; Confirm queues it, Discard clears', async ({ phone }) => {
  const page = await phone();
  await signIn(page, 'member');   // (then the owner's account: admin by default, no role doc)
  await page.evaluate(e => window.starter.signInAs(e), DEFAULT_ADMINS[0]);
  await expect(page.locator('#tab-add')).toBeVisible();
  await openAdd(page);
  await expect(page.locator('#add-card')).toBeHidden();
  await page.locator('#add-text').fill('Made-up fact: dose 3 mg/kg');
  await page.locator('#add-file').click();
  await expect(page.locator('#add-card')).toBeVisible();
  await expect(page.locator('#add-section')).toHaveValue('Notes');
  await expect(page.locator('#add-line')).toHaveValue('Made-up fact: dose 3 mg/kg');
  expect(await page.locator('#add-topic').inputValue()).toMatch(/^[a-z]+\/[a-z0-9-]+$/);
  // discard
  await page.locator('#add-discard').click();
  await expect(page.locator('#add-card')).toBeHidden();
  // file again, change the topic/section/line, confirm
  await page.locator('#add-file').click();
  await expect(page.locator('#add-card')).toBeVisible();
  await page.locator('#add-topic').fill('drugs/demo-drug');
  await page.locator('#add-section').fill('Dosage');
  await page.locator('#add-line').fill('Dose 3 mg/kg IV');
  const flushed = page.waitForResponse(r => r.url().endsWith('/api/flush'));
  await page.locator('#add-confirm').click();
  expect((await flushed).status()).toBe(200);
  await expect(page.locator('#add-card')).toBeHidden();
  await expect.poll(async () => (await addVerdicts()).length, { timeout: 15_000 }).toBe(1);
  const [v] = await addVerdicts();
  expect(v).toMatchObject({ choice: 'add', text: 'Dose 3 mg/kg IV', section: 'Dosage' });
  expect(v.fact).toMatch(/^add:drugs\/demo-drug#[a-z0-9]+$/);
  // a topic that is not area/name is not sent
  await page.locator('#add-text').fill('Another made-up fact');
  await page.locator('#add-file').click();
  await expect(page.locator('#add-card')).toBeVisible();
  await page.locator('#add-topic').fill('nonsense');
  await page.locator('#add-confirm').click();
  await expect(page.locator('#add-status')).toContainText('area/name');
  expect((await addVerdicts()).length).toBe(1);
});
