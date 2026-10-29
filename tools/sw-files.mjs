// The service worker's file list (SHELL in sw.js), generated: never edit it by hand. It holds
//   - the page ('./') and every file of the app folder the page can load: src/ (or a build's assets/), and public/ as
//     served at the folder's root (vendored Firebase included); never tests, rules, types or sw.js itself
//   - every file each @core/* entry in the page's import map loads: the entry and its static imports, read from the
//     package at the same version (node_modules/app-sync or node_modules/app-ui, the devDependencies; the version must
//     match): core.anawj.com/sync/<v>/ is app-sync, core.anawj.com/ui/<v>/ is app-ui
//   - app-ui's style sheets and scripts the page links (<link rel="stylesheet">, <script src>), as they are
//   - any other https:// address in the import map, as it is (app-update's register.js)
// The same command lists a Vite build (dist/): the port to Vite changes only the folder this runs on.
//   node tools/sw-files.mjs <dir> [--sw sw.js] [--sync <app-sync dir>] [--ui <app-ui dir>]   write SHELL into <dir>'s sw.js
//   node tools/sw-files.mjs <dir> --check                                fail if SHELL is out of date (CI)
// Then the deploy stamps VERSION and MANIFEST (tools/stamp-versions.mjs), as before.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SYNC = /^https:\/\/core\.anawj\.com\/sync\/(\d+\.\d+\.\d+[^/]*)\/(.+)$/;
const UI = /^https:\/\/core\.anawj\.com\/ui\/(\d+\.\d+\.\d+[^/]*)\/(.+)$/;
// files in the app folder that are never served to the page (the Worker's .assetsignore leaves them out too)
const SKIP = [/(^|\/)\./, /^test\//, /\.rules$/, /^firebase\.json$/, /\.d\.ts$/, /(^|\/)sw\.js$/, /\.(map|log)$/];

const posix = p => p.split(path.sep).join('/');
function walk(dir, rel = '') {
  const out = [];
  for (const e of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...walk(dir, r)); else out.push(r);
  }
  return out;
}

// the page's import map -> { name: address }
export function importMap(html) {
  const m = html.match(/<script type="importmap">([\s\S]*?)<\/script>/);
  return m ? JSON.parse(m[1]).imports || {} : {};
}

// relative static imports of one file (comments dropped, so JSDoc `import('./types.js')` never counts)
function importsOf(src, file) {
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"\\])\/\/.*$/gm, '$1');
  const out = [];
  for (const m of code.matchAll(/(?:^|[;\s}])(?:import|export)\s*(?:[\w*{}\s,$]*?\sfrom\s*)?['"]([^'"]+)['"]/g)) {
    if (!m[1].startsWith('.')) throw new Error(`${file} imports '${m[1]}': only relative imports can be listed`);
    out.push(m[1]);
  }
  return out;
}

// the page's linked style sheets and classic scripts -> their addresses
export function pageLinks(html) {
  const out = [];
  for (const m of html.matchAll(/<link\b[^>]*>/g)) if (/\brel="stylesheet"/.test(m[0])) out.push((m[0].match(/\bhref="([^"]+)"/) || [])[1]);
  for (const m of html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"/g)) out.push(m[1]);
  return out.filter(Boolean);
}

// the entry and everything it imports, depth first, each once -> paths inside the package (pkg: its name, for errors)
function graph(pkg, root, entry, seen) {
  if (seen.has(entry)) return [];
  seen.add(entry);
  const file = path.join(root, entry);
  if (!fs.existsSync(file)) throw new Error(`${pkg} has no ${entry} (in ${root})`);
  const out = [entry];
  if (!entry.endsWith('.js')) return out;
  for (const imp of importsOf(fs.readFileSync(file, 'utf8'), entry)) out.push(...graph(pkg, root, path.posix.join(path.posix.dirname(entry), imp), seen));
  return out;
}

// every file the core addresses (of one package, re: its address) load -> full addresses, each once
function coreFiles(pkg, root, re, addresses) {
  const out = [], seen = new Set();
  if (!addresses.length) return out;
  const have = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
  for (const u of addresses) {
    const [, v, entry] = u.match(re);
    if (v !== have) throw new Error(`the page pins ${pkg} ${v}, but ${root} is ${have} (bump the devDependency with the import map)`);
    for (const f of graph(pkg, root, entry, seen)) out.push(u.slice(0, u.length - entry.length) + f);
  }
  return out;
}

// -> the SHELL list for app folder <dir> (sync, ui: the app-sync and app-ui packages; default: the devDependencies)
export function shellFiles({ dir, sync = path.join(ROOT, 'node_modules/app-sync'), ui = path.join(ROOT, 'node_modules/app-ui') }) {
  const html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
  const own = walk(dir).filter(f => f !== 'index.html' && !SKIP.some(re => re.test(f))).map(f => f.replace(/^public\//, '').replace(/(^|\/)index\.html$/, '$1')).sort();   // a sub-page by its folder: the service worker answers a page by its folder, never index.html
  const map = Object.values(importMap(html));
  for (const u of map) {
    if (/^(\.\/|\/|[^:]+$)/.test(u) && !own.includes(u.replace(/^\.?\//, ''))) throw new Error(`the import map names ${u}, but ${dir} has no such file`);
  }
  const other = map.filter(u => /^https?:\/\//.test(u) && !SYNC.test(u) && !UI.test(u)).sort();
  const core = coreFiles('app-sync', sync, SYNC, map.filter(u => SYNC.test(u)));
  const uiFiles = coreFiles('app-ui', ui, UI, [...map, ...pageLinks(html)].filter(u => UI.test(u)));
  return ['./', ...own, ...other, ...core, ...uiFiles];
}

const block = list => `const SHELL = [\n${list.map(u => `  '${u}',\n`).join('')}];`;
const swOf = (dir, sw) => { const f = path.join(dir, sw); return fs.existsSync(f) ? f : path.join(dir, 'public', sw); };

// writes SHELL into sw.js; check: only say whether it is up to date (throws if not)
export function writeShell({ dir, sw = 'sw.js', sync, ui, check = false }) {
  const file = swOf(dir, sw);
  const src = fs.readFileSync(file, 'utf8');
  if (!/const SHELL = \[[\s\S]*?\];/.test(src)) throw new Error(`${sw}: no SHELL list`);
  const list = shellFiles({ dir, sync, ui });
  const next = src.replace(/const SHELL = \[[\s\S]*?\];/, () => block(list));
  if (check) {
    if (next !== src) throw new Error(`${sw}: SHELL is out of date; run node tools/sw-files.mjs ${posix(path.relative(ROOT, dir)) || '.'}`);
  } else fs.writeFileSync(file, next);
  return list;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const a = process.argv.slice(2);
  const opt = n => (a.includes(n) ? a[a.indexOf(n) + 1] : undefined);
  const dir = a.find((x, i) => !x.startsWith('--') && !['--sw', '--sync', '--ui'].includes(a[i - 1])) || 'app';
  const at = n => opt(n) && path.resolve(opt(n));
  try {
    const list = writeShell({ dir: path.resolve(dir), sw: opt('--sw'), sync: at('--sync'), ui: at('--ui'), check: a.includes('--check') });
    console.log(`sw-files: ${a.includes('--check') ? 'up to date' : 'written'} (${list.length} files)`);
  } catch (e) { console.error('sw-files: ' + e.message); process.exit(1); }
}
