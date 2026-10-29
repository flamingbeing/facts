# New-app checklist

What bit earlier apps made from this template, as steps. The README says how to start and fill an app; this page is
the list to go through around that, and again whenever an app adds a library or updates from the template.

## 1. A machine ready to test

- [ ] `. tools/dev-setup.sh` (or `bash tools/dev-setup.sh` and paste the two `export` lines it prints). It copies
  app-devkit at the version `checks.yml` pins into `.devkit/`, runs `npm ci`, sets `METADATA_SERVER_DETECTION=none`
  (firebase-tools stops waiting for a cloud metadata server) and `PW_CHROMIUM` when a Chromium is already installed at
  `/opt/pw-browsers/chromium` (cloud containers; the pinned Playwright's own download may be missing there).
- [ ] Java on the PATH for `npm run rules` and `npm run e2e` (the Firestore emulator).
- [ ] The secret scan: `.gitleaks.toml` allows the Firebase web config in `app/src/config.js` (a public client id; the
  rules decide who sees what) and the vendored Firebase hash list. Anything else key-shaped is a finding, even a fake
  one in a test: build fake keys at run time instead of writing them out.

## 2. Sign-in on the app's own address

`fill.mjs` sets `authDomain` to the app's host, so the sign-in popup never leaves the app's address. That needs three
things outside the repo, and one in it; miss one and sign-in hangs or fails with a redirect or frame error.

- [ ] **Authorized domain:** the host in Firebase console, Authentication, Settings, Authorized domains.
- [ ] **OAuth client:** in the Google Cloud console's Credentials, the project's web OAuth client gets the redirect URI
  `https://<host>/__/auth/handler` and the JavaScript origin `https://<host>`. If the web API key is restricted to
  HTTP referrers, add `https://<host>/*` there too.
- [ ] **Worker framing (in the repo):** the Worker serves Firebase's helper pages (`/__/auth/*`) from the project's
  Firebase address and lets this same address frame them (`frame-ancestors 'self'`, `X-Frame-Options: SAMEORIGIN`);
  every other page stays unframeable. The template does this (`worker/sites.js`, `worker/headers.js` `framedBySelf`,
  tested in `worker/test/sites.test.mjs`); keep it when changing either file.

## 3. Live smoke test, fully automated

No step of it is a manual check: after each deploy `live-smoke.yml` signs the test user in on the live site.

- [ ] A test user (email and password) made by a script or the setup job, its credentials in the repo secrets
  `<NAME>_TEST_EMAIL` and `<NAME>_TEST_PASSWORD`.
- [ ] Give it a `members/{uid}` doc with role `member` when the app should be checked signed in with a role; the
  template's own spec expects no role (it sees no list), so change `e2e-live/signin.live.spec.mjs` with it.
- [ ] `live-smoke.yml` at app-devkit v1.10.3 or later: earlier versions send no `Referer`, so a web key restricted to the
  site's referrers refuses the sign-in and the test fails on every run. The update path below lists stale pins.

## 4. Adding a library loaded on demand

For a library a screen imports only when it is opened (`await import('<name>')`), on top of the README's "Adding an
outside package":

- [ ] **Import map:** its entry in `modules.json`, then `node tools/modules.mjs`: it writes the import map and its
  hash in `worker/headers.js` (the import map is the page's one inline script, allowed by that hash), and `sw.js`'s
  list, so the vendored file is cached for offline (CI's `--check` fails until then).
- [ ] **Vite:** add its name to the `external` test in `vite.config.mjs` when the page loads it through the import map,
  so the build leaves the `import()` alone instead of bundling or failing on it.
- [ ] A browser test that opens the screen offline after one online visit.

## 5. Things that look like one thing and are another

- [ ] Photos or files: `node tools/add.mjs files` first, then make the R2 bucket (its NEEDS-YOU line). `@core/files` `url(id)` returns a `blob:` URL made in this page: fine for an `<img>`, gone after a reload and
  useless anywhere else. To send, save or hand a file on, use `files.blob(id)`.
- [ ] Docs are checked too: the devkit proofreader checks every link and image (`![..](..)`) in Markdown points at a
  file that exists. Run `node .devkit/tools/proofread.mjs` before pushing docs.

## 6. Staying current with the template

An app made with "Use this template" shares no history with it, so the update is a three-way merge per file from the
template commit in `.starter.json`, not a `git merge`; the app's history is never rewritten.

- [ ] `node tools/update-from-starter.mjs --dry-run` lists what would change (`--find-base` when `.starter.json` names no
  `commit`: it picks the template commit closest to the app); without `--dry-run` it brings it in,
  leaves conflicts as `<<<<<<<` markers (listed at the end, exit code 1), regenerates the lock, `sw.js`'s list and the
  import-map hash, and moves `.starter.json`'s `commit`. An app without the script runs the template's copy:
  `node <template checkout>/tools/update-from-starter.mjs --dir . --from <template checkout>`.
- [ ] Files the app owns: list them in `.starter.json` as `"update": { "ignore": ["<glob>"] }`; a file the app moved:
  `"rename": { "<template path>": "<app path>" }`. `STATUS.md`, `NOTES.md`, `app/src/config.js` and the lock are
  never touched.
- [ ] **app-sync bump:** `node tools/update-from-starter.mjs --sync <x.y.z>` changes both names (the import map and the
  `app-sync` devDependency), then the lock, `sw.js`'s list and the hash, in one go.
- [ ] **app-devkit pins:** every run lists the workflow pins older than the template's or the newest app-devkit tag.
  Bump them on purpose, after the tests pass.
- [ ] `node tools/update-from-starter.mjs --behind <n>` prints how far behind the app is and exits 1 when more than
  `n` template commits behind. The weekly workflow `.github/workflows/starter-behind.yml` runs it in every app and
  warns (never fails) past `BEHIND` commits, with the stale app-devkit pins.
- [ ] Then the README's tests, and one PR.

## 7. The page layout is the kit's shell

The sample page is app-ui's shell (`.ui-shell`): a bar with the menu button, a phone tab bar over swipeable tab pages, a
side bar from 600 px, and the phone drawer. It is wired in `app/src/shell.js` (`startGestures`, `adaptiveShell`) and
`app/index.html`; the Settings page is `settingsScreen` with `about: { name, update }` (no hand-made dialog, no
`updatePrompt`). The options it lists are `SETTING_SECTIONS` in `app/src/options.js`.

- [ ] A new page: a `<section class="ui-screen ui-tab-page" id="x-page" hidden>` in `main.ui-screens` (with an
  `h1.ui-large-title`), a `<button class="ui-tab" data-tab-page="#x-page">` in `nav.ui-tabbar` (optional
  `span.ui-tab-icon`) and a `ui-side-link` for it in `nav#side`. Swipe and the bar title follow by themselves; the e2e
  `openSettings` / `openItems` helpers in `e2e/fixtures.mjs` show how a test reaches a page.
- [ ] The shell is the files `app/index.html`, `app/src/shell.js`, `app/public/app.css` and `options.js`; take template
  changes to them with `tools/update-from-starter.mjs` (section 6), not by hand.

