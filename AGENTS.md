# Facts

Instructions for every AI assistant working here (Claude Code reads this through `CLAUDE.md`).
Replace the placeholders in angle brackets once the app is filled, then delete this line.

<One or two lines: what this app is and who uses it.>

## Public here, private elsewhere

Anything merged here is public. Keep only code, docs, general rules and **made-up** sample data. Never commit
secrets, tokens, personal data, real names or patient details. Private notes belong in the owner's private notes
repo; never copy anything from there into this repo, a PR or an issue (neutral pointers like "ask the owner" are fine).

## Rules that bite

<!-- static{
- A static app: the list is this device's, in IndexedDB (`app/src/local.js`, `local-store.js`); every save goes
  through `local.js`. The rules below on Firestore, roles, claims and Firebase are the cloud app's (`node
  tools/add.mjs cloud --project <id>`, README "Pick a starter").
}static -->
<!-- cloud{ the template's own rule -->
- The template has two flavours (README, "Pick a starter"): a line only the cloud app needs, in a file both have,
  goes between `cloud{` and `}cloud` marks; a static app's own files live in `flavours/static/`.
<!-- }cloud -->
- Every save goes through the write queue (`app/src/cloud.js`); never write to Firestore around it, or sign-out can't
  tell what is unsent.
- Roles come from claims, cached from `members/{uid}`. Bump the doc's `v` on every role change. No email in rules.
- Edit `app/firestore.app.rules` (a module's rules: `app/rules/<module>.rules`), then rebuild `app/firestore.rules`
  with `node tools/modules.mjs`; add a case to `app/test/rules.test.mjs` (a module's: `app/test/rules/<module>.mjs`)
  for every new rule.
- `worker/claims.js` and `worker/custom-token.js` are app-devkit's: never edit them here (CI compares them).
- Shared modules (app-sync, app-update) and app-devkit blocks are pinned to exact versions; bump on purpose, after the
  tests pass. No moving `@v1` pins.
- Every import map name is in `modules.json` once; `node tools/modules.mjs` writes the import map, `tsconfig.json`
  paths, Vite's aliases, module style links, `sw.js`'s SHELL list, the import map's CSP hash and the rules from it.
  Never edit those by hand; run it after changing `modules.json`, adding or removing a file the page loads, or bumping
  a core package (CI runs `--check`). app-sync and app-ui (`@core/ui`, `@core/theme`, `@core/settings`) versions come
  from their `package.json` devDependency tags only; change the kit in app-ui, never here
  ([decision 0011](docs/decisions/0011-ui-kit-served-from-app-ui.md)). Firebase is vendored: bump it with
  `node tools/vendor-firebase.mjs <version>` (never edit `app/public/vendor/`;
  [decision 0007](docs/decisions/0007-vendored-firebase-generated-sw-list.md)).
- New library, own-host sign-in, live smoke test, template updates: go through
  [docs/new-app-checklist.md](docs/new-app-checklist.md). Files and search are modules (`node tools/add.mjs files|search`). `@core/files` `url()` is a page-local `blob:` URL; hand a
  file on with `files.blob(id)`. App-sync bumps: `node tools/update-from-starter.mjs --sync <x.y.z>`.
- Installable, never prompted: keep `app/src/boot.js` (cancels `beforeinstallprompt`). No install buttons.
- The Content-Security-Policy is Report-Only until a live sign-in, sync and update show no reports
  ([decision 0003](docs/decisions/0003-csp-report-only-first.md)); the browser tests already fail on any report.

## Standing criteria

Every change keeps the app:

- **Vite-compatible:** it runs as plain files and builds with Vite (`npm run vite`) with the same browser tests green.
- **Modular:** an optional part is a module the app can add or remove with one command (`node tools/add.mjs`); it
  adds entries to registries (`modules.json`, `app/src/modules.js`, `worker/modules.js`, `app/rules/`, its own CSS)
  rather than code to shared files.
- **Buffet recipes:** each module is a recipe an app picks on its own, with no other module needed, and leaves no
  trace when removed.
- **Fixed at the source (the default):** every fix goes where the part lives unless only this app has it (its own
  screens, wording, data, its collections' rules and tests); an app-only fix says why in the PR. app-sync or app-ui:
  fix, release, then bump the pin here; app-devkit blocks: fix there, then take the new version; recipes, starter
  files, the build (Vite config, `tools/`), `sw.js`, the CSP, worker routes and CI workflows: fix in this template,
  and the app takes it with `node tools/update-from-starter.mjs`. Never patch a shared part inside the app; an urgent
  stopgap goes in only alongside the upstream fix, linked from the PR, and is removed at the bump.

## Checks before merging

```
node .devkit/tools/check.mjs
node tools/modules.mjs --check
node --test 'worker/test/*.test.mjs' 'app/test/*.unit.test.mjs' 'tools/test/*.test.mjs'
npm run rules && npm run e2e
npm run vite && APP_DIR=dist npm run e2e
```

## Working with the owner

- Instructions mostly come from a phone. Work through a request to the end; ask only when a decision is genuinely
  the owner's. When asked to plan, plan and wait.
- Keep each PR small and finished on its own. Start PR titles with the app: "<App>: …".
- Merge your own PRs once the checks pass, then report with the PR link and call `unsubscribe_pr_activity`.
- Keep `NOTES.md` (lasting decisions, how to test) and `STATUS.md` (now, waiting on the owner, next, dated
  decisions) current; a decision that shapes the code gets a record in `docs/decisions/`. Cheap end of session:
  `quick-save`.
- Plain words, short; explain technical terms briefly the first time.
