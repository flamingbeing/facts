// The template's flavours (README, "Pick a starter"): the cloud app is the template as it is; a flavour is the same
// template with the cloud parts taken out and a few files of its own put in, rendered from a spec in flavours/.
//
//   node tools/flavour.mjs static [--dir <app>] [--dry-run]   render the app in place (tools/fill.mjs --static runs it)
//
// A spec (flavours/static.json, the only one) is JSON with these fields, every one optional but "flavour":
//   flavour     the name .starter.json "flavour" records
//   remove      paths taken out (a folder takes everything under it)
//   root        a folder that mirrors the app: every file under it is put at the same path (replacing the template's)
//   modules     { name: entry | null } set in or taken out of modules.json's "imports" (tools/modules.mjs), and the
//               import map, tsconfig paths and Vite alias written from it (a tree from before modules.json reads
//               importMap { name: url | null } and tsconfigPaths { name: [path] } and edits those places itself)
//   json        { file: [dotted keys] } taken out of a JSON file (package.json scripts)
// and in every text file the lines from a `cloud{` mark to its `}cloud` mark (a comment of the file's kind:
// `// cloud{`, `# cloud{`, `<!-- cloud{ -->`; the rest of the line is free) are taken out, marks included, and the
// lines of a static block, a comment in the template (`/* static{` ... `}static */`, `<!-- static{` ... `}static -->`),
// are put in without its marks. The marks stay in a cloud app, where they show what a static app does differently.
//
// Rendering is pure (files in, files out), so tools/update-from-starter.mjs renders both template commits the same way
// and a static app keeps taking the template's changes; `node tools/add.mjs cloud` merges the static render into the
// cloud one, which turns a static app into a cloud app.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { editImportMap, putLine } from './add.mjs';
import { MANIFEST, applyEdits, formatManifest, generate } from './modules.mjs';

export const FLAVOURS = ['static'];
const OPEN = /^\s*(?:\/\/|#|<!--)\s*cloud\{/;
const CLOSE = /^\s*(?:\/\/|#|<!--)\s*\}cloud/;
const OPEN_STATIC = /^\s*(?:\/\*|<!--)\s*static\{/;
const CLOSE_STATIC = /^\s*\}static\s*(?:\*\/|-->)/;
const TEXT = /\.(m?js|json|jsonc|html|css|md|webmanifest|rules|ya?ml|svg|txt|sh|toml)$|^\.[a-z]+ignore$/;
const SKIP_DIRS = new Set(['.git', 'node_modules', '.devkit', 'test-results', 'playwright-report', 'dist']);
export const specPath = flavour => `flavours/${flavour}.json`;

/** text without its cloud{ ... }cloud regions and with its static blocks put in; throws on a mark without its pair
 * (rel: for the message) */
export function strip(text, rel = '') {
  if (!/cloud|static/.test(text)) return text;
  const out = [];
  /** @type {{ kind: string, at: number } | null} */
  let open = null;
  text.split('\n').forEach((line, i) => {
    const kind = OPEN.test(line) ? 'cloud' : OPEN_STATIC.test(line) ? 'static' : null;
    if (kind) { if (open) throw new Error(`${rel}:${i + 1}: ${kind}{ inside ${open.kind}{`); open = { kind, at: i + 1 }; return; }
    const end = CLOSE.test(line) ? 'cloud' : CLOSE_STATIC.test(line) ? 'static' : null;
    if (end) { if (open?.kind !== end) throw new Error(`${rel}:${i + 1}: }${end} without ${end}{`); open = null; return; }
    if (open?.kind !== 'cloud') out.push(line);
  });
  if (open) throw new Error(`${rel}:${open.at}: ${open.kind}{ without }${open.kind}`);
  return out.join('\n');
}

const under = (rel, p) => rel === p || rel.startsWith(p.replace(/\/?$/, '/'));
/** obj without the dotted key */
function dropKey(obj, key) {
  const parts = key.split('.'), last = parts.pop();
  let o = obj;
  for (const p of parts) { o = o?.[p]; if (!o) return; }
  delete o[last];
}

/**
 * The template's files rendered as a flavour: { rel: Buffer } -> { rel: Buffer } (the input is not changed). The spec
 * is the tree's own flavours/<flavour>.json; a tree without it (a template commit from before flavours) throws.
 * @param {Record<string, Buffer>} files
 * @param {string} flavour
 */
export function render(files, flavour) {
  const specBuf = files[specPath(flavour)];
  if (!specBuf) throw new Error(`no ${specPath(flavour)} in this template commit`);
  const spec = JSON.parse(specBuf.toString('utf8'));
  const root = spec.root ? spec.root.replace(/\/?$/, '/') : null;
  /** @type {Record<string, Buffer>} */
  const out = {};
  for (const [rel, buf] of Object.entries(files)) {
    if (rel.startsWith('flavours/') || (spec.remove ?? []).some(p => under(rel, p))) continue;
    out[rel] = isText(rel) ? Buffer.from(strip(buf.toString('utf8'), rel)) : buf;
  }
  if (root) for (const [rel, buf] of Object.entries(files)) if (rel.startsWith(root)) out[rel.slice(root.length)] = buf;
  const edit = (rel, fn) => { if (!out[rel]) throw new Error(`${spec.flavour}: no ${rel} to edit`); out[rel] = Buffer.from(fn(out[rel].toString('utf8'))); };
  if (out[MANIFEST] && (spec.modules || spec.importMap || spec.tsconfigPaths)) {
    const manifest = applyEdits(JSON.parse(out[MANIFEST].toString('utf8')), spec);
    out[MANIFEST] = Buffer.from(formatManifest(manifest));
    const text = rel => out[rel]?.toString('utf8');
    const g = generate(manifest, text('package.json') ?? '{}', { html: text('app/index.html') ?? '', tsconfig: text('tsconfig.json'), vite: text('vite.config.mjs') });
    out['app/index.html'] = Buffer.from(g.html);
    if (g.tsconfig != null) out['tsconfig.json'] = Buffer.from(g.tsconfig);
    if (g.vite != null) out['vite.config.mjs'] = Buffer.from(g.vite);
  } else {
    if (spec.importMap) edit('app/index.html', html => editImportMap(html, spec.importMap));
    for (const [name, paths] of Object.entries(spec.tsconfigPaths ?? {}))
      edit('tsconfig.json', t => putLine(t, '"paths": {', `      ${JSON.stringify(name)}: ${JSON.stringify(paths)},`, `${JSON.stringify(name)}:`));
  }
  for (const [rel, keys] of Object.entries(spec.json ?? {})) edit(rel, t => {
    const j = JSON.parse(t);
    for (const k of keys) dropKey(j, k);
    return JSON.stringify(j, null, 2) + '\n';
  });
  return out;
}
export const isText = rel => TEXT.test(rel.split('/').pop());

/** every file of an app folder: { rel: Buffer } (not .git, node_modules, .devkit or test output) */
export function readTree(dir, rel = '', out = {}) {
  for (const e of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) readTree(dir, r, out); }
    else if (e.isFile()) out[r] = fs.readFileSync(path.join(dir, r));
  }
  return out;
}

/** renders the app folder in place and records the flavour in .starter.json -> { removed, written } */
export function renderDir({ dir = '.', flavour, dryRun = false, log = () => {} } = {}) {
  if (!FLAVOURS.includes(flavour)) throw new Error(`no flavour ${flavour} (${FLAVOURS.join(', ')})`);
  dir = path.resolve(dir);
  const metaPath = path.join(dir, '.starter.json');
  const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
  if (meta.flavour) throw new Error(`this app is already ${meta.flavour}`);
  if (meta.modules?.files) throw new Error('the files module needs the cloud (its Worker routes and rules): take it out first (node tools/add.mjs --remove files)');
  const before = readTree(dir);
  const after = render(before, flavour);
  const removed = Object.keys(before).filter(rel => !(rel in after));
  const written = Object.keys(after).filter(rel => !before[rel]?.equals(after[rel]));
  if (!dryRun) {
    for (const rel of removed) fs.rmSync(path.join(dir, rel));
    pruneEmpty(dir, removed);
    for (const rel of written) { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), after[rel]); }
    fs.writeFileSync(metaPath, JSON.stringify({ ...meta, flavour }, null, 2) + '\n');
  }
  log(`${flavour}: ${removed.length} removed, ${written.length} written`);
  return { removed, written };
}
// the folders the removed files leave empty
function pruneEmpty(dir, removed) {
  const dirs = [...new Set(removed.map(r => path.dirname(r)).filter(d => d !== '.'))].sort((a, b) => b.length - a.length);
  for (let d of dirs) {
    while (d !== '.') {
      const p = path.join(dir, d);
      if (!fs.existsSync(p) || fs.readdirSync(p).length) break;
      fs.rmdirSync(p);
      d = path.dirname(d);
    }
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const argv = process.argv.slice(2), o = { flavour: '', dir: '.', dryRun: false, log: console.log };
    for (let i = 0; i < argv.length; i++) {
      if (argv[i] === '--dir') o.dir = argv[++i];
      else if (argv[i] === '--dry-run') o.dryRun = true;
      else if (!argv[i].startsWith('--') && !o.flavour) o.flavour = argv[i];
      else throw new Error(`unknown argument ${argv[i]}`);
    }
    renderDir(o);
  } catch (e) {
    console.error(`flavour: ${/** @type {Error} */ (e).message}`);
    process.exit(2);
  }
}
