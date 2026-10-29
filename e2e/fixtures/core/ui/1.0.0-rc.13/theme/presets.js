// The looks a device can pick (logbook's 8 classic themes, on the starter's tokens), and the page grounds (surfaces)
// they and the switch can use. Data only: palette-css.js turns a choice into CSS, schema.js lists the allowed values.
//
// A preset sets: accent (none: the app's own, applyTheme({ accent })), surface, round (corners 0 square ... 3 very
// round, 2 = v0's), border (control line width, px), shadow (cards and sheets), head ('serif' headings), leading
// (line height) and strong (7:1 text, 4.5:1 lines: palette floors raised).

/** @typedef {Record<string, string>} Tokens */
/** @typedef {{ label: string, light?: Tokens, dark?: Tokens }} Surface */
/**
 * @typedef {{ id: string, name: string, desc: string, accent?: string, surface?: string, round?: number,
 *   border?: number, shadow?: boolean, head?: 'serif', leading?: number, strong?: boolean }} Preset
 */

// Page grounds in light and dark (never OLED, which stays black). Lines and status colours are left to the palette.
/** @type {Readonly<Record<string, Surface>>} */
export const SURFACES = Object.freeze({
  white: { label: 'White', light: { bg: '#ffffff' }, dark: { bg: '#111111', surface: '#191919' } },
  grey: { label: 'Light grey', light: { bg: '#f3f2f1' }, dark: { bg: '#161616', surface: '#202020' } },
  cream: { label: 'Cream', light: { bg: '#f7f3ec', surface: '#fffdf9' }, dark: { bg: '#1b1916', surface: '#24211d' } },
  sepia: {
    label: 'Sepia',
    light: { bg: '#efe6d2', surface: '#faf4e6', text: '#3b352c', muted: '#6b6152' },
    dark: { bg: '#1d1915', surface: '#26211b', text: '#e8dfcf', muted: '#b5a993' },
  },
  navy: { label: 'Navy night', light: { bg: '#eef2f8' }, dark: { bg: '#0a1628', surface: '#10223b' } },
  black: { label: 'Black', light: { bg: '#f4f4f4' }, dark: { bg: '#000000', surface: '#121212' } },
});

/** @type {readonly Preset[]} */
export const PRESETS = Object.freeze([
  { id: 'default', name: 'Default', desc: "The app's colour, soft cards" },
  { id: 'flat', name: 'Flat', desc: 'No shadows, small corners', round: 1, shadow: false },
  { id: 'soft', name: 'Soft', desc: 'Very round, gentle grey', round: 3, surface: 'grey' },
  { id: 'paper', name: 'Paper', desc: 'Cream pages, serif headings', accent: '#5b4636', surface: 'cream', round: 1, shadow: false, head: 'serif' },
  { id: 'navy', name: 'Navy', desc: 'Deep navy in dark mode', accent: '#4a7fd0', surface: 'navy', shadow: false },
  { id: 'black', name: 'Black', desc: 'Black pages in dark mode, grey cards', surface: 'black', shadow: false },
  { id: 'contrast', name: 'High contrast', desc: 'Strong lines, clear text', border: 2, shadow: false, strong: true },
  { id: 'eye', name: 'Eye comfort', desc: 'Warm sepia, more space between lines', accent: '#8a6a4a', surface: 'sepia', shadow: false, leading: 1.65 },
]);
