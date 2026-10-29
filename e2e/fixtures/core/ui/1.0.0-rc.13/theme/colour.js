// Colour maths for @core/theme (ported from logbook's colors.js): hex, WCAG contrast, and the light, dark and OLED
// palettes worked out from one accent so text, buttons and lines stay readable whatever is picked. Pure, no DOM.
//
// Light: the accent is darkened until it reads as text on white (4.5:1), white text on it. Dark and OLED: neutral
// greys, near-white text, the accent lightened until it reaches 7:1 on the cards, dark text on accent buttons.
// Last, floor() nudges any token that still misses its pair (a pale tint, a strong-contrast look) until it passes.

const HEX = /^#[0-9a-f]{6}$/i;
/** @param {unknown} c @returns {string | null}  a six-digit hex colour, lower case, or null */
export const cleanHex = c => (HEX.test(String(c ?? '')) ? String(c).toLowerCase() : null);

/** @param {string} h @returns {number[]} */
const rgb = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
/** @param {number[]} a @returns {string} */
const hex = a => '#' + a.map(v => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');
/** @param {string} a @param {string} b @param {number} t @returns {string}  t of the way from a to b */
export const mix = (a, b, t) => { const x = rgb(a), y = rgb(b); return hex(x.map((v, i) => v + (y[i] - v) * t)); };
/** @param {number} v */
const lin = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
/** @param {string} h @returns {number}  WCAG relative luminance */
export const luminance = h => { const [r, g, b] = rgb(h).map(lin); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
/** @param {string} a @param {string} b @returns {number}  WCAG contrast ratio, 1 to 21 */
export const contrast = (a, b) => { const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };

// HSL, so lightening keeps the hue vivid (mixing with white washes it out to grey)
/** @param {string} h @returns {[number, number, number]} */
const toHsl = h => {
  const [r, g, b] = rgb(h).map(v => v / 255), mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn;
  if (!d) return [0, 0, l];
  const s = d / (1 - Math.abs(2 * l - 1));
  const hh = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [(hh * 60 + 360) % 360, s, l];
};
/** @param {[number, number, number]} hsl @returns {string} */
const fromHsl = ([hh, s, l]) => {
  const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs(((hh / 60) % 2) - 1)), m = l - c / 2;
  const [r, g, b] = hh < 60 ? [c, x, 0] : hh < 120 ? [x, c, 0] : hh < 180 ? [0, c, x] : hh < 240 ? [0, x, c] : hh < 300 ? [x, 0, c] : [c, 0, x];
  return hex([r + m, g + m, b + m].map(v => v * 255));
};

/**
 * The colour, lighter or darker in small steps until it reaches `ratio` against every colour in `on` (lighter when
 * the first of them is dark). Ends at white or black if nothing short of that passes.
 * @param {string} c @param {string[]} on @param {number} ratio @returns {string}
 */
export function nudge(c, on, ratio) {
  const dir = luminance(on[0]) < 0.18 ? 1 : -1;
  const worst = (/** @type {string} */ x) => Math.min(...on.map(b => contrast(x, b)));
  let [hh, s, l] = toHsl(c), x = c;
  if (dir > 0 && s > 0.15) s = Math.max(s, 0.55);   // a dark, muted pick still reads as a colour when lightened
  for (let i = 0; i < 70 && worst(x) < ratio; i++) { l = Math.max(0, Math.min(1, l + dir * 0.015)); x = fromHsl([hh, s, l]); }
  return worst(x) < ratio ? (dir > 0 ? '#ffffff' : '#000000') : x;
}

/** @typedef {Record<string, string>} Palette  token name (no leading --) -> hex */

const STATUS = { light: { danger: '#b3261e', ok: '#197934', warn: '#8a5a00' }, dark: { danger: '#ff8a80', ok: '#74dd90', warn: '#f3c46e' } };

/** @param {string} accent @returns {Palette} */
export function lightPalette(accent) {
  const a = nudge(accent, ['#ffffff'], 4.5);
  return {
    bg: mix('#f5f5f7', a, 0.03), surface: '#ffffff', text: '#1d1d1f', muted: '#5f6368', line: '#8a8a91',
    accent: a, 'on-accent': '#ffffff', ...STATUS.light, selection: mix(a, '#ffffff', 0.8), band: a, 'on-band': '#ffffff',
  };
}

/** @param {string} accent @param {boolean} [oled]  pure black pages and cards @returns {Palette} */
export function darkPalette(accent, oled = false) {
  const surface = oled ? '#000000' : '#2c2c2e';
  const a = nudge(accent, [surface], 7);
  return {
    bg: oled ? '#000000' : '#1c1c1e', surface, text: '#f2f2f7', muted: '#b8bcc4', line: oled ? '#7c7c84' : '#8e8e93',
    accent: a, 'on-accent': oled ? '#000000' : '#111113', ...STATUS.dark, selection: mix(surface, a, 0.35),
    // (a band of colour behind a title: the accent deepened under white text, not the pale accent with dark text)
    band: nudge(a, ['#ffffff'], 4.5), 'on-band': '#ffffff',
  };
}

// The pairs every palette must pass: [token, on these, ratio]. Text 4.5:1 (7:1 when strong), lines and the focus ring
// 3:1 (4.5:1 when strong) as WCAG asks of controls; on-accent / on-fill against their own fill; the selection colour
// (selected text's highlight, and the ground of a current tab, sidebar item or key) against the text, muted, link and
// danger colours drawn on it.
/** @param {boolean} strong @returns {[string, string[], number][]} */
export const pairs = strong => {
  const t = strong ? 7 : 4.5, l = strong ? 4.5 : 3;
  return [
    ['text', ['bg', 'surface'], t], ['muted', ['bg', 'surface'], t], ['link', ['bg', 'surface'], 4.5],
    ['danger', ['bg', 'surface'], 4.5], ['ok', ['bg', 'surface'], 4.5], ['warn', ['bg', 'surface'], 4.5],
    ['line', ['bg', 'surface'], l], ['focus', ['bg', 'surface'], l],
    ['on-accent', ['accent'], 4.5], ['on-fill', ['fill'], 4.5], ['on-band', ['band'], 4.5], ['selection', ['text', 'muted', 'link', 'danger'], 4.5],
  ];
};

/**
 * The palette with its role tokens filled in (fill, on-fill, link, focus, band, on-band follow the accent unless set)
 * and every pair brought up to its floor: the token on the left is nudged (never the ground it sits on).
 * @param {Palette} p @param {{ strong?: boolean }} [opts] @returns {Palette}
 */
export function floor(p, { strong = false } = {}) {
  /** @type {Palette} */
  const out = { fill: p.accent, 'on-fill': p['on-accent'], link: p.accent, focus: p.accent, band: p.accent, 'on-band': p['on-accent'], ...p };
  for (const [fg, on, ratio] of pairs(strong)) {
    const grounds = on.map(k => out[k]);
    if (Math.min(...grounds.map(b => contrast(out[fg], b))) < ratio) out[fg] = nudge(out[fg], grounds, ratio);
  }
  return out;
}

/**
 * Each pair that misses its floor, as "token on ground: ratio:1 (needs n:1)" lines (empty = all pass).
 * @param {Palette} p @param {{ strong?: boolean }} [opts] @returns {string[]}
 */
export function checkPalette(p, { strong = false } = {}) {
  return pairs(strong).flatMap(([fg, on, need]) => on.map(bg => [fg, bg, need, contrast(p[fg], p[bg])]))
    .filter(([, , need, ratio]) => ratio < need)
    .map(([fg, bg, need, ratio]) => `${fg} on ${bg}: ${Number(ratio).toFixed(2)}:1 (needs ${need}:1)`);
}

// Glass (glass.css): floating bars, toasts and sheets are the card colour laid over whatever scrolls under them, so
// text on glass needs the card colour strong enough that every pair still passes over every colour that can show
// through (ported from logbook's frostAlpha). The blur spreads text into its ground, so a text sample is half ink.
const INK_SPREAD = 0.5;
// theme.css --backdrop: black at 40%, the shade a sheet (a modal dialog) sits over
export const BACKDROP = 0.4;

/**
 * The colours that can show through glass: the page and card grounds, the fill (a filled button), and text as the blur
 * spreads it; `shaded` puts them under the backdrop first (a sheet).
 * @param {Palette} p @param {boolean} [shaded] @returns {string[]}
 */
export function glassSamples(p, shaded = false) {
  const under = [p.bg, p.surface, p.fill ?? p.accent, mix(p.bg, p.text, INK_SPREAD), mix(p.surface, p.text, INK_SPREAD)];
  return shaded ? under.map(c => mix(c, '#000000', BACKDROP)) : under;
}

/**
 * How much card colour the glass needs (0 to 1, in 0.01 steps, never under `least`): the lowest strength at which
 * every pair that sits on the page or a card (text, status, lines: pairs) reaches its floor over every sample. Always
 * reached by 1 (the solid card colour), which floor() already brought up to every pair. linesOnly: only lines and the
 * focus ring count (glass that carries no text).
 * @param {string[]} samples @param {Palette} p @param {{ strong?: boolean, least?: number, linesOnly?: boolean }} [opts]
 * @returns {number}
 */
export function frostAlpha(samples, p, { strong = false, least = 0, linesOnly = false } = {}) {
  const onCards = pairs(strong).filter(([fg, on]) => on.includes('surface') && (!linesOnly || fg === 'line' || fg === 'focus'));
  const ok = (/** @type {number} */ a) => samples.every(s => {
    const glass = mix(s, p.surface, a);
    return onCards.every(([fg, , ratio]) => contrast(p[fg], glass) >= ratio - 1e-9);
  });
  for (let i = Math.ceil(least * 100); i < 100; i++) if (ok(i / 100)) return i / 100;
  return 1;
}

/**
 * The glass strengths for a palette: glass (bars, toasts), thick (sheets, over the backdrop) and clear (icon-only
 * controls: lines and the focus ring only, no text).
 * @param {Palette} p @param {{ strong?: boolean }} [opts] @returns {{ glass: number, thick: number, clear: number }}
 */
export function glassStrengths(p, { strong = false } = {}) {
  return {
    glass: frostAlpha(glassSamples(p), p, { strong, least: 0.86 }),
    thick: frostAlpha(glassSamples(p, true), p, { strong, least: 0.88 }),
    clear: frostAlpha(glassSamples(p), p, { strong, least: 0.5, linesOnly: true }),
  };
}
