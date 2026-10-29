// Look B, colour band: a solid band of the accent behind a heavy large title, rounded at the bottom; no glass; big
// soft cards without row lines; square ticks; a full-width tab bar; the hold menu comes up as a sheet from the bottom.
// Data only (looks.js says what each key means).
/** @type {import('../looks.js').Look} */
export default {
  id: 'b',
  name: 'Colour band',
  desc: 'A band of the colour behind a bold title, solid bars, menus as sheets',
  variants: { header: 'band', menu: 'sheet', glass: 'none', tick: 'square', tabbar: 'edge' },
  tokens: {
    'look-font-head': '"Avenir Next", "Segoe UI Variable Display", "Segoe UI", Roboto, system-ui, sans-serif',
    'title-size': '2.5rem', 'title-weight': '800', 'title-track': '-.02em',
    'bar-line': 'transparent',
    'card-r': 'calc(var(--radius-l) * 1.85)', 'list-inset': 'var(--pad)', 'list-bg': 'var(--surface)',
    'list-edge': 'transparent', 'list-sep': 'transparent', 'list-shadow': '0 1px 3px rgb(0 0 0 / .07)',
    'row-weight': '600',
    'control-r': 'calc(var(--radius) * 2.2)', 'pill-r': 'calc(var(--radius-l) * 1.85)',
    'menu-r': 'calc(var(--radius-l) * 2.33)', 'sheet-r': 'calc(var(--radius-l) * 2.66)',
    'tick-size': '28px', 'tab-active': 'var(--selection)',
    'glass-tint': '0%',
  },
};
