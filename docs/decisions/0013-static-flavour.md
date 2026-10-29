# 0013: A static app is the template rendered as a flavour, and add.mjs cloud turns it into the cloud app

Status: accepted (2026-10-27).

Decision: an app with no sign-in, whose data stays on one device, is made from the same template as the cloud app,
rendered as the `static` flavour: `node tools/fill.mjs ... --static` (no `--project`) runs `tools/flavour.mjs`, which
takes out the paths `flavours/static.json` lists (cloud.js, roles, the rules, vendored Firebase, the sync and rules
tests, the live smoke test), the lines between `cloud{` and `}cloud` marks in any text file, the Firebase import map
entries and `scripts.rules`, and puts in `flavours/static/`'s files at the same paths: `app/src/local-store.js` (a
module named `sync` over app-sync's IndexedDB store, `@core/store`, so `@core/settings` and the kit's parts take it as
they take the engine), `local.js` (the same `createApp` runner with that module, settings and update), its own
`app.js`, `options.js`, `config.js` shape, e2e spec and Playwright config (no emulators). `.starter.json` records
`"flavour": "static"`. The render is pure, so `update-from-starter.mjs` renders both template commits and the app
takes only the changes to the files it has; `node tools/add.mjs cloud --project <id>` runs the same update from the
static render to the cloud tree (unchanged static files go, changed ones stay and are listed, the cloud files come
in) and then fill sets the project.

Why: a second template (or a fork) drifts from the first within weeks, and every fix would be made twice. Marks in
the template keep one copy of every shared file: the screens, the kit, the Worker, the PWA, the tests and CI. Starting
static and adding the cloud later is a merge the tools already know (update-from-starter's three-way merge), not a
rewrite.

What follows: a cloud-only line in a shared file goes inside marks (`// cloud{` ... `// }cloud`, `# cloud{`,
`<!-- cloud{ -->`), a static-only one in a static block; the marks stay in cloud apps, where they show what a static
app does differently. CI's `static` and `static-vite` jobs fill a scratch copy as a static app and run its whole
suite, and `tools/test/flavour.test.mjs` checks the spec against the template, a static update and the move to the
cloud. The files module needs the cloud (its Worker routes and rules), so a static app refuses it. Moving to the cloud
does not upload the device's list yet: it stays in the browser's `<name>:_` database until an app adds an import step.
