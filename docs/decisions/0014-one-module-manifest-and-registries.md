# 0014: One module manifest, and recipes that add registry entries

Status: accepted (2026-10-28). Builds on [0012](0012-optional-modules-as-recipes.md).

Decision: every import map name is listed once, in `modules.json` at the root (its address, the `types` file for
`tsconfig.json` and the `alias` Vite builds from; core versions come from `package.json`'s devDependency tags).
`node tools/modules.mjs` writes everything made from it: the import map, tsconfig `paths`, Vite's `SOURCE_ALIAS`,
module style links, `sw.js`'s SHELL list, the import map's CSP hash, and the rules (each `app/rules/<module>.rules` in
a generated block of `app/firestore.app.rules`, then built into `app/firestore.rules`). CI runs its `--check`.
Recipes name modules in one `modules` field (the older `importMap`, `tsconfigPaths` and `viteAlias` are still read)
and add entries to registries: `worker/modules.js` (routes the Worker asks in turn), `app/rules/`,
`app/test/rules/`, and their own style sheet. `wrangler.jsonc` bindings and the e2e server's stand-ins stay inserts
after an `add:` mark.

Why: one module was hand-synced in five places and core versions were named twice, so a missed edit failed only in
CI (or offline). Text pasted into shared files after marks made recipes fragile to edits around the marks.

What follows: `add.mjs`, `update-from-starter.mjs`, `vendor-firebase.mjs` and the static flavour edit `modules.json`
and regenerate; nobody edits the generated places by hand.
