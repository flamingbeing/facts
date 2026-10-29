// The app's modules, from one list (modules.json at the app's top): every other place that names a module is written
// from it, never by hand (README, "Modules").
//
//   node tools/modules.mjs [--dir <app>]           write them all
//   node tools/modules.mjs [--dir <app>] --check   fail if any is out of date (CI)
//
// modules.json:
//   core     { package: address } where a core package is served: the version comes from package.json's devDependency
//            of that name (`github:<owner>/<repo>#v<version>` or a plain version), so it is named once
//   imports  { name: entry } the page's import map, in order. An entry is
//              { core, file }   a core package's file (https://core.anawj.com/sync/<version>/app.js)
//              { url }          any other address: a vendored or local file (./search/index.js) or a pinned https:// one
//            plus, optional:  types  the file tsconfig.json's "paths" points the name at (npm run typecheck)
//                             alias  the source file vite.config.mjs's SOURCE_ALIAS points it at (tools/vite-pieces.mjs)
//   paths    { pattern: [file] } more tsconfig.json "paths" (wildcards, test fixtures)
//   styles   [file] the modules' own style sheets, linked after app.css (a recipe's screens: css/files.css)
//
// It writes: app/index.html's import map, its core addresses (<link>, <script src>) at the pinned versions and the
// styles' <link>s; tsconfig.json's "paths"; vite.config.mjs's SOURCE_ALIAS; then sw.js's SHELL (tools/sw-files.mjs),
// the import map's CSP hash in worker/headers.js, and the rules: app/firestore.app.rules's modules block from
// app/rules/*.rules (one file per module), built into app/firestore.rules when .devkit/ is there.
// An app made before modules.json gets one, read from those places, the first time this runs.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { writeShell } from './sw-files.mjs';

export const MANIFEST = 'modules.json';
const MAP_RE = /(<script type="importmap">\n)([\s\S]*?)(\n\s*<\/script>)/;
const PATHS_RE = /("paths":\s*\{\n)([\s\S]*?)(\n\s*\})/;
const ALIAS_RE = /(export const SOURCE_ALIAS = \{\n)([\s\S]*?)(\};)/;
const HASH_RE = /(export const IMPORT_MAP = )"'sha256-[A-Za-z0-9+/=]+'"/;
const STYLE_LINE = /^[ \t]*<link rel="stylesheet" href="[^"]*" data-module>\n/gm;
const PRELOAD_LINE = /^[ \t]*<link rel="modulepreload" href="[^"]*" data-module>\n/gm;
const RULES_RE = /^([ \t]*)(\/\/ modules: rules\{[^\n]*\n)([\s\S]*?)(^[ \t]*\/\/ \}modules[^\n]*)$/m;
const VERSION = /^(?:github:[^#]+#v|[\^~]?)(\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?)$/;
const CORE = { 'app-sync': 'https://core.anawj.com/sync/', 'app-ui': 'https://core.anawj.com/ui/' };

const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const read = (dir, rel) => { try { return fs.readFileSync(path.join(dir, rel), 'utf8'); } catch { return null; } };

/** package.json's devDependency versions of the core packages -> { package: version } */
export function coreVersions(manifest, pkgText) {
  const deps = JSON.parse(pkgText).devDependencies ?? {};
  const out = {};
  for (const name of Object.keys(manifest.core ?? {})) {
    const v = (deps[name] ?? '').match(VERSION)?.[1];
    if (v) out[name] = v;
  }
  return out;
}

/** one entry -> its address in the import map */
export function address(manifest, versions, name, e) {
  if (e.url) return e.url;
  const base = manifest.core?.[e.core];
  if (!base) throw new Error(`${MANIFEST}: ${name} names core "${e.core}", which "core" does not list`);
  if (!versions[e.core]) throw new Error(`${MANIFEST}: ${name} is from ${e.core}, but package.json has no devDependency ${e.core} with a version`);
  return `${base}${versions[e.core]}/${e.file}`;
}

/** an import-map address -> an entry ({ core, file } for a core package's address) */
export function entryFromUrl(url, core = CORE) {
  for (const [pkg, base] of Object.entries(core)) {
    const m = url.match(new RegExp(`^${esc(base)}\\d+\\.\\d+\\.\\d+[^/]*/(.+)$`));
    if (m) return { core: pkg, file: m[1] };
  }
  return { url };
}

/**
 * A recipe's (or flavour's) module edits as one { name: entry | null } (null takes the name out); old recipes' separate
 * importMap / tsconfigPaths / viteAlias are read too. -> { imports, paths } (paths: tsconfig names with no map entry)
 */
export function moduleEdits(spec, core = CORE) {
  const imports = {}, paths = {};
  for (const [name, e] of Object.entries(spec.modules ?? {})) imports[name] = e === null ? null : typeof e === 'string' ? entryFromUrl(e, core) : { ...e };
  for (const [name, url] of Object.entries(spec.importMap ?? {})) imports[name] ??= url === null ? null : entryFromUrl(url, core);
  for (const [name, p] of Object.entries(spec.tsconfigPaths ?? {})) {
    if (imports[name]) imports[name].types ??= p[0];
    else if (!(name in imports)) paths[name] = p;
  }
  for (const [name, to] of Object.entries(spec.viteAlias ?? {})) if (imports[name]) imports[name].alias ??= to;
  return { imports, paths };
}

/** the manifest with a recipe's edits in (remove: taken out) */
export function applyEdits(manifest, spec, remove = false) {
  const { imports, paths } = moduleEdits(spec, manifest.core);
  const out = { ...manifest, imports: { ...manifest.imports }, paths: { ...manifest.paths } };
  for (const [name, e] of Object.entries(imports)) {
    if (remove || e === null) delete out.imports[name];
    else out.imports[name] = e;
  }
  for (const [name, p] of Object.entries(paths)) { if (remove) delete out.paths[name]; else out.paths[name] = p; }
  const styles = spec.styles ?? [];
  out.styles = remove ? (manifest.styles ?? []).filter(s => !styles.includes(s)) : [...(manifest.styles ?? []), ...styles.filter(s => !(manifest.styles ?? []).includes(s))];
  return out;
}

/** modules.json's text: one line per entry, so a merge sees one module's change as one line */
export function formatManifest(m) {
  const obj = o => {
    const keys = Object.keys(o ?? {});
    return keys.length ? `{\n${keys.map((k, i) => `    ${JSON.stringify(k)}: ${JSON.stringify(o[k]).replace(/":/g, '": ').replace(/,"/g, ', "').replace(/^\{"/, '{ "').replace(/\}$/, ' }')}${i < keys.length - 1 ? ',' : ''}`).join('\n')}\n  }` : '{}';
  };
  const styles = m.styles?.length ? `[\n${m.styles.map((s, i) => `    ${JSON.stringify(s)}${i < m.styles.length - 1 ? ',' : ''}`).join('\n')}\n  ]` : '[]';
  return `{\n  "about": ${JSON.stringify(m.about ?? ABOUT)},\n  "core": ${obj(m.core)},\n  "imports": ${obj(m.imports)},\n  "paths": ${obj(m.paths)},\n  "styles": ${styles}\n}\n`;
}
const ABOUT = 'The app\'s modules, named once: node tools/modules.mjs writes the import map, tsconfig paths, Vite aliases, style and modulepreload links, sw.js list, CSP hash and rules from this (README, "Modules").';

/** a manifest read from an app made before modules.json: its import map, tsconfig paths and SOURCE_ALIAS */
export function manifestFrom({ html, tsconfig, vite }) {
  const map = JSON.parse(html.match(MAP_RE)?.[2] ?? '{"imports":{}}').imports ?? {};
  const tsPaths = JSON.parse(`{${(tsconfig?.match(PATHS_RE)?.[2] ?? '').replace(/,\s*$/, '')}}`);
  const alias = {};
  for (const m of (vite?.match(ALIAS_RE)?.[2] ?? '').matchAll(/^\s*'([^']+)':\s*'([^']+)',?$/gm)) alias[m[1]] = m[2];
  const preloaded = new Set([...html.matchAll(/<link rel="modulepreload" href="([^"]*)" data-module>/g)].map(m => m[1]));
  const imports = {};
  for (const [name, url] of Object.entries(map)) {
    imports[name] = entryFromUrl(url);
    if (tsPaths[name]) { imports[name].types = tsPaths[name][0]; delete tsPaths[name]; }
    if (alias[name]) imports[name].alias = alias[name];
    if (preloaded.has(url)) imports[name].preload = true;
  }
  const styles = [...html.matchAll(/<link rel="stylesheet" href="([^"]*)" data-module>/g)].map(m => m[1]);
  return { about: ABOUT, core: { ...CORE }, imports, paths: tsPaths, styles };
}

/**
 * The generated places, from the manifest and package.json: pure, text in, text out (tools/flavour.mjs renders
 * with it). { html, tsconfig?, vite? } -> the same with the generated parts written
 */
export function generate(manifest, pkgText, { html, tsconfig, vite }) {
  const versions = coreVersions(manifest, pkgText);
  const imports = {};
  for (const [name, e] of Object.entries(manifest.imports ?? {})) imports[name] = address(manifest, versions, name, e);
  if (!MAP_RE.test(html)) throw new Error('app/index.html has no import map');
  let page = html.replace(MAP_RE, (_, a, __, c) => a + JSON.stringify({ imports }, null, 2) + c);
  // the core addresses outside the map (app-ui's style sheets and early script) at the pinned version too
  for (const [pkg, base] of Object.entries(manifest.core ?? {}))
    if (versions[pkg]) page = page.replace(new RegExp(`(${esc(base)})\\d+\\.\\d+\\.\\d+[^/"]*/`, 'g'), `$1${versions[pkg]}/`);
  // the modules' style sheets: right after app.css's link, marked data-module
  page = page.replace(STYLE_LINE, '');
  const styles = manifest.styles ?? [];
  if (styles.length) {
    const at = page.match(/^([ \t]*)<link rel="stylesheet" href="app\.css">\n/m);
    if (!at) throw new Error('app/index.html has no <link rel="stylesheet" href="app.css"> to put the modules\' styles after');
    page = page.replace(at[0], () => at[0] + styles.map(s => `${at[1]}<link rel="stylesheet" href="${s}" data-module>\n`).join(''));
  }
  // the modules the page starts with (entries marked "preload"): fetched in parallel with the page's own scripts, each with
  // the modules it imports, instead of one step down the import chain at a time; right before the first module script
  page = page.replace(PRELOAD_LINE, '');
  const preload = Object.entries(manifest.imports ?? {}).filter(([, e]) => e.preload).map(([n]) => imports[n]);
  if (preload.length) {
    const at = page.match(/^([ \t]*)<script type="module" src="src\/boot\.js"><\/script>\n/m);
    if (!at) throw new Error('app/index.html has no <script type="module" src="src/boot.js"> to put the modulepreload links before');
    page = page.replace(at[0], () => preload.map(u => `${at[1]}<link rel="modulepreload" href="${u}" data-module>\n`).join('') + at[0]);
  }
  const out = { html: page };
  if (tsconfig != null) {
    const paths = [...Object.entries(manifest.imports ?? {}).filter(([, e]) => e.types).map(([n, e]) => [n, [e.types]]), ...Object.entries(manifest.paths ?? {})];
    if (!PATHS_RE.test(tsconfig)) throw new Error('tsconfig.json has no "paths": { block');
    out.tsconfig = tsconfig.replace(PATHS_RE, (_, a, __, c) => a + paths.map(([n, p], i) => `      ${JSON.stringify(n)}: ${JSON.stringify(p).replace(/","/g, '", "')}${i < paths.length - 1 ? ',' : ''}`).join('\n') + c);
  }
  if (vite != null) {
    const alias = Object.entries(manifest.imports ?? {}).filter(([, e]) => e.alias);
    if (!ALIAS_RE.test(vite)) throw new Error('vite.config.mjs has no export const SOURCE_ALIAS = {');
    out.vite = vite.replace(ALIAS_RE, (_, a, __, c) => a + alias.map(([n, e]) => `  '${n}': '${e.alias}',\n`).join('') + c);
  }
  return out;
}

// the CSP hash of the page's one inline script (the import map), as worker/headers.js names it
export function importMapHash(html) {
  const m = html.match(/<script type="importmap">([\s\S]*?)<\/script>/);
  if (!m) throw new Error('app/index.html has no import map');
  // the browser hashes the script as parsed (newlines normalised to LF), so a CRLF checkout must hash the same
  return `'sha256-${crypto.createHash('sha256').update(m[1].replace(/\r\n?/g, '\n')).digest('base64')}'`;
}

/** firestore.app.rules with its modules block holding the rules files (app/rules/*.rules: { name: text }), indented */
export function rulesBlock(appRules, fragments) {
  const m = appRules.match(RULES_RE);
  if (!m) {
    if (Object.keys(fragments).length) throw new Error('app/firestore.app.rules has no "// modules: rules{" ... "// }modules" block for app/rules/*.rules');
    return appRules;
  }
  const pad = m[1];
  const body = Object.keys(fragments).sort().map(f => fragments[f].replace(/\n+$/, '').split('\n').map(l => (l ? pad + l : l)).join('\n') + '\n').join('\n');
  return appRules.replace(RULES_RE, (_, p, open, _old, close) => p + open + body + close);
}

// -> { manifest, files: { rel: text } } every generated file as it should be (the manifest's own text too)
async function plan(dir, log) {
  let text = read(dir, MANIFEST), manifest;
  const html = read(dir, 'app/index.html'), tsconfig = read(dir, 'tsconfig.json'), vite = read(dir, 'vite.config.mjs');
  if (html === null) throw new Error(`${dir} has no app/index.html`);
  if (text === null) { manifest = manifestFrom({ html, tsconfig, vite }); log(`${MANIFEST}: made from the import map, tsconfig.json and vite.config.mjs`); }
  else manifest = JSON.parse(text);
  const files = { [MANIFEST]: formatManifest(manifest) };
  const g = generate(manifest, read(dir, 'package.json') ?? '{}', { html, tsconfig, vite });
  files['app/index.html'] = g.html;
  if (tsconfig !== null) files['tsconfig.json'] = g.tsconfig;
  if (vite !== null) files['vite.config.mjs'] = g.vite;
  const hdr = read(dir, 'worker/headers.js');
  if (hdr !== null) files['worker/headers.js'] = hdr.replace(HASH_RE, `$1"${importMapHash(g.html)}"`);
  const appRules = read(dir, 'app/firestore.app.rules');
  if (appRules !== null) {
    const rd = path.join(dir, 'app/rules');
    const fragments = fs.existsSync(rd) ? Object.fromEntries(fs.readdirSync(rd).filter(f => f.endsWith('.rules')).map(f => [f, fs.readFileSync(path.join(rd, f), 'utf8')])) : {};
    files['app/firestore.app.rules'] = rulesBlock(appRules, fragments);
    const kit = path.join(dir, '.devkit/tools/build-rules.mjs'), common = path.join(dir, '.devkit/rules/common.rules');
    if (fs.existsSync(kit) && fs.existsSync(common)) {
      const { buildRules } = await import(pathToFileURL(kit).href);
      files['app/firestore.rules'] = buildRules(files['app/firestore.app.rules'], fs.readFileSync(common, 'utf8'), 'firestore.app.rules');
    } else if (files['app/firestore.app.rules'] !== appRules) log('rules: no .devkit/ here, so app/firestore.rules is not rebuilt (bash tools/dev-setup.sh, then node tools/modules.mjs)');
  }
  return { manifest, files };
}

/** writes (or, check, compares) every generated place -> { changed: [rel], shell } (throws on a --check failure) */
export async function run({ dir = '.', check = false, log = console.log, shell = true } = {}) {
  dir = path.resolve(dir);
  const { files } = await plan(dir, log);
  const changed = Object.keys(files).filter(rel => read(dir, rel) !== files[rel]);
  if (!check) for (const rel of changed) fs.writeFileSync(path.join(dir, rel), files[rel]);
  let list = null;
  if (shell && fs.existsSync(path.join(dir, 'app/public/sw.js'))) {
    const nm = path.join(dir, 'node_modules');
    try {
      list = writeShell({ dir: path.join(dir, 'app'), sync: path.join(nm, 'app-sync'), ui: path.join(nm, 'app-ui'), check });
    } catch (e) {
      if (check) changed.push(`app/public/sw.js (${/** @type {Error} */ (e).message})`);
      else throw e;
    }
  }
  if (check && changed.length) throw new Error(`out of date: ${changed.join(', ')}; run node tools/modules.mjs`);
  return { changed, shell: list };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const a = process.argv.slice(2);
  const check = a.includes('--check'), dir = a.includes('--dir') ? a[a.indexOf('--dir') + 1] : '.';
  const bad = a.find((x, i) => !['--check', '--dir'].includes(x) && a[i - 1] !== '--dir');
  try {
    if (bad) throw new Error(`unknown argument ${bad}`);
    const r = await run({ dir, check });
    console.log(check ? 'modules: up to date' : `modules: ${r.changed.length ? `wrote ${r.changed.join(', ')}` : 'nothing to change'}${r.shell ? `; sw.js SHELL ${r.shell.length} files` : ''}`);
  } catch (e) { console.error(`modules: ${/** @type {Error} */ (e).message}`); process.exit(1); }
}
