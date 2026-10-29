// This device's theme choice (schema.js: theme, dark style, preset, accent, surface, look, density, material, motion):
// kept in localStorage, shown as data-theme / data-dark / data-look / data-density / data-motion, the
// look's variants (data-header, data-menu, data-glass, data-tick, data-tabbar) and the glass class on <html> (glass
// unless Solid, the look has none, or the glass guard turned it down: guard.js) and as the palette's custom properties in one
// constructed stylesheet (palette-css.js; constructed, so the Content-Security-Policy needs no inline style). Nothing
// chosen, an unknown value or no storage: the defaults, so a new option stays off until picked. v0's stored
// { theme, layout } reads as it did.
import { THEMES, LAYOUTS, DENSITIES, cleanChoice } from './schema.js';
import { paletteCss, accentOf } from './palette-css.js';
import { cleanHex } from './colour.js';
import { lookOf, LOOK_IDS } from './looks.js';
import { guardSolid, startGuard } from './guard.js';

export { THEMES, LAYOUTS, DENSITIES };
// the <html> marks early.js puts back before the first paint
// (no data-preset: a preset (the switch's "style": colours, corners, lines) acts only through the palette's custom
// properties; the look (looks.js) is what the CSS styles from)
export const MARKS = Object.freeze(['theme', 'dark', 'look', 'density', 'motion', 'header', 'menu', 'glass', 'tick', 'tabbar']);
const KEY = 'core-theme';
// The last look shown (marks + palette CSS), for early.js to put back before the first paint.
const PAINT = 'core-theme-paint';
// The choice made on this page while storage refuses it, so a second pick builds on the first.
/** @type {Choice | null} */
let unstored = null;
/** @type {import('./palette-css.js').AppTheme} */
let app = {};
/** @type {CSSStyleSheet | null} */
let sheet = null;

/** @typedef {import('./schema.js').Choice} Choice */

/** @type {Choice | null}  a look shown without keeping it (previewTheme), until the next pick */
let shown = null;
/** @type {(() => void) | null} */
let stopGuard = null;

/** @param {string | null} stored  what KEY holds -> the choice it names, defaults where it names none */
export function parseChoice(stored) {
  let saved = null;
  try { saved = JSON.parse(stored || 'null'); } catch { /* unreadable: the defaults */ }
  return cleanChoice(saved);
}

/** @returns {Choice} */
export function themeChoice() {
  if (unstored) return unstored;
  try { return parseChoice(localStorage.getItem(KEY)); } catch { return parseChoice(null); }
}

/** @returns {string}  the accent this device's choice shows before its contrast floor (the switch's colour well) */
export const pickedAccent = () => accentOf(themeChoice(), app);

/** @param {HTMLElement} root @param {string} key @param {string} value @param {string} off  the value no attribute means */
function mark(root, key, value, off) {
  if (value === off) delete root.dataset[key]; else root.dataset[key] = value;
}

/** @param {Choice} c  @returns {boolean} glass on: not Solid, the look has some, and the guard let it (or 'always') */
export const glassOn = c => c.material !== 'solid' && lookOf(c.look, app.look).variants.glass !== 'none'
  && (c.material === 'always' || !guardSolid());

/** @param {Choice} c */
function show(c) {
  const root = document.documentElement;
  const look = lookOf(c.look, app.look);
  mark(root, 'theme', c.theme, THEMES[0]);
  mark(root, 'dark', c.dark, 'dark');
  root.dataset.look = look.id;
  mark(root, 'density', c.density, DENSITIES[0]);
  mark(root, 'motion', c.motion, 'auto');
  for (const [k, v] of Object.entries(look.variants)) root.dataset[k] = v;
  root.classList.toggle('glass', glassOn(c));
  // (no constructed stylesheets, as in node or an old browser: theme.css's own values stay)
  if (typeof CSSStyleSheet !== 'function' || !('adoptedStyleSheets' in document)) return;
  // (early.js's sheet, when it put back the last look before the first paint: this one replaces its values)
  if (!sheet) sheet = /** @type {any} */ (globalThis).coreThemeSheet ?? null;
  if (!sheet) { sheet = new CSSStyleSheet(); document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet]; }
  const css = paletteCss(c, app);
  sheet.replaceSync(css);
  const marks = Object.fromEntries(MARKS.map(k => [k, root.dataset[k]]));
  try { localStorage.setItem(PAINT, JSON.stringify({ marks, solid: !glassOn(c), css })); } catch { /* early.js finds none */ }
}

/**
 * Shows this device's choice; call once, as early as the page can (the starter's boot.js, before first paint).
 * Starts the glass guard too (guard.js): its verdict, once found, shows the choice again.
 * @param {import('./palette-css.js').AppTheme} [appTheme]  the app's own defaults: accent, its colour (hex); look,
 *   the look a device that picked none gets (looks.js ids; none: A)
 */
export function applyTheme(appTheme = {}) {
  const accent = cleanHex(appTheme.accent);
  app = { ...(accent ? { accent } : {}), ...(LOOK_IDS.includes(appTheme.look ?? '') ? { look: appTheme.look } : {}) };
  show(shown ?? themeChoice());
  if (!stopGuard) stopGuard = startGuard(() => show(shown ?? themeChoice()));
}

/** @param {Partial<Choice>} change  shows the choice with this change on this page only, keeping nothing (the
 *  gallery's ?look= links) @returns {Choice} */
export function previewTheme(change) {
  shown = cleanChoice({ ...themeChoice(), ...change });
  show(shown);
  return shown;
}

/** @returns {string}  the look this page shows (the choice's, else the app's, else A) */
export const shownLook = () => lookOf((shown ?? themeChoice()).look, app.look).id;

/** @param {Partial<Choice>} change  -> the choice now (kept on this device when storage allows) */
export function chooseTheme(change) {
  const next = cleanChoice({ ...themeChoice(), ...change });
  try { localStorage.setItem(KEY, JSON.stringify(next)); unstored = null; } catch { unstored = next; }
  shown = null;
  show(next);
  return next;
}
