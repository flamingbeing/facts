# 0008: The UI kit (`@core/ui`) and theme (`@core/theme`) grow in the starter; screens one file each

Status: accepted (2026-10-26); where it lives replaced by [0011](0011-ui-kit-served-from-app-ui.md) (app-ui).

Decision: the parts every app draws the same way (sync chip with default state words `LABELS`, sign-in sheet,
conflict "pick one" sheet, update prompt, refused-saves list) are `@core/ui`, and the custom properties plus the
per-device theme (Auto, Light, Dark) and layout (Comfortable, Compact) switch are `@core/theme`. Both are v0,
incubating here: each is its own entry in `app/index.html`'s import map (`./ui/index.js`, `./theme/index.js`), each part
its own file, nothing runs on import, CSS comes with `<link>`, and every part reads only a module's public API handed to
it. They live in `app/public/` (not `app/src/`) so the Vite check and `tools/sw-files.mjs` treat them like the core
entries: external, loaded by their import map URL. They move into app-sync (a file move) once a third app uses them.

The sample screen is rebuilt on the kit: one file per screen in `app/src/screens/` (signed out, no access, not set up,
list, item sheet), each `{ show, hide }` and side-effect-free on import, picked by `app/src/screen-switch.js`.
`app/src/cloud.js` starts the modules and hands their APIs to `app.js`. A new app keeps the wiring, `cloud.js` and the
kit, and replaces only its screens.

New options are off until picked: no stored choice, an unknown value or no storage gives Auto and Comfortable.

Theme engine (26 Oct 2026, ported from logbook's colour engine, logbook itself unchanged): `@core/theme` works out the
light, dark and OLED palettes from one accent and holds every text pair to 4.5:1 and lines and the focus ring to 3:1
(7:1 and 4.5:1 for the High contrast look) by nudging the failing token, for all 8 looks, every ground and any accent
(unit-tested). The allowed values live in one place (`theme/schema.js`); v0's stored `{ theme, layout }` reads as it
did. The palette goes into the page as one constructed stylesheet (`adoptedStyleSheets`), so the Content-Security-Policy
needs no inline style; `theme.css` keeps v0's values for a page without script. Fonts, wallpaper, custom CSS and saved
or shared themes stay out (later, as their own opt-in entries).
