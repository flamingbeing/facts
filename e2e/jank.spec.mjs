// The jank gate for Align (PLAYBOOK §0; app-ui's e2e/jank.spec.mjs is the kit's own): a card swiped on and flicked
// back, start to landing, on a phone whose CPU is slowed 4x (the DevTools protocol, a real touch path), keeps every
// frame on time, and the 'seen' verdict for the card left behind waits for the glide to land. A failure here is slow
// work to fix (transform and opacity only, afterGesture for the rest), never a number to loosen.
import { test, expect, signIn, db } from './fixtures.mjs';

test.describe.configure({ mode: 'serial' });   // a test beside it would steal its frames; and align.spec's verdicts
const LINES = ['drugs~demo-drug~aaa111', 'drugs~demo-drug~bbb222', 'drugs~sample-agent~ccc333', 'airway~tubes~ddd444'];
test.beforeEach(async () => { for (const id of LINES) await db.del(`spaces/_/verdicts/${id}`); });

// app-ui's budget (ms): every drag frame within frame but one, none over worst, no task over task
const BUDGET = { frame: 20, late: 1, worst: 50, task: 50 };
const SLOWER = 4;
const tabLink = '.ui-tab[data-tab-page="#align-page"]:visible, .ui-side-link[data-tab-page="#align-page"]:visible';

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
