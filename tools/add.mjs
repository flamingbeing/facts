// Adds an optional module to an app from its recipe, or takes it out again (README, "Modules").
//
//   node tools/add.mjs <source> [--dir <app>] [--dry-run]
//   node tools/add.mjs --remove <module> [--dir <app>] [--dry-run]
//   node tools/add.mjs cloud --project <firebase-project-id> [--dir <app>] [--dry-run]   a static app made the cloud app
//
// <source> is a recipe: a local path (`recipes/search.json`), `<owner/repo>@<tag|sha>:recipes/<module>.json`, or a
// bare module name, which means the template's recipe at the commit the app was made from (.starter.json "template"
// and "commit"; the local recipes/<module>.json when there is no commit, as in the template itself).
//
// A recipe (recipes/search.json is the first) is JSON with these fields, every one optional but "module":
//   module          the name .starter.json "modules" records it under
//   modules         { name: entry } added to modules.json's "imports" (tools/modules.mjs: { url, types?, alias? } or
//                   { core, file, types?, alias? }), which writes the import map, tsconfig paths and Vite alias from it.
//                   Older recipes' importMap { name: url }, tsconfigPaths { name: [path] } and viteAlias { name: path }
//                   are read as the same thing.
//   styles          [file] the module's own style sheets (copied in by `files`), added to modules.json's "styles": the
//                   page links each after app.css
//   root            the folder of the recipe's repo that mirrors the app (recipes/search): `vendor` and `files` paths are
//                   the app's, read from under it (default: the repo's top)
//   vendor          folders of outside packages, copied like files; each must hold its LICENSE
//   files           [{ from, to? }] files or folders copied from the recipe's repo (the folder above recipes/) to the
//                   app (`to` defaults to `from`), with the app's own values swapped in as fill.mjs does. A module joins
//                   the app's registries by its own files: worker/<module>-route.js listed in worker/modules.js, rules in
//                   app/rules/<module>.rules, rules tests in app/test/rules/<module>.mjs;
//                   [{ to, after, line }] one line put after the line holding `after` (a registry's entry: app/src/modules.js,
//                   worker/modules.js);
//                   [{ to, after, block }] the lines of `block` (a file in the recipe's repo, usually recipes/<module>/...)
//                   put after the line holding `after`; both get the app's own values swapped in
//   tsconfigInclude [glob] added to tsconfig.json's "include"
//   cssVars         { --name: value } added to app/public/app.css's :root block
//   needs           owner-only steps, printed as NEEDS-YOU lines
//   docs            lines printed after the add
//
// Every edit is idempotent: a second run changes nothing. A copied file the app has changed is merged three-way with
// the copy from the source .starter.json recorded before (git merge-file, as update-from-starter.mjs does), else kept;
// a line or block the previous recipe put in and this one doesn't is taken out.
// --remove undoes each edit; a file the app changed is kept and listed. Afterwards node tools/modules.mjs writes every
// generated place (sw.js's list, the import map's CSP hash, the rules) and .starter.json "modules" records { module: source }.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { swapsFor, fixup, isText, fill, RULES } from './fill.mjs';
import { after, merge3, templateRepo, show, update } from './update-from-starter.mjs';
import { MANIFEST, applyEdits, formatManifest, generate, manifestFrom, moduleEdits } from './modules.mjs';

const REMOTE = /^([\w.-]+\/[\w.-]+)@([\w./-]+):(.+\.json)$/;
const MAP_RE = /(<script type="importmap">\n)([\s\S]*?)(\n\s*<\/script>)/;
const INCLUDE_RE = /("include":\s*)(\[.*\])/;
const CSS_MARK = '/* add: cssVars */';

/** a source's files: { recipe, read(rel) -> Buffer | null, list(rel) -> [rel], app, done() }; `clones` shares one
 * clone per repo between sources (their done() is then the caller's: closeClones) */
export function openSource(source, dir, github = 'https://github.com', clones = null) {
  const remote = source.match(REMOTE);
  if (remote) {
    const [, repo, ref, rel] = remote;
    const url = `${github}/${repo}`;
    const r = clones ? clones.get(url) ?? clones.set(url, templateRepo(url)).get(url) : templateRepo(url);
    const read = file => show(r.dir, ref, file);
    const list = file => execFileSync('git', ['-C', r.dir, '-c', 'core.quotePath=false', 'ls-tree', '-r', '-z', '--name-only', ref, '--', file], { encoding: 'utf8' }).split('\0').filter(Boolean);
    return withRecipe({ read, list, done: clones ? () => {} : r.done }, rel, source);
  }
  const file = path.resolve(dir, source);
  const root = path.dirname(path.dirname(file));
  const read = rel => { try { return fs.readFileSync(path.join(root, rel)); } catch { return null; } };
  const walk = rel => {
    const p = path.join(root, rel);
    if (!fs.existsSync(p)) return [];
    if (!fs.statSync(p).isDirectory()) return [rel];
    return fs.readdirSync(p).sort().flatMap(n => walk(`${rel}/${n}`));
  };
  return withRecipe({ read, list: walk, done() {} }, path.relative(root, file), source);
}
export const closeClones = clones => { for (const r of clones.values()) r.done(); clones.clear(); };
function withRecipe(src, rel, source) {
  const text = src.read(rel);
  if (!text) { src.done(); throw new Error(`no recipe at ${source}`); }
  const recipe = JSON.parse(text.toString('utf8'));
  if (!/^[a-z][a-z0-9-]*$/.test(recipe.module ?? '')) { src.done(); throw new Error(`${source}: "module" must be a name like search`); }
  return { ...src, recipe, app: JSON.parse(src.read('.starter.json')?.toString('utf8') || 'null')?.app };
}

/** a bare module name -> the template's recipe at the app's commit (local recipes/ when there is none) */
export function resolveSource(name, meta) {
  if (!/^[a-z][a-z0-9-]*$/.test(name)) return name;
  return meta.commit ? `${meta.template}@${meta.commit}:recipes/${name}.json` : `recipes/${name}.json`;
}

/** a recorded source as a pristine copy: a local recipe inside the app itself (the template records
 * recipes/search.json) means the template's recipe at the app's commit; null when there is no commit (the template) */
export function pinned(source, meta, dir) {
  if (REMOTE.test(source)) return source;
  const rel = path.relative(dir, path.resolve(dir, source));
  if (rel.startsWith('..') || path.isAbsolute(rel)) return source;
  return meta.commit ? `${meta.template}@${meta.commit}:${rel.split(path.sep).join('/')}` : null;
}

// lines compared without spaces, quote style or a trailing ; or , (a formatter's changes)
const norm = l => l.replace(/\s+/g, '').replace(/"/g, "'").replace(/[;,]$/, '');
/** the lines of the block an anchor opens: from the line after it to the first blank line or closing brace */
function block(lines, anchor) {
  const at = lines.findIndex(l => l.includes(anchor));
  if (at < 0) return null;
  let end = at + 1;
  while (end < lines.length && lines[end].trim() && !/^[}\]]/.test(lines[end].trim())) end++;
  return { at, end };
}
/** text with `line` after the line holding `anchor`; a line in its block starting with `key` is replaced */
export function putLine(text, anchor, line, key = line) {
  const lines = dropLine(text, key, anchor).split('\n');
  const b = block(lines, anchor);
  if (!b) throw new Error(`no line holding ${anchor}`);
  lines.splice(b.at + 1, 0, line);
  return lines.join('\n');
}
/** text without the lines in `anchor`'s block (the whole text when the anchor is gone) starting with `key` */
export function dropLine(text, key, anchor) {
  const k = norm(key.trim());
  const lines = text.split('\n');
  const b = anchor ? block(lines, anchor) : null;
  return lines.filter((l, i) => (b && (i <= b.at || i >= b.end)) || !norm(l.trim()).startsWith(k)).join('\n');
}

/** the index where `lines` start in `all` (compared as norm does), or -1 */
function find(all, lines) {
  const want = lines.map(norm);
  for (let i = 0; i + want.length <= all.length; i++) if (want.every((w, j) => norm(all[i + j]) === w)) return i;
  return -1;
}
/** text with the lines of `block` after the line holding `anchor` (unchanged when they are there already) */
export function putBlock(text, anchor, block) {
  const lines = text.split('\n'), at = lines.findIndex(l => l.includes(anchor));
  if (at < 0) throw new Error(`no line holding ${anchor}`);
  if (find(lines, block) >= 0) return text;
  lines.splice(at + 1, 0, ...block);
  return lines.join('\n');
}
/** text without the lines of `block` (unchanged when they are not there) */
export function dropBlock(text, block) {
  const lines = text.split('\n'), at = find(lines, block);
  if (at < 0) return text;
  lines.splice(at, block.length);
  return lines.join('\n');
}

/** app/index.html with the import map's entries set (value) or taken out (null) */
export function editImportMap(html, entries) {
  const m = html.match(MAP_RE);
  if (!m) throw new Error('app/index.html has no import map');
  const map = JSON.parse(m[2]);
  for (const [name, url] of Object.entries(entries)) {
    if (url === null) delete map.imports[name];
    else map.imports[name] = url;
  }
  return html.replace(MAP_RE, (_, a, __, c) => a + JSON.stringify(map, null, 2) + c);
}

/** tsconfig.json's one-line "include" with globs added or taken out */
export function editInclude(text, globs, remove = false) {
  const m = text.match(INCLUDE_RE);
  if (!m) throw new Error('tsconfig.json has no one-line "include"');
  const now = JSON.parse(m[2]);
  const next = remove ? now.filter(g => !globs.includes(g)) : [...now, ...globs.filter(g => !now.includes(g))];
  return text.replace(INCLUDE_RE, (_, a) => `${a}[${next.map(g => JSON.stringify(g)).join(', ')}]`);
}

/** the line edits a recipe makes: [{ file, anchor, line, key }], and [{ file, anchor, block }] for a block of lines */
export function lineEdits(recipe) {
  const out = [];
  for (const [name, value] of Object.entries(recipe.cssVars ?? {}))
    out.push({ file: 'app/public/app.css', anchor: CSS_MARK, line: `  ${name}: ${value};`, key: `${name}:` });
  for (const f of recipe.files ?? []) {
    if (f.line) out.push({ file: f.to, anchor: f.after, line: f.line, key: f.line });
    if (f.block) out.push({ file: f.to, anchor: f.after, block: f.block });
  }
  return out;
}

/** the files a recipe copies: [{ from, to }] one per file */
function copies(src, recipe) {
  const root = recipe.root ? recipe.root.replace(/\/?$/, '/') : '';
  const out = [];
  for (const dirRel of recipe.vendor ?? []) {
    const files = src.list(root + dirRel);
    if (!files.some(f => /\/LICEN[CS]E[^/]*$/.test(f))) throw new Error(`vendor ${dirRel}: no LICENSE`);
    out.push(...files.map(f => ({ from: f, to: f.slice(root.length) })));
  }
  for (const f of recipe.files ?? []) {
    if (f.line || f.block) continue;
    const files = src.list(root + f.from);
    if (!files.length) throw new Error(`files: ${f.from} is not in the recipe's repo`);
    const to = f.to ?? f.from;
    out.push(...files.map(rel => ({ from: rel, to: to + rel.slice(root.length + f.from.length) })));
  }
  return out;
}

/** text with the app's values in (the source's .starter.json app -> this app's) */
function swapped(src, rel, text, app) {
  if (!src.app) return text;
  for (const [re, v] of swapsFor(src.app, app)) text = text.replace(re, v);
  return fixup(rel, text, app);
}
/** a source file with the app's values in */
function filled(src, rel, app) {
  const buf = src.read(rel);
  if (buf === null || !isText(rel)) return buf;
  return Buffer.from(swapped(src, rel, buf.toString('utf8'), app));
}

// -> { module, changes: [{ action, path, note? }], conflicts: [paths] }
export function add({ source, dir = '.', dryRun = false, remove = false, log = console.log, refresh = true, github } = {}) {
  dir = path.resolve(dir);
  const metaPath = path.join(dir, '.starter.json');
  const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
  const recorded = meta.modules ?? {};
  if (remove && !recorded[source]) throw new Error(`.starter.json records no module ${source}`);
  const clones = new Map();
  const from = remove ? pinned(recorded[source], meta, dir) ?? recorded[source] : resolveSource(source, meta);
  const opened = [];
  try {
    const src = openSource(from, dir, github, clones);
    opened.push(src);
    const result = { module: src.recipe.module, changes: [], conflicts: [] };
    const { recipe } = src;
    if (meta.flavour && !remove && recipe.module === 'files') throw new Error(`the files module needs the cloud (its Worker routes and rules): node tools/add.mjs cloud --project <id> first`);
    const was = !remove && recorded[recipe.module] ? pinned(recorded[recipe.module], meta, dir) : null;
    const prevSource = was && was !== from ? was : null;
    const prev = prevSource ? openSource(prevSource, dir, github, clones) : null;
    if (prev) opened.push(prev);
    log(`${remove ? 'remove' : 'add'} ${recipe.module} (${from})`);
    const note = (action, p, extra) => { result.changes.push({ action, path: p, ...(extra ? { note: extra } : {}) }); log(`  ${action.padEnd(9)} ${p}${extra ? `  (${extra})` : ''}`); };
    const staged = new Map();   // --dry-run: the writes, so later edits see earlier ones
    const read = rel => { if (staged.has(rel)) return staged.get(rel); try { return fs.readFileSync(path.join(dir, rel)); } catch { return null; } };
    const write = (rel, buf) => { if (dryRun) return void staged.set(rel, Buffer.from(buf)); fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), buf); };
    const unlink = rel => {
      if (dryRun) return void staged.set(rel, null);
      fs.rmSync(path.join(dir, rel));
      for (let d = path.dirname(rel); d !== '.' && fs.readdirSync(path.join(dir, d)).length === 0; d = path.dirname(d)) fs.rmdirSync(path.join(dir, d));
    };
    const editText = (rel, fn) => {
      const before = read(rel)?.toString('utf8');
      if (before === undefined) throw new Error(`${rel} is missing`);
      const next = fn(before);
      if (next !== before) { write(rel, next); note('edited', rel); }
    };

    // copied files: added, merged with the copy recorded before, or (remove) deleted when unchanged
    const toCopy = copies(src, recipe);
    // files the previous recipe copied and this one doesn't: deleted when the app left them as copied
    if (prev) for (const c of copies(prev, prev.recipe)) {
      if (toCopy.some(n => n.to === c.to)) continue;
      const ours = read(c.to);
      if (ours === null) continue;
      if (ours.equals(filled(prev, c.from, meta.app))) { unlink(c.to); note('deleted', c.to, 'not in the recipe now'); }
      else note('kept', c.to, 'not in the recipe now; the app changed it');
    }
    for (const c of toCopy) {
      const theirs = filled(src, c.from, meta.app);
      const ours = read(c.to);
      if (remove) {
        if (ours === null) continue;
        if (ours.equals(theirs)) { unlink(c.to); note('deleted', c.to); }
        else note('kept', c.to, 'the app changed it');
        continue;
      }
      if (ours === null) { write(c.to, theirs); note('added', c.to); continue; }
      if (ours.equals(theirs)) continue;
      const base = prev ? filled(prev, c.from, meta.app) : null;
      if (base && ours.equals(base)) { write(c.to, theirs); note('updated', c.to); continue; }
      if (!base || !isText(c.to)) { note('kept', c.to, 'the app\'s copy differs from the recipe\'s'); continue; }
      const m = merge3(ours.toString('utf8'), base.toString('utf8'), theirs.toString('utf8'), ['app', prevSource, from]);
      write(c.to, m.text);
      if (m.conflicts) { result.conflicts.push(c.to); note('conflict', c.to, `${m.conflicts} to resolve`); }
      else note('merged', c.to);
    }

    // modules.json: the recipe's modules and styles in (or out), then the places generated from it
    const edits = moduleEdits(recipe);
    const names = (r, e) => Object.keys(e.imports).length || Object.keys(e.paths).length || r.styles?.length;
    if (names(recipe, edits) || (prev && names(prev.recipe, moduleEdits(prev.recipe)))) {
      const text = rel => read(rel)?.toString('utf8') ?? null;
      const html = text('app/index.html');
      if (html === null) throw new Error('app/index.html is missing');
      let manifest = text(MANIFEST) !== null ? JSON.parse(text(MANIFEST)) : manifestFrom({ html, tsconfig: text('tsconfig.json'), vite: text('vite.config.mjs') });
      if (prev) {   // what the previous recipe named and this one doesn't
        const was = moduleEdits(prev.recipe);
        manifest = applyEdits(manifest, { modules: Object.fromEntries(Object.keys(was.imports).filter(n => !(n in edits.imports)).map(n => [n, null])),
          tsconfigPaths: Object.fromEntries(Object.keys(was.paths).filter(n => !(n in edits.paths)).map(n => [n, []])),
          styles: (prev.recipe.styles ?? []).filter(st => !(recipe.styles ?? []).includes(st)) }, true);
      }
      manifest = applyEdits(manifest, recipe, remove);
      const mtext = formatManifest(manifest);
      if (mtext !== text(MANIFEST)) { write(MANIFEST, mtext); note('edited', MANIFEST); }
      const g = generate(manifest, text('package.json') ?? '{}', { html, tsconfig: text('tsconfig.json'), vite: text('vite.config.mjs') });
      editText('app/index.html', () => g.html);
      if (g.tsconfig != null) editText('tsconfig.json', () => g.tsconfig);
      if (g.vite != null) editText('vite.config.mjs', () => g.vite);
    }
    if (recipe.tsconfigInclude) editText('tsconfig.json', t => editInclude(t, recipe.tsconfigInclude, remove));
    // glue: lines and blocks put after an anchor; a block the previous recipe put there and this one changed is swapped,
    // and one this recipe no longer has is taken out
    const glue = (r, e) => e.block ? swapped(r, e.file, r.read(e.block).toString('utf8'), meta.app).replace(/\n+$/, '').split('\n') : swapped(r, e.file, e.line, meta.app);
    const same = (a, b) => a.file === b.file && a.anchor === b.anchor && a.line === b.line && a.block === b.block;
    if (prev && !remove) for (const e of lineEdits(prev.recipe)) {
      if (lineEdits(recipe).some(n => same(n, e) || (e.block && n.file === e.file && n.block === e.block)) || read(e.file) === null) continue;
      if (e.block) { const lines = prev.read(e.block) ? glue(prev, e) : null; if (lines) editText(e.file, t => dropBlock(t, lines)); }
      else editText(e.file, t => dropLine(t, e.line === e.key ? glue(prev, e) : e.key, e.anchor));
    }
    for (const e of lineEdits(recipe)) {
      const css = e.anchor === CSS_MARK && !remove ? read(e.file)?.toString('utf8') ?? '' : null;
      if (css !== null && !css.includes(CSS_MARK)) { write(e.file, `${css && css.replace(/\n*$/, '\n\n')}:root {\n  ${CSS_MARK}\n}\n`); note('edited', e.file); }
      if (remove && read(e.file) === null) continue;
      if (e.block) {
        const lines = glue(src, e);
        const before = prev ? lineEdits(prev.recipe).find(p => p.file === e.file && p.block === e.block) : null;
        editText(e.file, t => remove ? dropBlock(t, lines) : putBlock(before ? dropBlock(t, glue(prev, before)) : t, e.anchor, lines));
      } else {
        const line = glue(src, e), key = e.line === e.key ? line : e.key;
        editText(e.file, t => remove ? dropLine(t, key, e.anchor) : putLine(t, e.anchor, line, key));
      }
    }

    if (!dryRun) {
      if (refresh) after(dir, { install: false, changedPkg: false, log });
      const modules = { ...recorded };
      if (remove) delete modules[recipe.module]; else modules[recipe.module] = from;
      const { modules: _, ...rest } = meta;
      fs.writeFileSync(metaPath, JSON.stringify(Object.keys(modules).length ? { ...rest, modules } : rest, null, 2) + '\n');
      log(`.starter.json: modules ${Object.keys(modules).join(', ') || 'none'}`);
    }
    if (!remove) {
      for (const n of recipe.needs ?? []) log(`NEEDS-YOU: ${n}`);
      for (const d of recipe.docs ?? []) log(d);
    }
    if (result.conflicts.length) log(`\n${result.conflicts.length} file(s) with conflicts to resolve by hand:\n  ${result.conflicts.join('\n  ')}`);
    return result;
  } finally { for (const s of opened) s.done(); closeClones(clones); }
}

// A static app (.starter.json "flavour") made the cloud app: the template's cloud files at the app's commit come in as an
// update from the static render to the cloud tree (the app's own changes merged, the static files it never changed
// taken out), then fill.mjs sets the Firebase project and writes config.js with its web config. -> update's result
export function toCloud({ dir = '.', project, from, to, dryRun = false, install = true, log = console.log } = {}) {
  const meta = JSON.parse(fs.readFileSync(path.join(dir, '.starter.json'), 'utf8'));
  if (!meta.flavour) throw new Error('this app is the cloud app already (.starter.json has no "flavour")');
  if (!RULES.project[0].test(project ?? '')) throw new Error(`--project <id>: ${RULES.project[1]}`);
  if (!meta.commit && !to) throw new Error('.starter.json has no "commit" (the template commit the app started from)');
  const r = update({ dir, from, to: to ?? meta.commit, dryRun, install, checkLatest: false, unflavour: { project }, log });
  // conflicts first: fill would swap values into half-merged files
  if (r.conflicts.length && !dryRun) log('resolve the conflicts above, then: node tools/fill.mjs (it writes config.js with the project)');
  else if (!dryRun) {
    fill({ dir, log });
    for (const m of ['NEEDS-YOU: the Firebase project\'s web app config: node tools/fill.mjs --web-config <file> (README, "Fill")',
      'then: npm test, npm run typecheck and npm run e2e (the emulators) before the PR']) log(m);
  }
  return r;
}

export function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') out.dryRun = true;
    else if (a === '--remove') { out.remove = true; out.source = argv[++i]; }
    else if (a === '--dir') out.dir = argv[++i];
    else if (a === '--project') out.project = argv[++i];
    else if (!a.startsWith('--') && !out.source) out.source = a;
    else throw new Error(`unknown argument ${a}`);
  }
  if (!out.source) throw new Error('name a recipe: node tools/add.mjs <source> | --remove <module>');
  return out;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const o = parseArgs(process.argv.slice(2));
    if (o.project && o.source !== 'cloud') throw new Error('--project is for `add.mjs cloud`');
    const r = o.source === 'cloud' && !o.remove ? toCloud(o) : add(o);
    if (r.conflicts.length) process.exit(1);
  } catch (e) {
    console.error(`add: ${e.message}`);
    process.exit(2);
  }
}
