// @core/theme glass + motion: glass bars, toasts and sheets by default, Solid per device (kept, and put back before
// the modules run), solid where the device asks for less transparency or more contrast, axe on glass, the screen
// switch as a view transition. Screenshots of the sample in light, dark, OLED and Solid go to test-results/ for the PR.
import AxeBuilder, { byTool } from './axe.mjs';
import { test, expect, signIn, APP, openSettings, openAlign } from './fixtures.mjs';

/** @param {import('@playwright/test').Page} page @param {string} sel @param {string} prop */
const style = (page, sel, prop) => page.locator(sel).first().evaluate((e, p) => getComputedStyle(e).getPropertyValue(p), prop);
// the card colour as the browser draws it (the bar's solid background compares against it)
const surface = page => page.evaluate(() => {
  const probe = document.createElement('div');
  probe.style.color = 'var(--surface)';
  document.body.append(probe);
  const c = getComputedStyle(probe).color;
  probe.remove();
  return c;
});

// the kit's bar is clear at the top of a page and turns to the glass once the page scrolls under it (.is-collapsed)
const collapsed = page => page.evaluate(() => document.querySelector('.ui-bar')?.classList.add('is-collapsed'));

// this app's own look (E, Workspace) has no glass, so these take look A, which has it
const glassLook = page => page.getByRole('combobox', { name: 'Look', exact: true }).selectOption('a');

test('glass by default; Solid in the switch takes it off, kept on reload and before the modules run', async ({ phone }) => {
  const page = await phone();
  await page.goto(APP, { waitUntil: 'domcontentloaded' });
  await openSettings(page);
  await glassLook(page);
  const root = page.locator('html');
  await expect(root).toHaveClass(/\bglass\b/);
  await collapsed(page);
  expect(await style(page, '.ui-bar', 'backdrop-filter')).toContain('blur');
  expect(await style(page, '.ui-bar', 'background-color')).toMatch(/(color\(srgb|oklab\(|rgba\().* \/ 0\.\d+\)/);   // see-through

  await page.getByLabel('Bars and sheets').selectOption('solid');
  await expect(root).not.toHaveClass(/\bglass\b/);
  await collapsed(page);
  expect(await style(page, '.ui-bar', 'backdrop-filter')).toBe('none');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await openSettings(page);
  await expect(root).not.toHaveClass(/\bglass\b/);
  await expect(page.getByLabel('Bars and sheets')).toHaveValue('solid');

  // (early.js takes the class off before any module runs: shown with the theme modules kept from loading)
  await page.route('**/theme/index.js', route => route.abort());
  await page.goto(APP, { waitUntil: 'domcontentloaded' });
  await expect(root).not.toHaveClass(/\bglass\b/);
  await page.unroute('**/theme/index.js');
  await page.goto(APP, { waitUntil: 'domcontentloaded' });
  await openSettings(page);

  await page.getByLabel('Bars and sheets').selectOption('glass');
  await expect(root).toHaveClass(/\bglass\b/);
});

// (Playwright can't emulate prefers-reduced-transparency; glass.css turns glass down for it in the same query)
test('asked for more contrast: solid card colour, no blur', async ({ phone }) => {
  const page = await phone();
  await page.goto(APP, { waitUntil: 'domcontentloaded' });
  await openSettings(page);
  await glassLook(page);
  await page.emulateMedia({ contrast: 'more' });
  // Firefox: a media change by emulation does not re-cascade the sheets already loaded (a context option is not honoured
  // either); switching them off and on does
  await page.evaluate(() => document.querySelectorAll('link[rel=stylesheet]').forEach(l => { l.disabled = true; l.disabled = false; }));
  await expect(page.locator('html')).toHaveClass(/\bglass\b/);
  await collapsed(page);
  expect(await style(page, '.ui-bar', 'backdrop-filter')).toBe('none');
  await expect.poll(async () => style(page, '.ui-bar', 'background-color')).toBe(await surface(page));   // (the bar fades to it)
});

// (the springs finished, so axe and the screenshots see the parts at rest, not mid fade-in)
const settled = page => page.evaluate(() => Promise.all(document.getAnimations().map(a => a.finished.catch(() => {}))));

const MODES = [
  ['light', { theme: 'light', dark: 'dark', material: 'glass' }],
  ['dark', { theme: 'dark', dark: 'dark', material: 'glass' }],
  ['oled', { theme: 'dark', dark: 'oled', material: 'glass' }],
  ['solid', { theme: 'light', dark: 'dark', material: 'solid' }],
];

// (one test per mode: the four together ran ~55 s in WebKit, close to the 60 s limit)
for (const [name, pick] of MODES) test(`the app in ${name}: axe on Settings, a screenshot of Align; screenshots kept`, async ({ phone }, info) => {
  const page = await phone();
  await signIn(page, 'member');
  await openSettings(page);
  await page.getByLabel('Theme').selectOption(pick.theme);
  await page.getByLabel('Dark style').selectOption(pick.dark);
  await page.getByLabel('Bars and sheets').selectOption(pick.material);
  await settled(page);
  expect(await AxeBuilder(page), `${name}: Settings`).toEqual([]);
  await byTool(page, () => page.screenshot({ path: info.outputPath(`glass-${name}-settings.png`) }));

  await openAlign(page);
  await expect(page.locator('#align-count')).toContainText('1 of');
  await page.evaluate(() => scrollTo(0, 260));   // (content under the bar, so the scroll edge and the glass show)
  await settled(page);
  await byTool(page, () => page.screenshot({ path: info.outputPath(`glass-${name}.png`) }));
});

// cloud{ (a static app has one screen)
test('a change of screen is a view transition, unless motion is reduced', async ({ phone }) => {
  for (const reducedMotion of ['no-preference', 'reduce']) {
    const page = await phone();
    await page.emulateMedia({ reducedMotion });
    await page.addInitScript(() => {
      window.__vt = 0;
      const start = document.startViewTransition?.bind(document);
      if (start) document.startViewTransition = cb => { window.__vt++; return start(cb); };
    });
    await signIn(page, null);   // signed out -> no access: one change of screen
    const n = await page.evaluate(() => window.__vt);
    // Playwright's Firefox (142) has no document.startViewTransition: the app falls back to a plain change there
    const supported = await page.evaluate(() => typeof document.startViewTransition === 'function');
    if (reducedMotion === 'reduce' || !supported) expect(n).toBe(0);
    else expect(n).toBeGreaterThan(0);
  }
});
// }cloud
