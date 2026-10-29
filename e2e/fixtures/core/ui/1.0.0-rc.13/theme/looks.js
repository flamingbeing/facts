// The looks a device (or the app) can pick: each is a token set plus a few named variants, data only, one file in
// looks/ per look. palette-css.js puts the tokens on :root; choice.js shows the variants as data-* marks on <html>
// (data-header, data-menu, data-glass, data-tick, data-tabbar) that ui.css, gestures.css and glass.css style from.
// Adding a look: a file in looks/, one line in LOOKS below, an entry in the gallery (docs/ui-kit.md). Pure, no DOM.
import a from './looks/a.js';
import b from './looks/b.js';
import c from './looks/c.js';
import d from './looks/d.js';

/**
 * header: band (the large title on a band of the accent) | plain (on the page) | slim (no large title: the bar always
 *   shows the name)
 * menu: popover (the hold menu beside its row) | sheet (from the bottom, on phones)
 * glass: bars (all floating chrome) | pill (only the floating pills: action bar, toasts, a floating tab bar) | none
 * tick: round | square (select mode's ticks)
 * tabbar: float (a pill over the content) | edge (full width along the bottom)
 * @typedef {{ header: 'band' | 'plain' | 'slim', menu: 'popover' | 'sheet', glass: 'bars' | 'pill' | 'none',
 *   tick: 'round' | 'square', tabbar: 'float' | 'edge' }} Variants
 * tokens: custom properties (without the --) every look sets, the same keys in each: look-font-head, title-size,
 * title-weight, title-track, bar-line, card-r, list-inset, list-bg (the lists' ground), list-edge,
 * list-sep, list-shadow, row-weight, control-r, pill-r,
 * menu-r, sheet-r, tick-size, tab-active, glass-tint (how much accent the glass takes, a percentage)
 * @typedef {{ id: string, name: string, desc: string, variants: Variants, tokens: Record<string, string> }} Look
 */

/** @type {readonly Look[]} */
export const LOOKS = Object.freeze([a, b, c, d]);
export const LOOK_IDS = Object.freeze(LOOKS.map(l => l.id));
// what each variant may be, first = what a look that names none gets
export const VARIANTS = Object.freeze({
  header: ['plain', 'band', 'slim'], menu: ['popover', 'sheet'], glass: ['bars', 'pill', 'none'], tick: ['round', 'square'],
  tabbar: ['float', 'edge'],
});
// the look an app gets when it names none (applyTheme({ look }))
export const DEFAULT_LOOK = 'a';

/** @param {string} [id] @param {string} [appLook] @returns {Look}  the look picked, else the app's, else A */
export const lookOf = (id, appLook) => LOOKS.find(l => l.id === id) ?? LOOKS.find(l => l.id === appLook)
  ?? /** @type {Look} */ (LOOKS.find(l => l.id === DEFAULT_LOOK));
