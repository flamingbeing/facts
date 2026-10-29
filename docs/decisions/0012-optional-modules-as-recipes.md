# 0012: Optional modules are recipes that tools/add.mjs puts in and takes out

Status: accepted (2026-10-27).

Decision: a part not every app needs (search first) is a module with a recipe, `recipes/<module>.json`, naming its
files, vendored packages, import map entries, tsconfig paths and include, Vite aliases, CSS variables, owner-only
steps and docs. `node tools/add.mjs <recipe>` makes those edits and `--remove` undoes them; `.starter.json` "modules"
records `{ module: source }`, pinned to a template commit in a filled app (fill.mjs) so a later add or remove can
compare the app's copy with a pristine one (unchanged: replaced or deleted; changed: merged three-way or kept). The
starter's screens reach a module only through a slot in `app/src/modules.js` (one import and one slot line per
module, after its `add:` marks); an empty slot costs the page nothing. Line edits go after fixed marks (`// add:
imports`, `// add: slots`, `// add: viteAlias`, `/* add: cssVars */`, tsconfig's `"paths": {`), only inside the
block a mark opens, matched without spaces or quote style.

Why: apps of a second kind want some parts and not others; a fat starter makes every app carry them, a fork per
mix drifts. A recipe keeps one copy of the module, added the same way to a new app (`new-app.mjs --with`) or an old
one, and CI proves it: the `full` jobs add every recipe to a scratch copy and run the whole suite, and add/remove round-trip tests check the lean app comes back.

What follows: a module's own files stay its own (no edits to core files beyond the marks); a recipe that needs a
runtime change in core is a core change first. A module born in another repo is added by
`<owner/repo>@<tag|sha>:recipes/<module>.json`.
