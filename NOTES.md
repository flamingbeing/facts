# Notes

Lasting decisions and how to test. Shaping decisions have their own records in [docs/decisions/](docs/decisions/).

## How to test

See README, "Tests". The browser tests use one shared list (`spaces/_/items`), so each test uses its own made-up
accounts and item texts and checks only those; they run side by side.

## UI kit gestures and the `/kit/` gallery (app-ui)

The kit, its gallery and their tests live in [app-ui](https://github.com/flamingbeing/app-ui) since 1.0.0-rc.1
([decision 0011](docs/decisions/0011-ui-kit-served-from-app-ui.md)); this app pins one version. In short:

`@core/ui` has touch gestures (hold menu, select mode, sheets with detents, pushed screens with edge-swipe back,
shrinking tab bar, collapsing large title), each started only where its markup is. The gallery `/kit/` shows them all
on made-up data, signed out; its tests are listed in app-ui's [kit-tests.md](https://github.com/flamingbeing/app-ui/blob/main/docs/kit-tests.md) and run at 390, 820 and
1280 px. Stage notes: [ui-kit-progress.md](https://github.com/flamingbeing/app-ui/blob/main/docs/ui-kit-progress.md). Port rules: hold 500 ms within 10 px, the
lift's click swallowed; no gesture from fields, dialogs, sideways scrollers, drag handles or screen edges; the tab bar
never moves with a swipe; Still (this device) or Reduce Motion turns motion off. Layout parts (grid, stack, split,
toolbar, segmented, stepper) and the opt-in extra-dense level (never under 24 px) are on `/kit/dense/`; rules in
[ui-kit.md](https://github.com/flamingbeing/app-ui/blob/main/docs/ui-kit.md#layout-parts-and-extra-dense).

## The shell (app-ui 1.0.0-rc.13)

The sample page runs on the kit's shell (`.ui-shell`, tab pages, side bar, drawer) and `settingsScreen`; see the
new-app checklist, section 7. Known gaps, all for app-ui: the bar's start/end layout (`.bar-side`, `.bar-end`) is
hand-written in `app.css`; `adaptiveShell` needs a `.ui-pane-detail` even in an app with no detail pane (a hidden
placeholder here); the kit's current-tab colour is 4.1:1 in the navy look (`app.css` overrides it with `--link`); the
kit's bar is clear until the page scrolls, so the glass tests set `.is-collapsed`.

## Startup (cloud app)

What the page does before the list is there, measured at 4x CPU slowdown on a signed-in reload (hermetic core files, so
network latency is not in it): the shell starts first (tabs and menu work at once); the sign-in screen is shown only once
Firebase has restored the sign-in and says nobody is signed in (it used to flash on every start); a device that ended
signed in paints the list as last drawn, read-only, until the real list replaces it (`src/hint.js`, a yes/no and at most
100 rows, cleared whenever the sign-in says signed out); `modules.json` entries marked `"preload"` get a
`<link rel="modulepreload">` each (written by `node tools/modules.mjs`). Not here: lazy sheets (the starter has none;
an app with many gets them from its own `list.js`) and the Vite bundle (`npm run vite`, still opt-in).

## Later

- Restore from the bin (the bin entries keep the deleted version in `data`).
- Multi-group, email-link and passcode sign-in (app-devkit `custom-token.js`).
- Enforce the Content-Security-Policy (decision 0003).

## Held conflicts (app-sync 0.6.3)

`cloud.js` sets `backend.held` and `edits: '_edits'`: a same-field clash is held on the phone that made the save and
shown there as a side-by-side sheet (both versions, when in SGT, who and device); other phones see nothing to answer.
Choices are `app.resolve(c, 'mine' | 'theirs' | { field: … })`. Rules allow the `_edits` map on items.

## Files formats (`@core/files` v0, decision 0009; the `files` module, `node tools/add.mjs files`)

Kept on the device, so a change needs a new version and a test that the old one reads as empty (`files.unit.test.mjs`).

- Upload queue, `ctx.storage()` key `<name>:files/queue`: `{ v: 1, uid, jobs: Job[] }`, Job `{ id, scope, op: 'put' |
  'delete', parts: ['file', 'thumb'?], tries, at, stuck?, rec? }` (`app/public/files/queue.js` once the module is added). Another `v` reads as
  empty; an empty queue removes the key.
- Device cache, IndexedDB database `<name>-files`, store `blobs`: one Blob per key `<scope>/<id>` and
  `<scope>/<id>.thumb` (`app/public/files/cache.js`). Sign-out keeps both; a switch to another account wipes both.
- Worker: R2 bucket `<name>-files` bound as `FILES`, object key `<scope>/<id>[.thumb]` (`worker/files.js`).

## Settings (`@core/settings`)

`app/src/options.js` lists every option the app allows (scope `device` or `account`; new ones are off); nothing else can
be saved. Where values live (change these only with a migration; `settings.unit.test.mjs` checks the shapes):

- Device values: `ctx.storage('settings')` key `device` = `{ v: 1, values: { <key>: value } }` (stored as
  `settings:settings/device` in localStorage). Kept at sign-out, wiped on an account switch or forget.
- Account values: one sync record per person in the `settings` collection (`spaces/_/settings/<uid>`): one field per
  account option plus `profile`; `null` forgets a value. The local copy is `settings/account` = `{ uid, rec }`, used
  only while `uid` is the signed-in account.
- Rules: only the person writes their own doc (field list in `firestore.app.rules`: add each new account option there
  and in `options.js`); the group can read it, because a list listen cannot be proven to ask for one doc. Keep secrets
  out of options.
- The settings file (`kind: core-settings`, `version`) carries account options only.
- Decision: `@core/theme`'s per-device choice can later move onto settings (device scope, same storage shape); today it
  keeps its own storage, so adopting settings changes no theme file.

## Search (`@core/search`)

`createSearch({ fields, boost, store, operators, newest })` (`app/public/search/`) is an in-memory index over vendored
MiniSearch 7.2.0 (`app/public/vendor/minisearch/7.2.0/`, ESM build, types and LICENSE; its `package.json` only says
`"sideEffects": false` so a page that imports `parseQuery` alone carries none of MiniSearch). It holds no storage and
no module: build it at start, `feed` the list, and keep it current from the list watch (the sample list feeds only records whose
text changed). Nothing is saved, so there is no format to migrate.

- Query syntax (`query.js`, ported from a working parser): words (all must match, prefix + fuzzy 0.2), `field:value`,
  `"phrase"`, `-word` / `-field:value`, `a OR b` / `a | b`. Operators the app names (`is:`, `has:`, `after:`) are
  callbacks on the record and run as filters; a near miss of a field or operator name is searched as text and returned
  in `unknown` for a "did you mean" line. A query with no words (only filters, phrases or leave-outs) lists matches
  newest first (`newest(record)`, default `updatedAt`).
- Later: a `toJSON`/`loadJSON` cache of the index (rebuild at start is cheap below ~10k records).

## Align

- Data: the notes' per-area bundles (`index.json` + `<area>.json`), served at `/data/` by `worker/data.js`. `data.js`
  keeps the last copy in Cache Storage (`align-data-v1`), so cards show at once and offline. It then fetches `index.json`
  fresh and refetches only the areas whose `v` changed. The index it keeps is per area, so an area that failed to
  download is asked for again next time.
- Deck (`cards.js` `queue`): never-seen lines first, then the ones seen longest ago. The deck is made when the data or
  the filter changes, not when a verdict comes in, so cards never move under his finger. Once he has tapped anything,
  a fresher copy waits for the next visit.
- Verdicts: `spaces/_/verdicts/{uid}~{line with '/' and '#' as '~'}`, one doc per person and line, latest answer wins.
  Text is always written ('' for none). The rules check that the id is the writer's and the line's.
- A card swiped past with no answer is saved as `seen`, after the glide lands. This is skipped when the line already
  has a real answer, so his fix text is never overwritten.
- Flags (questions the notes mark as doubtful) need an owner-only route on the Worker: next step.
- Tests: `e2e/align.spec.mjs` uses made-up bundles in `e2e/fixtures/data/`. The jank gate in the same file is the card swipe at 4x
  CPU slowdown, with app-ui's frame budget.

## Add tab

Owner only (role admin; the tab and side link stay hidden for others, and the Worker refuses anyone else). `screens/add.js`:
text -> `app.file` (POST `/api/file`, `worker/file.js`) sends the topic list the page already has (id, title, sections) and
gets `{ topic, section, line, isNew }`. Sonnet (`claude-sonnet-5-5`, Worker secret `ANTHROPIC_API_KEY`, never in a file)
rewords to the notes' house style; if it changes or drops a number the line falls back to his own words. Confirm saves a
verdict with choice `add`, fact `add:<area>/<slug>#<time base36>` (the suffix keeps two adds to one topic from sharing a
doc; the processor ignores it), `text`, `section` (rules allow `section`, at most 100), then `app.flush()`. Local/test mode:
a canned filing, no network. Tests: `worker/test/file.test.mjs` (model mocked), `e2e/add.spec.mjs`.
