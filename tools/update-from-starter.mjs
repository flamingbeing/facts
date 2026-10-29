// Brings the template's newer commits into an app made from it, and does the steps an app-sync bump needs, in one go.
//
//   node tools/update-from-starter.mjs [--dir <app>] [--from <template checkout or git URL>] [--to <ref>] [--base <sha>]
//                                      [--find-base] [--dry-run] [--no-install]
//   node tools/update-from-starter.mjs --sync <x.y.z[-rc.N]> [--dir <app>] [--dry-run]   only bump app-sync (names, lock, e2e core fixtures)
//   node tools/update-from-starter.mjs --behind [<n>] [--dir <app>]               how far behind; exit 1 when over n
//   node tools/update-from-starter.mjs --refresh [--dir <app>]                     only sw.js SHELL and the CSP hash
//
// Run it with the template's own copy (a checkout of the template's main) when the app has none yet:
//   node <template>/tools/update-from-starter.mjs --dir <app> --from <template>
//
// How: an app made with "Use this template" shares no git history with the template, so this is a three-way merge
// per file, not a git merge, and never rewrites the app's history. The base is the template commit the app started
// from or last updated to (.starter.json "commit"; --find-base picks the template commit closest to the app when it is
// empty); both template versions get the app's own values first (fill.mjs's
// swaps), so the only differences left are real changes. For every file the template changed between the base and
// --to: added -> added (an app file of the same name is merged as if from an empty base), deleted -> deleted unless the
// app changed it (a file now in a module's recipe is kept and the module recorded in .starter.json "modules"), changed -> `git merge-file` with the app's copy (a template rename is a delete plus an add) (conflicts left as <<<<<<< markers, listed at the end).
// Generated parts never conflict: sw.js's SHELL list, worker/headers.js's import-map hash, the import map, tsconfig
// paths, Vite aliases (from modules.json, merged three-way like any file) and package-lock.json are kept from the app
// and regenerated afterwards.
//
// Afterwards (not with --dry-run): app-sync's two version names checked (app/index.html's import map, package.json's
// devDependency), `npm install` when package.json changed (the lock), `node tools/modules.mjs` (everything made from
// modules.json: the import map, paths, aliases, sw.js's list, the CSP hash and the rules), app-devkit's pins in .github/workflows compared with the template's
// and the newest app-devkit tag, and .starter.json's "commit" moved to --to. Then run the tests and commit.
//
// .starter.json may hold { "update": { "ignore": ["<glob>", ...], "rename": { "<template path>": "<app path>" } } }:
// ignored files are never touched (on top of DEFAULT_IGNORE); renamed ones are merged into the app's own path.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { swapsFor, fixup, isText } from './fill.mjs';
import { render } from './flavour.mjs';
import { importMapHash, manifestFrom, formatManifest, MANIFEST } from './modules.mjs';

// the app's own: its notes, settings and the lock (regenerated)
// (recipes/<module>/ are the modules' sources: an app reads them from the template when it adds one, tools/add.mjs)
export const DEFAULT_IGNORE = ['.starter.json', 'app/src/config.js', 'STATUS.md', 'NOTES.md', 'package-lock.json', 'recipes/*/**'];
const SHELL_RE = /const SHELL = \[[\s\S]*?\];/;
const HASH_RE = /(export const IMPORT_MAP = )"'sha256-[A-Za-z0-9+/=]+'"/;
const SYNC_URL = /(https:\/\/core\.anawj\.com\/sync\/)(\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?)\//g;
const SYNC_DEP = /("app-sync":\s*"github:flamingbeing\/app-sync#v)(\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?)(")/;
const PIN_RE = /flamingbeing\/app-devkit\/([\w./-]+?)@(v\d+\.\d+\.\d+)|devkit-ref:\s*(v\d+\.\d+\.\d+)/g;

const defaultExec = (cmd, args, cwd) => execFileSync(cmd, args, { cwd, stdio: 'inherit' });
const git = (cwd, args, opts = {}) => execFileSync('git', ['-C', cwd, '-c', 'core.quotePath=false', ...args], { encoding: 'utf8', maxBuffer: 64 << 20, ...opts });

// '<glob>' -> RegExp: ** any folders, * anything but /, ? one character
export function globRe(glob) {
  const re = glob.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*\/?|\*|\?/g, m => m === '?' ? '[^/]' : m === '*' ? '[^/]*' : '(?:.*/)?');
  return new RegExp(`^${re.replace(/\(\?:\.\*\/\)\?$/, '.*')}$`);
}

// the CSP hash of the page's one inline script (the import map), as worker/headers.js names it
export { importMapHash };

// app-sync's version as the import map and package.json name it
export function syncVersions(html, pkg) {
  return { map: [...new Set([...html.matchAll(SYNC_URL)].map(m => m[2]))], dep: pkg.match(SYNC_DEP)?.[2] ?? null };
}
export const bumpSync = (html, pkg, v) => ({ html: html.replace(SYNC_URL, `$1${v}/`), pkg: pkg.replace(SYNC_DEP, `$1${v}$3`) });

// app-devkit's pins in a set of workflow files -> ['checks.yml: setup-node@v1.9.2', ...] as { file, what, ver }
export function devkitPins(files) {
  const out = [];
  for (const [file, text] of Object.entries(files))
    for (const m of text.matchAll(PIN_RE)) out.push({ file, what: m[1] ?? 'devkit-ref', ver: m[2] ?? m[3] });
  return out;
}
const semver = v => v.replace(/^v/, '').split('.').map(Number);
export const older = (a, b) => { const [x, y] = [semver(a), semver(b)]; for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] < y[i]; return false; };

// one three-way merge: { text, conflicts } (git merge-file, the app's side first)
export function merge3(ours, base, theirs, labels = ['app', 'template (base)', 'template (new)']) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'update-'));
  try {
    const [o, b, t] = ['ours', 'base', 'theirs'].map((n, i) => { const p = path.join(tmp, n); fs.writeFileSync(p, [ours, base, theirs][i]); return p; });
    const r = spawnSync('git', ['merge-file', '-p', '-L', labels[0], '-L', labels[1], '-L', labels[2], o, b, t], { encoding: 'utf8', maxBuffer: 64 << 20 });
    if (r.status < 0 || r.status === null || r.status > 127) throw new Error(`git merge-file failed: ${r.stderr}`);
    return { text: r.stdout, conflicts: r.status };
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}

// generated parts: swapped for a placeholder before the merge, the app's own put back after (then regenerated)
// (and once the template has modules.json, the parts tools/modules.mjs writes from it: the import map, tsconfig paths,
// SOURCE_ALIAS; the merge of modules.json itself carries both sides' modules, and after() writes them again)
const GENERATED = {
  'app/index.html': [/(<script type="importmap">\n)[\s\S]*?(\n\s*<\/script>)/, '{"generated": true}'],
  'tsconfig.json': [/("paths":\s*\{\n)[\s\S]*?(\n\s*\})/, '      "generated": []'],
  'vite.config.mjs': [/(export const SOURCE_ALIAS = \{\n)[\s\S]*?(\};)/, '  // generated\n'],
};
function hold(rel, text, generated = false) {
  if (rel.endsWith('sw.js')) return text.replace(SHELL_RE, 'const SHELL = [/*generated*/];');
  if (rel === 'worker/headers.js') return text.replace(HASH_RE, `$1"'sha256-generated'"`);
  if (generated && GENERATED[rel]) return text.replace(GENERATED[rel][0], (_, a, c) => a + GENERATED[rel][1] + c);
  return text;
}
function putBack(rel, merged, ours, generated = false) {
  if (rel.endsWith('sw.js') && SHELL_RE.test(ours)) return merged.replace('const SHELL = [/*generated*/];', () => ours.match(SHELL_RE)[0]);
  if (rel === 'worker/headers.js' && HASH_RE.test(ours)) return merged.replace(/export const IMPORT_MAP = "'sha256-generated'"/, () => ours.match(HASH_RE)[0]);
  if (generated && GENERATED[rel]) { const [re, ph] = GENERATED[rel], m = ours.match(re); if (m) return merged.replace(re, (all, a, c) => all.includes(ph) ? m[0] : all); }
  return merged;
}

// the template as a git repo: a local checkout, or a blobless clone of a URL
export function templateRepo(from) {
  if (fs.existsSync(path.join(from, '.git')) || fs.existsSync(path.join(from, 'HEAD'))) return { dir: from, done() {} };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'template-'));
  git(dir, ['clone', '-q', '--filter=blob:none', '--no-checkout', from, '.'], { stdio: ['ignore', 'pipe', 'pipe'] });
  return { dir, done: () => fs.rmSync(dir, { recursive: true, force: true }) };
}
export const show = (repo, ref, rel) => { try { return execFileSync('git', ['-C', repo, 'show', `${ref}:${rel}`], { maxBuffer: 64 << 20, stdio: ['ignore', 'pipe', 'ignore'] }); } catch { return null; } };

// every file of a template commit, read in one go: { path: Buffer }
export function treeAt(repo, ref) {
  const paths = git(repo, ['ls-tree', '-r', '-z', '--name-only', ref]).split('\0').filter(Boolean);
  const out = execFileSync('git', ['-C', repo, 'cat-file', '--batch'], { input: paths.map(p => `${ref}:${p}\n`).join(''), maxBuffer: 256 << 20 });
  const files = {};
  let at = 0;
  for (const p of paths) {
    const nl = out.indexOf(10, at);
    const size = Number(out.subarray(at, nl).toString().split(' ')[2]);
    files[p] = out.subarray(nl + 1, nl + 1 + size);
    at = nl + 1 + size + 1;
  }
  return files;
}

// the template commit (of the last `limit` before `to`) whose files, with the app's values, match most of the app's
// files: for an app whose .starter.json has no "commit" (a flavoured app's: rendered as its flavour)
export function findBase(repo, to, meta, dir, { limit = 200 } = {}) {
  const shas = git(repo, ['rev-list', `--max-count=${limit}`, to]).trim().split('\n');
  let best = null;
  for (const sha of shas) {
    let files = treeAt(repo, sha);
    if (meta.flavour) try { files = render(files, meta.flavour); } catch { break; }   // a commit from before flavours (and every older one)
    const tpl = JSON.parse(files['.starter.json']?.toString() || 'null')?.app ?? meta.app;
    const swaps = swapsFor(tpl, meta.app);
    let same = 0;
    for (const [rel, buf] of Object.entries(files)) {
      let ours; try { ours = fs.readFileSync(path.join(dir, rel)); } catch { continue; }
      let t = buf;
      if (isText(rel)) { let x = buf.toString('utf8'); for (const [re, v] of swaps) x = x.replace(re, v); t = Buffer.from(fixup(rel, x, meta.app)); }
      if (ours.equals(t)) same++;
    }
    if (!best || same > best.same) best = { sha, same, of: Object.keys(files).length };
  }
  return best;
}

// git diff --name-status of two rendered trees ({ rel: Buffer })
export function renderedDiff(a, b) {
  return [...new Set([...Object.keys(a), ...Object.keys(b)])].sort()
    .flatMap(rel => !a[rel] ? [`A\t${rel}`] : !b[rel] ? [`D\t${rel}`] : a[rel].equals(b[rel]) ? [] : [`M\t${rel}`]).join('\n');
}

// -> { from, to, behind, changes: [{ action, path, note? }], conflicts: [paths], pins: [...] }
// unflavour { project }: the template's cloud files instead of its flavour's (tools/add.mjs cloud: a static app made the
// cloud app, from the static render at its commit to the cloud tree at `to`); .starter.json loses "flavour"
export function update({ dir = '.', from, to = 'main', base, dryRun = false, install = true, checkLatest = true, findBase: findBaseToo = false, unflavour = null, log = console.log } = {}) {
  dir = path.resolve(dir);
  const metaPath = path.join(dir, '.starter.json');
  const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
  const repo = templateRepo(from ?? `https://github.com/${meta.template}`);
  try {
    const ref = (r) => git(repo.dir, ['rev-parse', '--verify', `${r}^{commit}`]).trim();
    let newSha;
    try { newSha = ref(to); } catch { newSha = ref(`origin/${to}`); }
    let baseRef = base ?? meta.commit;
    if (!baseRef && findBaseToo) {
      const b = findBase(repo.dir, newSha, meta, dir);
      log(`base: ${b.sha.slice(0, 7)} (found: ${b.same} of its ${b.of} files match the app's)`);
      baseRef = b.sha;
    }
    if (!baseRef) throw new Error('.starter.json has no "commit" (the template commit the app started from); pass --base <sha> or --find-base');
    const baseSha = ref(baseRef);
    const behind = Number(git(repo.dir, ['rev-list', '--count', `${baseSha}..${newSha}`]).trim());
    const short = newSha.slice(0, 7);
    const result = { from: baseSha.slice(0, 7), to: short, behind, changes: [], conflicts: [], pins: [] };
    log(`template ${meta.template}: ${result.from} -> ${short} (${behind} commit${behind === 1 ? '' : 's'})`);

    // a flavoured app (static) takes the template's commits rendered as its flavour (tools/flavour.mjs), so it gets
    // the changes to its own files and none of the cloud's
    const oldF = meta.flavour ?? null, newF = unflavour ? null : oldF;
    const appNew = unflavour ? { ...meta.app, project: unflavour.project } : meta.app;
    const trees = new Map();
    const treeOf = (sha, f) => trees.get(`${sha}:${f}`) ?? trees.set(`${sha}:${f}`, f ? render(treeAt(repo.dir, sha), f) : treeAt(repo.dir, sha)).get(`${sha}:${f}`);
    const at = (sha, rel, f = newF) => f ? treeOf(sha, f)[rel] ?? null : show(repo.dir, sha, rel);
    const listAt = (sha, folder) => newF
      ? Object.keys(treeOf(sha, newF)).filter(r => r.startsWith(`${folder}/`) && !r.slice(folder.length + 1).includes('/')).map(r => r.slice(folder.length + 1))
      : git(repo.dir, ['ls-tree', '--name-only', `${sha}:${folder}`], { stdio: ['ignore', 'pipe', 'ignore'] }).trim().split('\n').filter(Boolean);
    const tplApp = r => JSON.parse(at(r, '.starter.json')?.toString() || 'null')?.app;
    const swapsBase = swapsFor(tplApp(baseSha) ?? meta.app, meta.app);
    const swapsNew = swapsFor(tplApp(newSha) ?? meta.app, appNew);
    const filled = (rel, buf, swaps, app = meta.app) => {
      if (buf === null || !isText(rel)) return buf;
      let text = buf.toString('utf8');
      for (const [re, v] of swaps) text = text.replace(re, v);
      return Buffer.from(fixup(rel, text, app));
    };
    // (the move to the cloud brings the recipes' sources the static render left out: files)
    const ignore = [...DEFAULT_IGNORE.filter(g => !(unflavour && g.startsWith('recipes/'))), ...(meta.update?.ignore ?? [])].map(globRe);
    const rename = meta.update?.rename ?? {};
    const appPath = rel => rename[rel] ?? rel;
    const read = rel => { try { return fs.readFileSync(path.join(dir, rel)); } catch { return null; } };
    const write = (rel, buf) => { if (dryRun) return; fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), buf); };
    const remove = rel => { if (!dryRun) fs.rmSync(path.join(dir, rel), { force: true }); };
    const note = (action, p, extra) => { result.changes.push({ action, path: p, ...(extra ? { note: extra } : {}) }); log(`  ${action.padEnd(9)} ${p}${extra ? `  (${extra})` : ''}`); };

    // files the template moved out of the base into a module's recipe: the app that has them keeps them (it already
    // has the module) and the module is recorded, so a later update takes the recipe's changes
    const owned = [];
    let recipeFiles = [];
    try { recipeFiles = listAt(newSha, 'recipes').map(f => `recipes/${f}`).filter(f => /^recipes\/[^/]+\.json$/.test(f)); } catch { /* none */ }
    for (const f of recipeFiles) {
      let r;
      try { r = JSON.parse(at(newSha, f).toString()); } catch { continue; }
      for (const p of [...(r.vendor ?? []), ...(r.files ?? []).filter(x => x.from).map(x => x.to ?? x.from)]) owned.push({ module: r.module, path: p, recipe: f });
    }
    const moved = new Map();
    // the template names its modules in modules.json: the generated parts are held out of the merge and written again
    const generated = !!at(newSha, MANIFEST);
    // an app from before modules.json: its own list, read from its import map, merged with the template's
    const manifestOf = get => {
      const html = get('app/index.html');
      return html ? Buffer.from(formatManifest(manifestFrom({ html: html.toString('utf8'), tsconfig: get('tsconfig.json')?.toString('utf8'), vite: get('vite.config.mjs')?.toString('utf8') }))) : null;
    };

    // -z: a path with non-ASCII characters, a quote or a newline is otherwise printed quoted and never found again
    const gitDiff = () => { const z = git(repo.dir, ['diff', '--name-status', '-z', '--no-renames', baseSha, newSha]).split('\0').filter(Boolean); return z.filter((_, i) => i % 2 === 0).map((st, i) => `${st}\t${z[2 * i + 1]}`).join('\n'); };
    const diff = oldF || newF ? renderedDiff(treeOf(baseSha, oldF), treeOf(newSha, newF)) : gitDiff();
    for (const line of diff ? diff.split('\n') : []) {
      const [status, rel] = line.split('\t');
      const target = appPath(rel);
      if (ignore.some(re => re.test(rel) || re.test(target))) { note('ignored', target); continue; }
      const oldT = filled(rel, at(baseSha, rel, oldF), swapsBase);
      const newT = filled(rel, at(newSha, rel), swapsNew, appNew);
      let ours = read(target);
      if (rel === MANIFEST && ours === null && oldT === null && status === 'A') {
        ours = manifestOf(read);
        const base = manifestOf(r => filled(r, at(baseSha, r, oldF), swapsBase));
        if (ours && base && !ours.equals(base)) {
          const m = merge3(ours.toString('utf8'), base.toString('utf8'), newT.toString('utf8'), ['app', `template ${result.from}`, `template ${short}`]);
          write(target, m.text);
          if (m.conflicts) { result.conflicts.push(target); note('conflict', target, `${m.conflicts} to resolve`); } else note('merged', target, 'with the app\'s own modules');
          continue;
        }
        ours = null;
      }
      if (status === 'D') {
        if (ours === null) continue;
        const own = owned.find(o => rel === o.path || rel.startsWith(`${o.path}/`));
        if (own) { moved.set(own.module, own.recipe); note('kept', target, `now the ${own.module} recipe's: ${own.recipe}`); continue; }
        if (oldT && ours.equals(oldT)) { remove(target); note('deleted', target); }
        else note('kept', target, 'the template deleted it; the app changed it');
        continue;
      }
      if (ours === null) {
        if (status === 'M' && oldT) { note('kept', target, 'the app deleted it; the template changed it'); continue; }
        write(target, newT); note('added', target); continue;
      }
      // .ts and the template-owned .mjs files (fill's KEEP) merge as text too; they only skip fill's swaps
      const textual = isText(rel) || /\.(m?js|ts)$/.test(rel);
      // a checkout with CRLF line endings (Windows autocrlf) against the template's LF: compare and merge as LF, write back CRLF
      const crlf = textual && /\r\n/.test(ours.toString('utf8')) && !/(^|[^\r])\n/.test(ours.toString('utf8')) && !/\r\n/.test(newT.toString('utf8'));   // all CRLF: a file with mixed endings is left as it is
      const lf = t => crlf ? t.replace(/\r\n/g, '\n') : t;
      const toApp = t => crlf ? t.replace(/\r?\n/g, '\r\n') : t;
      const o = lf(ours.toString('utf8'));
      if (ours.equals(newT) || (crlf && o === newT.toString('utf8'))) continue;
      if (oldT && (ours.equals(oldT) || (crlf && o === oldT.toString('utf8')))) { write(target, crlf ? Buffer.from(toApp(newT.toString('utf8'))) : newT); note('updated', target); continue; }
      if (!textual) { result.conflicts.push(target); note('conflict', target, 'binary, changed on both sides: the app\'s kept'); continue; }
      const m = merge3(hold(rel, o, generated), hold(rel, lf((oldT ?? Buffer.from('')).toString('utf8')), generated), hold(rel, newT.toString('utf8'), generated),
        ['app', `template ${result.from}`, `template ${short}`]);
      const text = toApp(putBack(rel, m.text, o, generated));
      if (text === ours.toString('utf8')) continue;
      write(target, text);
      if (m.conflicts) { result.conflicts.push(target); note('conflict', target, `${m.conflicts} to resolve`); }
      else note('merged', target);
    }
    if (!result.changes.some(c => c.action !== 'ignored')) log('  nothing to bring in');

    // app-devkit's pins: the app's against the template's and the newest tag
    const wf = d => Object.fromEntries((fs.existsSync(d) ? fs.readdirSync(d) : []).filter(f => /\.ya?ml$/.test(f)).map(f => [f, fs.readFileSync(path.join(d, f), 'utf8')]));
    const appPins = devkitPins(wf(path.join(dir, '.github/workflows')));
    const tplWf = {};
    let wfNames = [];
    try { wfNames = listAt(newSha, '.github/workflows'); } catch { /* none */ }
    for (const f of wfNames) tplWf[f] = at(newSha, `.github/workflows/${f}`).toString();
    const tplPins = devkitPins(tplWf);
    let latest = null;
    if (checkLatest) try {
      const tags = execFileSync('git', ['ls-remote', '--tags', '--refs', 'https://github.com/flamingbeing/app-devkit'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 20000 });
      latest = tags.split('\n').map(l => l.split('refs/tags/')[1]).filter(t => /^v\d+\.\d+\.\d+$/.test(t ?? '')).sort((a, b) => older(a, b) ? -1 : 1).pop() ?? null;
    } catch { /* offline: compare with the template only */ }
    for (const p of appPins) {
      const t = tplPins.find(x => x.file === p.file && x.what === p.what);
      const why = [t && older(p.ver, t.ver) && `template has ${t.ver}`, latest && older(p.ver, latest) && `newest ${latest}`].filter(Boolean);
      if (why.length && !result.pins.some(x => x.file === p.file && x.what === p.what && x.ver === p.ver)) result.pins.push({ ...p, why: why.join(', ') });
    }
    if (result.pins.length) log(`app-devkit pins behind (bump on purpose, after the tests pass):\n${result.pins.map(p => `  ${p.file}: ${p.what}@${p.ver}  (${p.why})`).join('\n')}`);

    if (!dryRun) {
      after(dir, { install, changedPkg: result.changes.some(c => c.path === 'package.json' && c.action !== 'ignored'), log });
      const tplMeta = JSON.parse(at(newSha, '.starter.json')?.toString() || '{}');
      const modules = { ...meta.modules };
      for (const [m, recipe] of moved) modules[m] ??= `${meta.template}@${short}:${recipe}`;
      const { flavour: _, ...plain } = meta;
      fs.writeFileSync(metaPath, JSON.stringify({ ...(unflavour ? { ...plain, app: appNew } : meta), ...(moved.size ? { modules } : {}), version: tplMeta.version ?? meta.version, commit: short }, null, 2) + '\n');
      log(`.starter.json: commit ${short}`);
    }
    for (const m of moved.keys()) log(`\nNEXT: ${m} is now a module and the template's screens have empty slots for it: run \`node tools/add.mjs ${m}\` (your files are kept and merged) so it stays wired in`);
    if (result.conflicts.length) log(`\n${result.conflicts.length} file(s) with conflicts to resolve by hand:\n  ${result.conflicts.join('\n  ')}`);
    return result;
  } finally { repo.done(); }
}

// the steps every app-sync bump (and every update) needs: the lock, sw.js's list, the import-map hash
export function after(dir, { install = true, changedPkg = true, log = console.log, exec = defaultExec } = {}) {
  const htmlPath = path.join(dir, 'app/index.html'), pkgPath = path.join(dir, 'package.json'), hdrPath = path.join(dir, 'worker/headers.js');
  const html = fs.readFileSync(htmlPath, 'utf8');
  const v = syncVersions(html, fs.readFileSync(pkgPath, 'utf8'));
  if (v.map.length !== 1 || v.map[0] !== v.dep) log(`warning: app-sync named differently: import map ${v.map.join(', ') || 'none'}, package.json ${v.dep ?? 'none'} (bump both with --sync <version>)`);
  if (install && changedPkg) { log('npm install (package-lock.json)'); exec('npm', ['install', '--no-audit', '--no-fund'], dir); }
  // the app's own tools/modules.mjs (the template's newest after an update) writes every generated place from
  // modules.json; an app from before it gets sw.js's list and the hash as they were made then
  if (fs.existsSync(path.join(dir, 'tools/modules.mjs'))) {
    const r = spawnSync('node', ['tools/modules.mjs'], { cwd: dir, encoding: 'utf8' });
    log(r.status === 0 ? r.stdout.trim() : `warning: modules failed (run npm install, then node tools/modules.mjs): ${r.stderr.trim()}`);
    return;
  }
  if (fs.existsSync(path.join(dir, 'tools/sw-files.mjs'))) {
    const r = spawnSync('node', ['tools/sw-files.mjs', 'app'], { cwd: dir, encoding: 'utf8' });
    log(r.status === 0 ? 'sw.js SHELL regenerated' : `warning: sw-files failed (run npm install, then node tools/sw-files.mjs app): ${r.stderr.trim()}`);
  }
  if (fs.existsSync(hdrPath)) {
    const hdr = fs.readFileSync(hdrPath, 'utf8');
    const next = hdr.replace(HASH_RE, `$1"${importMapHash(html)}"`);
    if (next !== hdr) { fs.writeFileSync(hdrPath, next); log('worker/headers.js IMPORT_MAP hash updated'); }
  }
}

// e2e/fixtures/core/<kit>/<version>/ is a frozen copy of what the pages load from core.anawj.com: the old version's
// folder becomes the new one's (so a file list already there survives), then the download refreshes the content
function moveFixtures(dir, kit, version, { download, exec, log }) {
  const kitDir = path.join(dir, 'e2e/fixtures/core', kit);
  if (!fs.existsSync(kitDir)) return;
  for (const old of fs.readdirSync(kitDir)) {
    if (old === version) continue;
    if (fs.existsSync(path.join(kitDir, version))) fs.rmSync(path.join(kitDir, old), { recursive: true });
    else fs.renameSync(path.join(kitDir, old), path.join(kitDir, version));
    log(`e2e/fixtures/core/${kit}: ${old} -> ${version}`);
  }
  if (download && fs.existsSync(path.join(dir, 'tools/refresh-core-fixtures.sh'))) { log('e2e core fixtures re-downloaded'); exec('bash', ['tools/refresh-core-fixtures.sh'], dir); }
}

// --sync <version>: app-sync's two names, then the steps above; the lock is moved by installing the tag (a plain
// `npm install` keeps the lock's old resolved commit) and the e2e core fixtures follow the version
export function bumpSyncIn(dir, version, { dryRun = false, install = true, log = console.log, exec = defaultExec } = {}) {
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?$/.test(version)) throw new Error(`--sync '${version}': a version like 1.3.10 or 1.4.0-rc.1`);
  const htmlPath = path.join(dir, 'app/index.html'), pkgPath = path.join(dir, 'package.json');
  const before = { html: fs.readFileSync(htmlPath, 'utf8'), pkg: fs.readFileSync(pkgPath, 'utf8') };
  const was = syncVersions(before.html, before.pkg);
  const next = bumpSync(before.html, before.pkg, version);
  log(`app-sync ${[...new Set([...was.map, was.dep])].join('/')} -> ${version}: import map, package.json devDependency, lock, e2e core fixtures, sw.js SHELL, CSP hash`);
  if (dryRun) return;
  fs.writeFileSync(htmlPath, next.html);
  fs.writeFileSync(pkgPath, next.pkg);
  if (install) { log('npm install app-sync tag (package-lock.json)'); exec('npm', ['install', '--save-dev', '--no-audit', '--no-fund', `app-sync@github:flamingbeing/app-sync#v${version}`], dir); }
  moveFixtures(dir, 'sync', version, { download: install, exec, log });
  after(dir, { install, changedPkg: false, log, exec });
}

export function parseArgs(argv) {
  const out = { install: true };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') out.dryRun = true;
    else if (a === '--refresh') out.refresh = true;
    else if (a === '--find-base') out.findBase = true;
    else if (a === '--no-install') out.install = false;
    else if (a === '--behind') out.behind = /^\d+$/.test(argv[i + 1] ?? '') ? Number(argv[++i]) : Infinity;
    else if (/^--(dir|from|to|base|sync)$/.test(a)) out[a.slice(2)] = argv[++i];
    else throw new Error(`unknown argument ${a}`);
  }
  return out;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = parseArgs(process.argv.slice(2));
    if (args.refresh) after(path.resolve(args.dir ?? '.'), { install: args.install, changedPkg: false });
    else if (args.sync) bumpSyncIn(path.resolve(args.dir ?? '.'), args.sync, args);
    else if (args.behind !== undefined) {
      const r = update({ ...args, dryRun: true, log: () => {} });
      console.log(`${r.behind} template commit(s) behind (${r.from} -> ${r.to}); ${r.changes.filter(c => c.action !== 'ignored').length} file(s) to bring in, ${r.conflicts.length} conflict(s)` +
        (r.pins.length ? `; app-devkit pins behind: ${r.pins.map(p => `${p.file} ${p.what}@${p.ver}`).join(', ')}` : ''));
      if (r.behind > args.behind) process.exit(1);
    } else {
      const r = update(args);
      if (r.conflicts.length) process.exit(1);
    }
  } catch (e) {
    console.error(`update-from-starter: ${e.message}`);
    process.exit(2);
  }
}
