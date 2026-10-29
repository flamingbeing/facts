// Look C, dense and quiet: a plain bar with a hairline, a small bold title, flush lists with inset lines, small round
// ticks, a flat full-width tab bar; glass only on the floating pills (toasts). Data only (looks.js says what each key
// means).
/** @type {import('../looks.js').Look} */
export default {
  id: 'c',
  name: 'Dense and quiet',
  desc: 'Flush lists, small titles, glass only on floating pills',
  variants: { header: 'plain', menu: 'popover', glass: 'pill', tick: 'round', tabbar: 'edge' },
  tokens: {
    'look-font-head': 'inherit',
    'title-size': '1.375rem', 'title-weight': '700', 'title-track': '0',
    'bar-line': 'var(--line)',
    'card-r': '0', 'list-inset': '0', 'list-bg': 'var(--surface)',
    'list-edge': 'var(--line)', 'list-sep': 'color-mix(in srgb, var(--line) 35%, transparent)', 'list-shadow': 'none',
    'row-weight': '400',
    'control-r': 'var(--radius)', 'pill-r': 'calc(var(--radius-l) * 1.2)',
    'menu-r': 'var(--radius-l)', 'sheet-r': 'calc(var(--radius-l) * 1.33)',
    'tick-size': '20px', 'tab-active': 'transparent',
    'glass-tint': '0%',
  },
};
