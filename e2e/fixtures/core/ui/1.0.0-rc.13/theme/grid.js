// The accent picker's colours (ported from logbook's colour-grid.js): 12 hues x 8 shades (OKLCH lightness 0.96 to 0.35,
// as much colour as fits) and a grey row, written out once so every device offers the same ones, and snap(), which
// rounds a colour to 6 bits a channel (at most 2/255 off, too little to see) so a picked colour is stored the same
// everywhere. Pure, no DOM.
import { cleanHex } from './colour.js';

export const HUES = Object.freeze(['Red', 'Orange', 'Amber', 'Yellow', 'Lime', 'Green', 'Teal', 'Cyan', 'Blue', 'Indigo', 'Purple', 'Pink', 'Grey']);
export const SHADES = 8;
const PACKED = 'ffefebffd2caffaaa2ff796dff2428d70018a20010710008ffefe3ffd2b6ffae79fb8200d26d00aa59008241005d2d00ffefd7fbdba2efba59db9a00b68200966900714d004d3500'
  + 'f7f3d2ebdfa2d7c659beaa009e8e00827100615500453d00ebf7d7ceebaeaad27586be006d9e005982004161002d4100dffbe3baefc286db9224c65900aa45008a35006924004918'
  + 'd2fbf3a2efe345dfca00c2ae00a29200867500655900453ddbf7ff9eebff41dbf700badb009eb6007d9600617100414debf3ffcadfff9ec6ff6daaff358aff0069e70051ae00357d'
  + 'efefffd7dbffb6beff969eff7975ff6149fb4931ca311c92f7efffe7d7ffd7b2ffc286ffae55ff962de37114b2510082ffebf3ffcee3ffa2ceff69baef24a2ca00869a00656d0045'
  + 'ffffffe7e7e7cececeaaaaaa8686866161613d3d3d000000';

/** @typedef {{ c: string, name: string, hue: string, shade: number }} Cell */
// every cell in order (row by row, lightest first): its colour and the name a screen reader says
/** @type {readonly Cell[]} */
export const GRID = Object.freeze(Array.from({ length: PACKED.length / 6 }, (_, i) => {
  const hue = HUES[Math.floor(i / SHADES)], shade = (i % SHADES) + 1;
  const name = hue === 'Grey' && shade === 1 ? 'White' : hue === 'Grey' && shade === SHADES ? 'Black' : `${hue}, shade ${shade}`;
  return { c: '#' + PACKED.slice(i * 6, i * 6 + 6), name, hue, shade };
}));
/** @param {unknown} c @returns {number}  its place in GRID, or -1 */
export const gridIndex = c => GRID.findIndex(x => x.c === cleanHex(c));

/** @param {number} v */
const level = v => Math.round(v * 63 / 255);
/** @param {unknown} c @returns {string | null}  the colour at 6 bits a channel, or null if it is not a hex colour */
export const snap = c => {
  const x = cleanHex(c);
  return x && '#' + [1, 3, 5].map(i => Math.round(level(parseInt(x.slice(i, i + 2), 16)) * 255 / 63).toString(16).padStart(2, '0')).join('');
};
