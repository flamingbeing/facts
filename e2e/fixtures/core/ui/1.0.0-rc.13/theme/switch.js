// The theme switch: labelled selects for this device's look (looks.js), theme, dark style, style (preset), ground,
// density, glass or Solid bars and sheets (with the glass guard's note when it turned glass down), motion (Auto or
// Still), and a colour well for the accent with a reset to the style's own colour (choice.js). lookSwitch is the look
// and density alone, for the gallery.
import { THEMES, DENSITIES, themeChoice, chooseTheme, pickedAccent } from './choice.js';
import { DARK_STYLES, PRESET_IDS, SURFACE_IDS, MATERIALS, MOTIONS } from './schema.js';
import { PRESETS, SURFACES } from './presets.js';
import { LOOKS } from './looks.js';
import { kept } from './guard.js';
import { GRID, SHADES, snap } from './grid.js';

/** @type {Record<string, string>} */
const WORDS = {
  auto: 'Auto', light: 'Light', dark: 'Dark', oled: 'OLED black', regular: 'Regular', comfortable: 'Comfortable', compact: 'Compact', glass: 'Glass', solid: 'Solid', always: 'Glass, even here', still: 'Still', '': "The style's own",
  ...Object.fromEntries(PRESETS.map(p => [p.id, p.name])),
  ...Object.fromEntries(Object.entries(SURFACES).map(([id, s]) => [id, s.label])),
};
// the look picker's words: the looks' names (a's id is also nothing's word, so they stay apart from WORDS)
const LOOK_WORDS = { '': "The app's own", ...Object.fromEntries(LOOKS.map(l => [l.id, l.name])) };

/**
 * @param {'theme' | 'dark' | 'preset' | 'surface' | 'look' | 'density' | 'material' | 'motion'} key @param {string} label
 * @param {readonly string[]} values
 * @param {() => void} after  runs after a pick (the colour well follows the style)
 * @param {Record<string, string>} [words]
 * @returns {HTMLLabelElement}
 */
function picker(key, label, values, after, words = WORDS) {
  const select = document.createElement('select');
  select.id = `${key}-pick`;
  select.append(...values.map(v => new Option(words[v] ?? v, v)));
  select.value = themeChoice()[key];
  select.addEventListener('change', () => { chooseTheme({ [key]: select.value }); after(); });
  const wrap = document.createElement('label');
  wrap.append(`${label} `, select);
  return wrap;
}

// The accent: the phone's own colour picker, offered the grid's middle shade of each hue; Reset goes back to the
// style's (or the app's) colour.
function accentPicker() {
  const well = document.createElement('input');
  well.type = 'color';
  well.id = 'accent-pick';
  const list = document.createElement('datalist');
  list.id = 'accent-colours';
  list.append(...GRID.filter(x => x.hue !== 'Grey' && x.shade === SHADES - 2).map(x => new Option(x.name, x.c)));
  well.setAttribute('list', list.id);
  const reset = document.createElement('button');
  reset.type = 'button';
  reset.textContent = 'Reset colour';
  const sync = () => { well.value = pickedAccent(); reset.hidden = !themeChoice().accent; };
  well.addEventListener('change', () => { chooseTheme({ accent: snap(well.value) ?? '' }); sync(); });
  reset.addEventListener('click', () => { chooseTheme({ accent: '' }); sync(); well.focus(); });
  sync();
  const wrap = document.createElement('label');
  wrap.append('Colour ', well, list);
  return { parts: [wrap, reset], sync };
}

/**
 * @param {HTMLElement} host  the switch is added here
 * @returns {() => void} stop: removes it
 */
export function themeSwitch(host) {
  const box = document.createElement('div');
  box.className = 'row theme-switch';
  const accent = accentPicker();
  const note = guardNote();
  const sync = () => { accent.sync(); note.sync(); };
  box.append(
    lookPicker(sync), picker('theme', 'Theme', THEMES, sync), picker('dark', 'Dark style', DARK_STYLES, sync),
    picker('preset', 'Style', PRESET_IDS, sync), picker('surface', 'Ground', SURFACE_IDS, sync),
    ...accent.parts, picker('density', 'Density', DENSITIES, sync),
    picker('material', 'Bars and sheets', MATERIALS, sync), note.part, picker('motion', 'Motion', MOTIONS, sync),
  );
  host.append(box);
  return () => box.remove();
}

/**
 * The look and density pickers alone (the gallery's switcher).
 * @param {HTMLElement} host @param {() => void} [after]  runs after a pick
 * @returns {() => void} stop: removes them
 */
export function lookSwitch(host, after = () => {}) {
  const box = document.createElement('div');
  box.className = 'row theme-switch';
  box.append(lookPicker(after), picker('density', 'Density', DENSITIES, after));
  host.append(box);
  return () => box.remove();
}

/** @param {() => void} after */
const lookPicker = after => picker('look', 'Look', ['', ...LOOKS.map(l => l.id)], after, LOOK_WORDS);

// why the bars are solid when Glass is picked: the glass guard turned it down on this device (guard.js)
function guardNote() {
  const part = document.createElement('small');
  part.className = 'guard-note';
  part.setAttribute('role', 'status');
  const sync = () => {
    const why = kept()?.solid && themeChoice().material === 'glass' ? kept()?.why : '';
    part.textContent = why === 'memory' ? 'Solid on this device: it has little memory. Pick "Glass, even here" to keep glass.'
      : why === 'frames' ? 'Solid on this device: scrolling was slow with glass. Pick "Glass, even here" to keep glass.' : '';
    part.hidden = !why;
  };
  sync();
  return { part, sync };
}
