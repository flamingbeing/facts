# 0011: The UI kit, theme and settings are app-ui, served at an exact version

Status: accepted (2026-10-27). Replaces where 0008 put the kit (`app/public/`); the rest of 0008 and 0010 still holds.

Decision: `@core/ui`, `@core/theme`, `@core/settings`, the looks and the `/kit/` gallery moved, with their history and
tests, into their own repo, [app-ui](https://github.com/flamingbeing/app-ui), served like app-sync from
`https://core.anawj.com/ui/<version>/` (immutable files, CORS for any page). The starter pins one version, named in
three places bumped together: `app/index.html` (the three import map entries, the `<link>`ed `theme/theme.css`,
`ui/ui.css`, `theme/glass.css` and the early `theme/early.js`), the `app-ui` devDependency tag in `package.json`
(what `npm run typecheck` and `tools/sw-files.mjs` read) and `worker/headers.js`'s import map hash.

Why: the second kind of app needs the same parts; a copy per app would drift. One served version per app keeps a
change to the kit a deliberate bump, tested in the app first, like an app-sync bump.

What follows: the kit's own tests (gestures, layout, looks, settings, shell, theme, parts; the gallery's browser
tests) run in app-ui. The starter keeps the browser tests that check the app through its import map (glass, theme,
ui-parts, settings). The service worker keeps every app-ui file the page loads (generated SHELL); its style sheets
are allowed from core.anawj.com in the policy (`style-src`). Kit docs: app-ui's `docs/ui-kit.md`.
