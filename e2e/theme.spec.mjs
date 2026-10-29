// @core/theme: the switch sets this device's theme and density, and the choice survives a reload.
import AxeBuilder from './axe.mjs';
import { test, expect, APP, openSettings } from './fixtures.mjs';

test('theme and density switch: kept on this device, accessible in dark', async ({ phone }) => {
  const page = await phone();
  await page.goto(APP, { waitUntil: 'domcontentloaded' });
  await openSettings(page);
  const root = page.locator('html');
  await expect(root).not.toHaveAttribute('data-theme');
  await expect(root).not.toHaveAttribute('data-density');

  await page.getByLabel('Theme').selectOption('dark');
  await page.getByLabel('Density').selectOption('compact');
  await expect(root).toHaveAttribute('data-theme', 'dark');
  await expect(root).toHaveAttribute('data-density', 'compact');
  expect(await AxeBuilder(page)).toEqual([]);

  await page.reload({ waitUntil: 'domcontentloaded' });
  await openSettings(page);
  await expect(root).toHaveAttribute('data-theme', 'dark');
  await expect(page.getByLabel('Density')).toHaveValue('compact');

  await page.getByLabel('Theme').selectOption('auto');
  await expect(root).not.toHaveAttribute('data-theme');
});

const cssVar = (page, name) => page.evaluate(n => getComputedStyle(document.documentElement).getPropertyValue(n).trim(), name);

test('look and dark style: applied before the page is ready, kept on reload, OLED is black', async ({ phone }) => {
  const page = await phone();
  await page.goto(APP, { waitUntil: 'domcontentloaded' });
  await openSettings(page);
  const root = page.locator('html');
  const lightBg = await cssVar(page, '--bg');
  await page.locator('#preset-pick').selectOption('eye');
  await expect(page.locator('#preset-pick')).toHaveValue('eye');   // (the kit no longer marks <html data-preset>, rc.12)
  expect(await cssVar(page, '--bg')).toBe('#efe6d2');   // the look's sepia ground
  expect(await cssVar(page, '--leading')).toBe('1.65');

  await page.getByLabel('Theme').selectOption('dark');
  await page.getByLabel('Dark style').selectOption('oled');
  await expect(root).toHaveAttribute('data-dark', 'oled');
  expect(await cssVar(page, '--bg')).toBe('#000000');
  expect(await cssVar(page, '--surface')).toBe('#000000');

  // (module scripts run before DOMContentLoaded: the chosen look is there from the first frame)
  await page.goto(APP, { waitUntil: 'domcontentloaded' });
  await openSettings(page);
  expect(await cssVar(page, '--bg')).toBe('#000000');
  await expect(page.locator('#preset-pick')).toHaveValue('eye');
  await expect(page.getByLabel('Dark style')).toHaveValue('oled');

  // (before any module runs, early.js puts back the last look: shown here with the theme modules kept from loading)
  await page.route('**/theme/index.js', route => route.abort());
  await page.goto(APP, { waitUntil: 'domcontentloaded' });
  await expect(root).toHaveAttribute('data-dark', 'oled');
  expect(await cssVar(page, '--bg')).toBe('#000000');
  await page.unroute('**/theme/index.js');
  await page.goto(APP, { waitUntil: 'domcontentloaded' });
  await openSettings(page);

  await page.locator('#preset-pick').selectOption('default');
  await page.getByLabel('Theme').selectOption('light');
  expect(await cssVar(page, '--bg')).toBe(lightBg);
});

test('accent: a picked colour is kept on this device, Reset goes back to the look\'s', async ({ phone }) => {
  const page = await phone();
  await page.goto(APP, { waitUntil: 'domcontentloaded' });
  await openSettings(page);
  const reset = page.getByRole('button', { name: 'Reset colour' });
  await expect(reset).toBeHidden();
  await expect(page.locator('#accent-pick')).toHaveValue('#3a6390');   // the app's (config.js)
  await page.locator('#accent-pick').fill('#c2417a');
  await expect(reset).toBeVisible();
  await page.reload({ waitUntil: 'domcontentloaded' });
  await openSettings(page);
  await expect(page.locator('#accent-pick')).toHaveValue('#c24179');   // (snapped to 6 bits a channel)
  expect(await cssVar(page, '--accent')).not.toBe('');
  await page.getByRole('button', { name: 'Reset colour' }).click();
  await expect(reset).toBeHidden();
  await expect(page.locator('#accent-pick')).toHaveValue('#3a6390');
});

// one test a look: 24 axe runs (~1 s each) in one test passed the timeout on a slow runner
for (let i = 0; i < 8; i++) {
  test(`look ${i + 1} of 8 passes axe in light, dark and OLED`, async ({ phone }) => {
    const page = await phone();
    await page.goto(APP, { waitUntil: 'domcontentloaded' });
    await openSettings(page);
    const looks = await page.locator('#preset-pick').locator('option').evaluateAll(os => os.map(o => /** @type {HTMLOptionElement} */ (o).value));
    expect(looks).toHaveLength(8);
    const look = looks[i];
    await page.locator('#preset-pick').selectOption(look);
    for (const [theme, dark] of [['light', 'dark'], ['dark', 'dark'], ['dark', 'oled']]) {
      await page.getByLabel('Theme').selectOption(theme);
      await page.getByLabel('Dark style').selectOption(dark);
      expect(await AxeBuilder(page), `${look} ${theme} ${dark}`).toEqual([]);
    }
  });
}
