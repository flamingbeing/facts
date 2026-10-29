// Look A, tinted glass: floating glass bars and a pill tab bar tinted with the accent, a serif large title on the
// page, lists as soft inset cards, round ticks, menus that pop up beside the row. Data only (looks.js says what each
// key means); corners scale from the theme's radii, so a Flat or Soft theme still shows through.
/** @type {import('../looks.js').Look} */
export default {
  id: 'a',
  name: 'Tinted glass',
  desc: 'Glass bars tinted with the colour, serif titles, soft cards',
  variants: { header: 'plain', menu: 'popover', glass: 'bars', tick: 'round', tabbar: 'float' },
  tokens: {
    'look-font-head': 'ui-serif, "Iowan Old Style", Georgia, "Times New Roman", serif',
    'title-size': '2.125rem', 'title-weight': '600', 'title-track': '-.01em',
    'bar-line': 'transparent',
    'card-r': 'calc(var(--radius-l) * 1.33)', 'list-inset': 'var(--pad)', 'list-bg': 'var(--surface)',
    'list-edge': 'transparent', 'list-sep': 'color-mix(in srgb, var(--line) 30%, transparent)', 'list-shadow': '0 1px 2px rgb(0 0 0 / .06)',
    'row-weight': '400',
    'control-r': 'calc(var(--radius-l) * 3)', 'pill-r': 'calc(var(--radius-l) * 2.6)',
    'menu-r': 'calc(var(--radius-l) * 1.5)', 'sheet-r': 'calc(var(--radius-l) * 2)',
    'tick-size': '26px', 'tab-active': 'var(--selection)',
    'glass-tint': '7%',
  },
};
