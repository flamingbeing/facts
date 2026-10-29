// Align: the cards from the made-up notes in e2e/fixtures/data/ (served at /data/ by worker/data.js), the answers
// saved as verdicts, a card left with no answer saved as 'seen', the fix sheet, the area chips and find, and viewers.
import { test, expect, signIn, synced, db, APP } from './fixtures.mjs';
import { DEFAULT_ADMINS } from '../worker/members.js';

// the verdicts are one shared set ('_'), so this file's tests run one at a time, each from none (the jank gate at the
// end lives here too: a second file would run in another worker and wipe the verdicts under these)
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

// the deck fills the screen down to the tab bar (the kit's cardPager fill), so a whole card shows with no scroll of
// its own and the page itself does not scroll; a card taller than that scrolls in its slot
for (const width of [412, 1280]) {
  test(`the card fills the screen below the count line down to the tab bar (${width} px)`, async ({ sized }) => {
    const page = await sized(width);
    await signIn(page, 'member');
    await openAlign(page);
    const m = () => page.evaluate(() => {
      const d = /** @type {HTMLElement} */ (document.getElementById('align-deck'));
      const padPx = () => { const x = document.createElement('div'); x.style.height = 'var(--pad)'; d.after(x); const h = x.getBoundingClientRect().height; x.remove(); return h; };
      const bar = document.querySelector('.ui-tabbar:not([hidden])'), b = bar?.getBoundingClientRect();
      const slot = /** @type {HTMLElement} */ (d.querySelector('.ui-card-slot:not([inert])'));
      return { top: d.getBoundingClientRect().top, bottom: d.getBoundingClientRect().bottom, count: document.getElementById('align-count').getBoundingClientRect().bottom,
        floor: b && b.height ? b.top : innerHeight, pad: padPx(),
        page: document.scrollingElement.scrollHeight - innerHeight, own: slot.scrollHeight - slot.clientHeight,
        card: /** @type {HTMLElement} */ (slot.firstElementChild).getBoundingClientRect().height, slotH: slot.clientHeight };
    });
    await expect.poll(async () => { const r = await m(); return Math.abs(r.floor - r.pad - r.bottom); }, { message: 'the deck ends one --pad above the tab bar (or the window)' }).toBeLessThanOrEqual(2);
    const r = await m();
    expect(r.top - r.count, 'it starts under the count line').toBeLessThan(40);
    expect(r.page, 'the page does not scroll').toBeLessThanOrEqual(1);
    // the whole card fits (an MCQ card keeps room for its hidden answer, so this holds at 1280 x 800 too)
    expect(r.own, 'the card has no scroll of its own').toBe(0);
    expect(r.card, 'the card fills its slot').toBeCloseTo(r.slotH, 0);
    // a card far taller than the screen keeps the deck's height and scrolls inside it
    await page.evaluate(() => { document.querySelector('#align-deck .ui-card-slot:not([inert]) .align-stem').textContent = 'A long question. '.repeat(300); });
    const long = await m();
    expect(long.bottom).toBeCloseTo(r.bottom, 0);
    expect(long.own).toBeGreaterThan(0);
  });
}

test('the owner gets the open flags first (high, clash, medium); an answer goes to the queue when the page hides', async ({ phone }) => {
  const page = await phone();
  await page.goto(APP, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#signed-out')).toBeVisible();
  await page.evaluate(e => window.starter.signInAs(e), DEFAULT_ADMINS[0]);   // the owner: admin by default, no role doc
  await expect(page.locator('#align-count')).toBeVisible();
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

// The jank gate for Align (PLAYBOOK §0; app-ui's e2e/jank.spec.mjs is the kit's own): a card swiped on and flicked
// back, start to landing, on a phone whose CPU is slowed 4x (the DevTools protocol, a real touch path), keeps every
// frame on time, and the 'seen' verdict for the card left behind waits for the glide to land. A failure here is slow
// work to fix (transform and opacity only, afterGesture for the rest), never a number to loosen.
// app-ui's budget (ms): every drag frame within frame but one, none over worst, no task over task
const BUDGET = { frame: 20, late: 1, worst: 50, task: 50 };
const SLOWER = 4;

/** n moves from a to b @param {number[]} a @param {number[]} b @param {number} n */
const path = (a, b, n) => Array.from({ length: n + 1 }, (_, i) => [a[0] + (b[0] - a[0]) * i / n, a[1] + (b[1] - a[1]) * i / n]);

test('an Align card swiped on and flicked back keeps every frame on time on a slow phone', async ({ phone }) => {
  const page = await phone();
  await signIn(page, 'member');
  await page.locator(tabLink).first().click();
  await expect(page.locator('#align-count')).toHaveText('1 of 4');
  // the plain look: with no GPU here the glass's blur is drawn in software and drops frames a phone's GPU would not
  await page.evaluate(() => document.documentElement.classList.remove('glass'));
  await page.evaluate(() => {
    let frames = [], tasks = [], on = false, last = 0, moved = 0, lifted = 0;
    new PerformanceObserver(list => { if (on) for (const e of list.getEntries()) tasks.push([e.startTime, e.startTime + e.duration]); })
      .observe({ type: 'longtask' });
    const tick = t => { if (!on) return; if (last) frames.push([last, t]); last = t; requestAnimationFrame(tick); };
    addEventListener('touchmove', e => { if (on && !moved) moved = e.timeStamp; }, { capture: true, passive: true });
    addEventListener('touchend', e => { if (on && !lifted) lifted = e.timeStamp; }, { capture: true, passive: true });
    const frame = () => new Promise(r => requestAnimationFrame(() => r(undefined)));
    window.__jank = {
      start() { frames = []; tasks = []; last = 0; moved = lifted = 0; on = true; requestAnimationFrame(tick); },
      async stop() {
        await Promise.all(document.getAnimations().map(a => a.finished.catch(() => {})));
        const landed = /** @type {number} */ (document.timeline.currentTime);
        await frame(); await frame();
        on = false;
        const within = (x, y) => ([a, b]) => b > x && a < y, ms = ([a, b]) => b - a;
        return { drag: frames.filter(within(moved, lifted)).map(ms), glide: frames.filter(within(lifted, landed)).map(ms), tasks: tasks.filter(within(moved, landed)).map(ms) };
      },
    };
  });
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: SLOWER });
  const send = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
  const drag = async pts => {
    await send('touchStart', ...pts[0]);
    for (const p of pts.slice(1)) { await new Promise(r => setTimeout(r, 16)); await send('touchMove', ...p); }
    await send('touchEnd', ...pts.at(-1));
  };
  const gate = async (what, run) => {
    await page.evaluate(() => window.__jank.start());
    await run();
    const { drag: d, glide, tasks } = await page.evaluate(() => window.__jank.stop());
    const got = { frames: d.length, late: d.filter(x => x > BUDGET.frame).length, worst: Math.round(Math.max(...d)),
      glide: glide.length, glideWorst: Math.round(Math.max(0, ...glide)), task: Math.round(Math.max(0, ...tasks)) };
    console.log(`jank ${what}: ${JSON.stringify(got)}`);
    expect(got.frames, `${what}: enough frames to judge`).toBeGreaterThan(4);
    expect(got.late, `${what}: drag frames over ${BUDGET.frame} ms`).toBeLessThanOrEqual(BUDGET.late);
    expect(got.worst, `${what}: no drag frame over ${BUDGET.worst} ms`).toBeLessThanOrEqual(BUDGET.worst);
    expect(got.glide, `${what}: a glide to judge`).toBeGreaterThan(4);
    expect(got.glideWorst, `${what}: no glide frame over ${BUDGET.worst} ms`).toBeLessThanOrEqual(BUDGET.worst);
    expect(got.task, `${what}: no task over ${BUDGET.task} ms`).toBeLessThanOrEqual(BUDGET.task);
  };

  // the swipe starts on the card's header (where), not its buttons
  const box = await page.locator('#align-deck').boundingBox();
  const y = Math.round(box.y + 24), right = Math.round(box.x + box.width - 60), left = Math.round(box.x + 90);
  await gate('align card swipe', () => drag(path([right, y], [right - 200, y], 14)));
  await expect(page.locator('#align-count')).toHaveText('2 of 4');
  await gate('align card flick back', () => drag(path([left, y], [left + 150, y], 5)));
  await expect(page.locator('#align-count')).toHaveText('1 of 4');
  // the card left behind was saved as seen (after the glide landed)
  await expect.poll(async () => (await db.list('spaces/_/verdicts')).find(d => d.fact === 'drugs/demo-drug#aaa111')?.choice, { timeout: 15_000 }).toBe('seen');
});
