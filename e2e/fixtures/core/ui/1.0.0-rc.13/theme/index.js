// @core/theme (app-ui, with @core/ui): this device's theme choice (theme, dark style, look,
// accent, ground, density, glass or Solid), the looks (looks.js: token sets + variants), the glass guard, the palettes
// worked out from it with a contrast floor, the switch, the screen-switch motion, and theme/theme.css's custom properties and theme/glass.css's glass (loaded with <link>; the
// palette replaces their values once applyTheme runs).
// Nothing runs on import: the page calls applyTheme() once, as early as it can.
export { THEMES, LAYOUTS, DENSITIES, themeChoice, applyTheme, chooseTheme, previewTheme, shownLook } from './choice.js';
export { themeSwitch, lookSwitch } from './switch.js';
export { LOOKS, LOOK_IDS, VARIANTS, DEFAULT_LOOK, lookOf } from './looks.js';
export { verdict as glassVerdict, keep as keepGlassVerdict } from './guard.js';
export { DARK_STYLES, PRESET_IDS, SURFACE_IDS, MATERIALS, MOTIONS, cleanChoice } from './schema.js';
export { PRESETS, SURFACES } from './presets.js';
export { palettes, paletteCss, glassTokens, DEFAULT_ACCENT } from './palette-css.js';
export { contrast, checkPalette, glassStrengths } from './colour.js';
export { viewSwitch } from './motion.js';
