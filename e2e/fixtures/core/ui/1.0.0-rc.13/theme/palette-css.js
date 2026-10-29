// A theme choice -> the page's custom properties: the preset's look, the accent (the choice's, else the preset's, else
// the app's), the ground, then the light palette and the dark one (OLED when picked), each brought up to its contrast
// floor (colour.js), with the glass strengths that keep text on glass at that floor. choice.js puts the text in the
// page; the tests read the same palettes. Pure, no DOM.
import { lightPalette, darkPalette, floor, glassStrengths } from './colour.js';
import { PRESETS, SURFACES } from './presets.js';
import { cleanChoice } from './schema.js';
import { lookOf } from './looks.js';

// The app's colour when it names none (applyTheme({ accent })): v0's light accent
export const DEFAULT_ACCENT = '#3a6390';

/** @typedef {import('./schema.js').Choice} Choice */
/** @typedef {import('./colour.js').Palette} Palette */
/** @typedef {{ accent?: string, look?: string }} AppTheme  the app's own defaults (config): accent colour, look id */

/** @param {Partial<Choice>} choice */
const presetOf = choice => PRESETS.find(p => p.id === choice.preset) ?? PRESETS[0];

/** @param {Partial<Choice>} choice @param {AppTheme} [app] @returns {string}  the accent picked: the choice's, the preset's or the app's */
export const accentOf = (choice, app = {}) => cleanChoice(choice).accent || presetOf(cleanChoice(choice)).accent || app.accent || DEFAULT_ACCENT;

/**
 * The two palettes a choice shows: light, and dark (pure black when the dark style is OLED; a ground never tints OLED).
 * @param {Partial<Choice>} choice @param {AppTheme} [app] @returns {{ light: Palette, dark: Palette }}
 */
export function palettes(choice, app = {}) {
  const c = cleanChoice(choice), preset = presetOf(c), accent = accentOf(c, app);
  const ground = SURFACES[c.surface || preset.surface || ''];
  const oled = c.dark === 'oled', strong = !!preset.strong;
  return {
    light: floor({ ...lightPalette(accent), ...ground?.light }, { strong }),
    dark: floor({ ...darkPalette(accent, oled), ...(oled ? {} : ground?.dark) }, { strong }),
  };
}

// corners per round level: small, normal, large (level 2 is v0's .4rem)
const ROUND = [['0', '0', '0'], ['.15rem', '.25rem', '.4rem'], ['.25rem', '.4rem', '.75rem'], ['.5rem', '.8rem', '1.25rem']];

/** @param {Partial<Choice>} choice @returns {Record<string, string>}  shape and type tokens (the same in light and dark) */
export function shapeTokens(choice) {
  const p = presetOf(cleanChoice(choice));
  const [s, m, l] = ROUND[p.round ?? 2];
  return {
    'radius-s': s, radius: m, 'radius-l': l, border: `${p.border ?? 1}px`,
    shadow: p.shadow === false ? 'none' : '0 1px 3px rgb(0 0 0 / .14)',
    // (a serif theme wins; else the look's heading face)
    'font-head': p.head === 'serif' ? 'ui-serif, Georgia, "Times New Roman", serif' : 'var(--look-font-head, inherit)',
    leading: String(p.leading ?? 1.5),
  };
}

/** @param {number} a  0 to 1 */
const cardAt = a => `color-mix(in srgb, var(--surface) ${Math.round(a * 100)}%, transparent)`;

/**
 * The glass colours for a palette (glass.css): the card colour at the strengths that keep its text readable over
 * anything scrolling under it (colour.js glassStrengths).
 * @param {Palette} p @param {Partial<Choice>} choice @returns {Record<string, string>}
 */
export function glassTokens(p, choice) {
  const { glass, thick, clear } = glassStrengths(p, { strong: !!presetOf(cleanChoice(choice)).strong });
  return { glass: cardAt(glass), 'glass-thick': cardAt(thick), 'glass-clear': cardAt(clear) };
}

/** @param {Record<string, string>} t */
const decl = t => Object.entries(t).map(([k, v]) => `--${k}: ${v};`).join(' ');

/**
 * The CSS text for a choice: the look's tokens and the theme's shapes, light on :root, dark when chosen or when Auto
 * meets a dark device.
 * @param {Partial<Choice>} choice @param {AppTheme} [app] @returns {string}
 */
export function paletteCss(choice, app = {}) {
  const { light, dark } = palettes(choice, app);
  const l = decl({ ...light, ...glassTokens(light, choice) }), d = decl({ ...dark, ...glassTokens(dark, choice) });
  const look = lookOf(cleanChoice(choice).look, app.look);
  return [
    `:root { ${decl(look.tokens)} ${decl(shapeTokens(choice))} ${l} }`,
    `@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { ${d} } }`,
    `:root[data-theme="dark"] { ${d} }`,
  ].join('\n');
}
