// Soak for tools/update-from-starter.mjs on COPIES of real apps (never the real repos), made-up data only.
//
//   node soak/update-soak.mjs --app <checkout> [--app <checkout> ...] [--starter <template checkout>] [--out <log dir>]
//                             [--bases <n>] [--full] [--only <scenario-substring>]
//
// One summary line per scenario ("ok|FAIL <app> <scenario> - detail"); the last line is `PASS n/N` or
// `FAIL <first failing scenario> (log: <path>)`; exit 1 on any failure. Logs: <out>/<app>-<scenario>.log.
// --full also installs the updated copy and runs unit tests, tsc and vite build (slow; needs network for npm).
// The apps are only read: every scenario works in its own copy under <out>/work.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = { app: [], starter: path.resolve(here, '..'), out: null, bases: 6, full: false, only: null };
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (a === '--app') args.app.push(path.resolve(process.argv[++i]));
  else if (a === '--starter') args.starter = path.resolve(process.argv[++i]);
  else if (a === '--out') args.out = path.resolve(process.argv[++i]);
  else if (a === '--bases') args.bases = Number(process.argv[++i]);
  else if (a === '--only') args.only = process.argv[++i];
  else if (a === '--full') args.full = true;
  else { console.error(`unknown argument ${a}`); process.exit(2); }
}
if (!args.app.length) { console.error('usage: update-soak.mjs --app <checkout> ...'); process.exit(2); }
args.out ??= fs.mkdtempSync(path.join(os.tmpdir(), 'update-soak-'));
const work = path.join(args.out, 'work');
fs.rmSync(work, { recursive: true, force: true });
fs.mkdirSync(work, { recursive: true });

const UPDATE = path.join(args.starter, 'tools/update-from-starter.mjs');
const win = process.platform === 'win32';
const run = (cmd, a, cwd, extra = {}) => spawnSync(cmd, a, { cwd, encoding: 'utf8', maxBuffer: 128 << 20, shell: win && cmd === 'npm', ...extra });
const git = (cwd, a) => { const r = run('git', a, cwd); if (r.status !== 0) throw new Error(`git ${a.join(' ')}: ${r.stderr}`); return r.stdout; };
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const HEAD = git(args.starter, ['rev-parse', 'HEAD']).trim();
const gitEnv = { ...process.env, GIT_AUTHOR_NAME: 'soak', GIT_AUTHOR_EMAIL: 'soak@example.invalid', GIT_COMMITTER_NAME: 'soak', GIT_COMMITTER_EMAIL: 'soak@example.invalid' };

function walk(dir, rel = '', out = {}) {
  for (const e of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
    if (e.name === '.git' || e.name === 'node_modules') continue;
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) walk(dir, r, out);
    else if (e.isFile()) out[r] = sha(fs.readFileSync(path.join(dir, r)));
  }
  return out;
}
const diffSnap = (a, b) => [...new Set([...Object.keys(a), ...Object.keys(b)])].filter(k => a[k] !== b[k]).sort();

function copyApp(src, name) {
  const dst = path.join(work, name);
  fs.cpSync(src, dst, { recursive: true, filter: p => path.basename(p) !== 'node_modules' });
  return dst;
}

// run the updater, return { code, out }
function update(dir, extra, log, install = false) {
  const r = run('node', [UPDATE, '--dir', dir, '--from', args.starter, ...(install ? [] : ['--no-install']), '--to', HEAD, ...extra], dir, { env: { ...process.env, ...gitEnv } });
  const out = `$ update-from-starter ${extra.join(' ')}\n${r.stdout}${r.stderr}\n[exit ${r.status}]\n`;
  fs.appendFileSync(log, out);
  return { code: r.status, out: r.stdout + r.stderr };
}
const actions = out => out.split('\n').map(l => l.match(/^ {2}(updated|added|merged|deleted|kept|conflict|ignored) +(\S+)/)).filter(Boolean).map(m => `${m[1]} ${m[2]}`).sort();

// ---- results ----
const results = [];
let firstFail = null;
function record(app, name, ok, detail, log) {
  results.push(ok);
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${app} ${name}${detail ? ` - ${detail}` : ''}`);
  if (!ok && !firstFail) firstFail = `${app} ${name} (log: ${log})`;
}
async function scenario(app, name, fn) {
  if (args.only && !`${app} ${name}`.includes(args.only)) return;
  const log = path.join(args.out, `${app}-${name}.log`);
  fs.writeFileSync(log, '');
  try { const d = await fn(log); record(app, name, true, d, log); }
  catch (e) { fs.appendFileSync(log, `\n${e.stack ?? e}\n`); record(app, name, false, String(e.message).split('\n')[0], log); }
}
const must = (cond, msg) => { if (!cond) throw new Error(msg); };

// files the app owns whatever the template does: its ignore list plus anything the template never had
function ownedSet(dir, meta) {
  const own = new Set(['.starter.json', 'app/src/config.js', 'STATUS.md', 'NOTES.md', 'package-lock.json']);
  return { own, ignore: meta.update?.ignore ?? [] };
}
const tplFiles = (ref) => new Set(git(args.starter, ['-c', 'core.quotePath=false', 'ls-tree', '-r', '-z', '--name-only', ref]).split('\0').filter(Boolean));
const starterShas = () => git(args.starter, ['rev-list', '--first-parent', 'HEAD']).trim().split('\n');

// ---- scenarios on a real app copy ----
async function realApp(appSrc) {
  const app = path.basename(appSrc);
  const meta0 = JSON.parse(fs.readFileSync(path.join(appSrc, '.starter.json'), 'utf8'));
  const head = starterShas()[0];
  const shas = starterShas();

  await scenario(app, 'dry-run-changes-nothing', async log => {
    const d = copyApp(appSrc, `${app}-dry`);
    const before = walk(d);
    const r = update(d, ['--dry-run'], log);
    must(r.code === 0 || r.code === 1, `exit ${r.code}`);
    const ch = diffSnap(before, walk(d));
    must(!ch.length, `dry-run changed: ${ch.slice(0, 5).join(', ')}`);
    return `exit ${r.code}`;
  });

  await scenario(app, 'real-run-keeps-app-files', async log => {
    const d = copyApp(appSrc, `${app}-real`);
    const before = walk(d);
    const tpl = git(args.starter, ['-c', 'core.quotePath=false', 'diff', '--name-only', '--no-renames', meta0.commit, head]).split('\n').filter(Boolean);
    const dry = update(copyApp(appSrc, `${app}-real-dry`), ['--dry-run'], log);
    const r = update(d, [], log);
    must(r.code === 0 || r.code === 1, `exit ${r.code}`);
    const ch = diffSnap(before, walk(d)).filter(p => p !== '.starter.json');
    const { ignore } = ownedSet(d, meta0);
    for (const p of ch) {
      must(tpl.includes(p), `${p} changed but the template did not touch it`);
      must(!['app/src/config.js', 'STATUS.md', 'NOTES.md', 'package-lock.json'].includes(p), `${p} is app-owned`);
      must(!ignore.includes(p), `${p} is in update.ignore`);
    }
    const m = JSON.parse(fs.readFileSync(path.join(d, '.starter.json'), 'utf8'));
    must(head.startsWith(m.commit), `.starter.json commit ${m.commit} is not ${head.slice(0, 7)}`);
    must(JSON.stringify(m.app) === JSON.stringify(meta0.app), '.starter.json "app" changed');
    must(JSON.stringify(actions(dry.out)) === JSON.stringify(actions(r.out)), 'dry-run and real run list different changes');
    return `${ch.length} file(s) changed`;
  });

  await scenario(app, 'second-run-is-noop', async log => {
    const d = copyApp(appSrc, `${app}-idem`);
    update(d, [], log);
    const before = walk(d);
    const r = update(d, [], log);
    must(r.code === 0, `second run exit ${r.code}`);
    const ch = diffSnap(before, walk(d));
    must(!ch.length, `second run changed: ${ch.slice(0, 5).join(', ')}`);
    must(/nothing to bring in|\(0 commits\)/.test(r.out), 'second run did not say nothing to bring in');
    return 'no-op';
  });

  // older base commits: first-parent history sampled evenly
  const step = Math.max(1, Math.floor(shas.length / Math.max(1, args.bases)));
  const olds = shas.filter((_, i) => i % step === step - 1).slice(0, args.bases);
  for (const base of olds) {
    await scenario(app, `old-base-${base.slice(0, 7)}`, async log => {
      const d = copyApp(appSrc, `${app}-old-${base.slice(0, 7)}`);
      const before = walk(d);
      const r = update(d, ['--base', base], log);
      must(r.code === 0 || r.code === 1, `exit ${r.code} (crash)`);
      const after = walk(d);
      // files the app has and neither template version has: must be byte-identical
      const known = new Set([...tplFiles(base), ...tplFiles(head)]);
      const lost = Object.keys(before).filter(p => !known.has(p) && after[p] !== before[p]);
      must(!lost.length, `app-only files changed: ${lost.slice(0, 5).join(', ')}`);
      for (const p of ['app/src/config.js', 'STATUS.md', 'NOTES.md', 'package-lock.json'].concat(meta0.update?.ignore ?? []))
        if (before[p]) must(after[p] === before[p], `${p} (app-owned) changed`);
      const dry = update(copyApp(appSrc, `${app}-old-dry-${base.slice(0, 7)}`), ['--base', base, '--dry-run'], log);
      must(JSON.stringify(actions(dry.out)) === JSON.stringify(actions(r.out)), 'dry-run and real run differ');
      const r2 = update(d, [], log);
      must(r2.code === 0, `second run after old base exit ${r2.code}`);
      return `exit ${r.code}, ${actions(r.out).length} action(s)`;
    });
  }

  await scenario(app, 'dirty-tree', async log => {
    const d = copyApp(appSrc, `${app}-dirty`);
    git(d, ['init', '-q']); git(d, ['add', '-A']); run('git', ['commit', '-qm', 'base'], d, { env: gitEnv });
    fs.writeFileSync(path.join(d, 'my-untracked-note.txt'), 'made-up local note\n');
    fs.appendFileSync(path.join(d, 'STATUS.md'), '\nlocal uncommitted line\n');
    const tpl = git(args.starter, ['-c', 'core.quotePath=false', 'diff', '--name-only', '--no-renames', meta0.commit, head]).split('\n').filter(p => p && fs.existsSync(path.join(d, p)) && /\.(js|mjs|md|json|html)$/.test(p) && !/package|\.starter/.test(p));
    const touched = tpl[0];
    if (touched) fs.appendFileSync(path.join(d, touched), touched.endsWith('.json') ? '' : '\n// local uncommitted edit\n');
    const r = update(d, [], log);
    must(r.code === 0 || r.code === 1, `exit ${r.code}`);
    must(fs.readFileSync(path.join(d, 'my-untracked-note.txt'), 'utf8') === 'made-up local note\n', 'untracked file lost');
    must(fs.readFileSync(path.join(d, 'STATUS.md'), 'utf8').includes('local uncommitted line'), 'STATUS.md edit lost');
    if (touched && !touched.endsWith('.json')) must(fs.readFileSync(path.join(d, touched), 'utf8').includes('local uncommitted edit') || r.out.includes(touched) , `${touched}: local edit lost silently`);
    return touched ? `edited ${touched}` : 'nothing to edit';
  });

  // ---- round 2: other modes ----
  const mode = (d, a, log) => { const r = run('node', [UPDATE, '--dir', d, '--from', args.starter, ...a], d, { env: { ...process.env, ...gitEnv } }); fs.appendFileSync(log, `$ ${a.join(' ')}\n${r.stdout}${r.stderr}\n[exit ${r.status}]\n`); return { code: r.status, out: r.stdout + r.stderr }; };

  await scenario(app, 'behind-exit-codes', async log => {
    const d = copyApp(appSrc, `${app}-behind`);
    const before = walk(d);
    const r0 = mode(d, ['--behind'], log), rBig = mode(d, ['--behind', '100000'], log), rZero = mode(d, ['--behind', '0'], log);
    must(r0.code === 0 && rBig.code === 0, `--behind / --behind 100000 exit ${r0.code}/${rBig.code}`);
    const m = rZero.out.match(/(\d+) template commit\(s\) behind/);
    must(m, `no 'behind' line: ${rZero.out.slice(0, 200)}`);
    must(Number(m[1]) === 0 ? rZero.code === 0 : rZero.code === 1, `--behind 0 exit ${rZero.code} with ${m[1]} behind`);
    const n = Number(m[1]);
    if (n > 0) must(mode(d, ['--behind', String(n)], log).code === 0 && mode(d, ['--behind', String(n - 1)], log).code === 1, 'boundary of --behind n wrong');
    must(!diffSnap(before, walk(d)).length, '--behind changed files');
    return `${n} behind`;
  });

  await scenario(app, 'sync-bump-no-install', async log => {
    const d = copyApp(appSrc, `${app}-sync`);
    const bad = mode(d, ['--sync', 'not-a-version', '--no-install'], log);
    must(bad.code !== 0, 'bad --sync version accepted');
    const before = walk(d);
    must(mode(d, ['--sync', '1.9.9', '--no-install', '--dry-run'], log).code === 0, 'sync dry-run failed');
    must(!diffSnap(before, walk(d)).length, 'sync --dry-run changed files');
    const r = mode(d, ['--sync', '1.9.9', '--no-install'], log);
    must(r.code === 0, `sync exit ${r.code}`);
    const html = fs.readFileSync(path.join(d, 'app/index.html'), 'utf8'), pkg = fs.readFileSync(path.join(d, 'package.json'), 'utf8');
    must(/app-sync[^"']*#v1\.9\.9|app-sync@1\.9\.9|app-sync\/1\.9\.9/.test(html) || html.includes('1.9.9'), 'import map not bumped');
    must(pkg.includes('v1.9.9'), 'package.json not bumped');
    const csp = html.match(/sha256-([A-Za-z0-9+/=]+)/);
    const ld = html.replace(/\r\n/g, '\n');
    const im = ld.match(/<script type="importmap">([\s\S]*?)<\/script>/);
    if (csp && im) must(crypto.createHash('sha256').update(im[1]).digest('base64') === csp[1], 'CSP hash does not match the import map');
    const snap = walk(d);
    must(mode(d, ['--sync', '1.9.9', '--no-install'], log).code === 0, 'second sync failed');
    must(!diffSnap(snap, walk(d)).length, 'second sync changed files');
    return 'bumped, idempotent';
  });

  await scenario(app, 'update-then-sync-keeps-conflicts', async log => {
    const d = copyApp(appSrc, `${app}-upsync`);
    update(d, [], log);
    const conf = Object.keys(walk(d)).filter(p => /\.(js|mjs|md|yml|json|html)$/.test(p) && fs.readFileSync(path.join(d, p), 'utf8').includes('<<<<<<<'));
    const r = mode(d, ['--sync', '1.9.9', '--no-install'], log);
    must(r.code === 0, `sync after update exit ${r.code}`);
    for (const p of conf) must(fs.readFileSync(path.join(d, p), 'utf8').includes('<<<<<<<'), `${p}: conflict markers vanished after --sync`);
    return `${conf.length} conflicted file(s) kept`;
  });

  // resolve every conflict by keeping the app side, then update again: must not re-conflict or lose the resolution
  await scenario(app, 'conflict-resolved-then-rerun', async log => {
    const d = copyApp(appSrc, `${app}-resolve`);
    update(d, [], log);
    const snap0 = walk(d);
    let n = 0;
    for (const p of Object.keys(snap0)) {
      if (!/\.(js|mjs|md|yml|yaml|json|html|css|ts)$/.test(p)) continue;
      const t = fs.readFileSync(path.join(d, p), 'utf8');
      if (!t.includes('<<<<<<<')) continue;
      n++;
      fs.writeFileSync(path.join(d, p), t.replace(/<<<<<<<[^\n]*\n([\s\S]*?)=======\n[\s\S]*?>>>>>>>[^\n]*\n/g, '$1'));
    }
    const resolved = walk(d);
    const r = update(d, [], log);
    must(r.code === 0, `rerun after resolving ${n} file(s): exit ${r.code}`);
    must(!diffSnap(resolved, walk(d)).length, `rerun changed ${diffSnap(resolved, walk(d)).slice(0, 5).join(', ')}`);
    return `${n} resolved`;
  });

  // dirty-tree variants: staged, deleted-tracked and renamed app files with a git repo
  await scenario(app, 'dirty-tree-variants', async log => {
    const d = copyApp(appSrc, `${app}-dirty2`);
    git(d, ['init', '-q']); git(d, ['add', '-A']); run('git', ['commit', '-qm', 'base'], d, { env: gitEnv });
    fs.writeFileSync(path.join(d, 'staged-new.txt'), 'staged\n'); git(d, ['add', 'staged-new.txt']);
    fs.writeFileSync(path.join(d, 'ünï staged.txt'), 'staged unicode\n'); git(d, ['add', 'ünï staged.txt']);
    fs.mkdirSync(path.join(d, 'local dir'), { recursive: true }); fs.writeFileSync(path.join(d, 'local dir/x.txt'), 'x\n');
    const victim = fs.existsSync(path.join(d, 'NOTES.md')) ? 'NOTES.md' : 'STATUS.md';
    fs.rmSync(path.join(d, victim));
    const r = update(d, [], log);
    must(r.code === 0 || r.code === 1, `exit ${r.code}`);
    must(fs.readFileSync(path.join(d, 'staged-new.txt'), 'utf8') === 'staged\n', 'staged file lost');
    must(fs.readFileSync(path.join(d, 'ünï staged.txt'), 'utf8') === 'staged unicode\n', 'staged unicode file lost');
    must(fs.existsSync(path.join(d, 'local dir/x.txt')), 'untracked dir lost');
    const st = git(d, ['status', '--porcelain']);
    must(!/^\?\? \.git/m.test(st), 'git state damaged');
    return `deleted ${victim}: ${fs.existsSync(path.join(d, victim)) ? 're-added' : 'stays deleted'}`;
  });

  if (args.full) await scenario(app, 'updated-copy-passes', async log => {
    const d = copyApp(appSrc, `${app}-full`);
    // a dev checkout has its node_modules (sw.js's SHELL is generated from app-sync / app-ui in them)
    const pre = run(win ? 'npm.cmd' : 'npm', ['install', '--no-audit', '--no-fund'], d, { shell: win });
    fs.appendFileSync(log, `$ npm install (before)\n${pre.stderr.slice(-1500)}[exit ${pre.status}]\n`);
    must(pre.status === 0, 'npm install before the update failed');
    const r = update(d, [], log, true);
    must(r.code === 0 || r.code === 1, `exit ${r.code}`);
    // conflicts are the owner's to resolve; here both sides are kept (the template's alone for test files) so the copy can be built
    const lns = r.out.split('\n');
    for (const f of lns.slice(lns.findIndex(l => /file\(s\) with conflicts/.test(l)) + 1).map(l => l.trim()).filter(l => l && !l.startsWith('['))) {
      const fp = path.join(d, f);
      if (!fs.existsSync(fp)) continue;
      let mode = 0;
      fs.writeFileSync(fp, fs.readFileSync(fp, 'utf8').split('\n').filter(l => {
        if (/^<{7}( |$)/.test(l)) { mode = 1; return false; }
        if (mode === 1 && /^={7}$/.test(l)) { mode = 2; return false; }
        if (mode === 2 && /^>{7}( |$)/.test(l)) { mode = 0; return false; }
        return /\/test\/|\.test\./.test(f) ? mode !== 1 : true;
      }).join('\n'));
    }
    const steps = [['npm', ['run', 'typecheck']],
      ['npm', ['test']], ['npx', ['vite', 'build']]];
    for (const [c, a] of steps) {
      const x = run(c === 'npx' ? (win ? 'npx.cmd' : 'npx') : c, a, d, { shell: win });
      fs.appendFileSync(log, `$ ${c} ${a.join(' ')}\n${x.stdout.slice(-4000)}${x.stderr.slice(-4000)}\n[exit ${x.status}]\n`);
      if (x.status !== 0 && r.code === 1) return `${c} ${a.join(' ')} fails with unresolved conflicts (expected until resolved by hand)`;
      must(x.status === 0, `${c} ${a.join(' ')} exit ${x.status}`);
    }
    return 'install, tsc, unit, vite build ok';
  });
}

// ---- scenarios with a synthetic template: renamed/deleted/conflicting/CRLF/odd names ----
async function synthetic(appSrc) {
  const app = path.basename(appSrc);
  await scenario(app, 'synthetic-template', async log => {
    const tpl = path.join(work, `${app}-tpl`);
    git(args.starter, ['worktree', 'prune']);
    run('git', ['clone', '-q', '--no-hardlinks', args.starter, tpl], work);
    git(tpl, ['checkout', '-q', '-B', 'soak', 'HEAD']);
    const baseSha = git(tpl, ['rev-parse', 'HEAD']).trim();
    const d = copyApp(appSrc, `${app}-syn`);
    const w = (root, rel, text) => { fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true }); fs.writeFileSync(path.join(root, rel), text); };
    const rd = (root, rel) => fs.readFileSync(path.join(root, rel), 'utf8');
    const lines = n => Array.from({ length: n }, (_, i) => `line ${i + 1}`).join('\n') + '\n';
    // template at base: files the scenarios change
    const T = {
      'soak/a-plain.txt': lines(12), 'soak/b-merge.txt': lines(20), 'soak/c-conflict.txt': lines(10),
      'soak/d-delete.txt': lines(5), 'soak/e-delete-edited.txt': lines(5), 'soak/f-old-name.txt': lines(8),
      'soak/h-both-have.txt': undefined, 'soak/crlf.txt': lines(14),
    };
    for (const [p, t] of Object.entries(T)) if (t) w(tpl, p, t);
    git(tpl, ['add', '-A']); run('git', ['commit', '-qm', 'soak: base files'], tpl, { env: gitEnv });
    const base = git(tpl, ['rev-parse', 'HEAD']).trim();
    for (const [p, t] of Object.entries(T)) if (t) w(d, p, t.replace(/\r?\n/g, p.includes('crlf') ? '\r\n' : '\n'));
    // app edits
    w(d, 'soak/b-merge.txt', lines(20).replace('line 18\n', 'line 18 app\n'));
    w(d, 'soak/c-conflict.txt', lines(10).replace('line 5\n', 'line 5 from the app\n'));
    w(d, 'soak/e-delete-edited.txt', lines(5) + 'app extra\n');
    w(d, 'soak/h-both-have.txt', 'app already has this\n');
    w(d, 'soak/app-only.txt', 'app only\n');
    const meta = JSON.parse(rd(d, '.starter.json'));
    meta.commit = base.slice(0, 7);
    w(d, '.starter.json', JSON.stringify(meta, null, 2) + '\n');
    // template change
    w(tpl, 'soak/a-plain.txt', lines(12).replace('line 6\n', 'line 6 new\n'));
    w(tpl, 'soak/b-merge.txt', lines(20).replace('line 2\n', 'line 2 new\n'));
    w(tpl, 'soak/c-conflict.txt', lines(10).replace('line 5\n', 'line 5 from the template\n'));
    fs.rmSync(path.join(tpl, 'soak/d-delete.txt')); fs.rmSync(path.join(tpl, 'soak/e-delete-edited.txt'));
    fs.renameSync(path.join(tpl, 'soak/f-old-name.txt'), path.join(tpl, 'soak/f-new-name.txt'));
    w(tpl, 'soak/h-both-have.txt', 'template now has this\n');
    w(tpl, 'soak/crlf.txt', lines(14).replace('line 3\n', 'line 3 new\n'));
    w(tpl, 'soak/new file with spaces.txt', 'spaces\n');
    w(tpl, 'soak/ünï-name.txt', 'unicode\n');
    w(tpl, 'soak/new-dir/deep/added.txt', 'added\n');
    git(tpl, ['add', '-A']); run('git', ['commit', '-qm', 'soak: template change'], tpl, { env: gitEnv });
    const before = walk(d);
    const r = run('node', [UPDATE, '--dir', d, '--from', tpl, '--to', 'soak', '--no-install'], d, { env: { ...process.env, ...gitEnv } });
    fs.appendFileSync(log, `${r.stdout}${r.stderr}\n[exit ${r.status}]\n`);
    must(r.status === 1, `exit ${r.status}, wanted 1 (one conflict)`);
    must(rd(d, 'soak/a-plain.txt').includes('line 6 new'), 'a-plain not updated');
    const b = rd(d, 'soak/b-merge.txt');
    must(b.includes('line 2 new') && b.includes('line 18 app'), 'b-merge lost a side');
    const c = rd(d, 'soak/c-conflict.txt');
    must(c.includes('<<<<<<<') && c.includes('from the app') && c.includes('from the template'), 'c-conflict has no markers or lost a side');
    must(!fs.existsSync(path.join(d, 'soak/d-delete.txt')), 'd-delete not deleted');
    must(rd(d, 'soak/e-delete-edited.txt').includes('app extra'), 'e-delete-edited (app changed) was removed');
    must(!fs.existsSync(path.join(d, 'soak/f-old-name.txt')) && fs.existsSync(path.join(d, 'soak/f-new-name.txt')), 'rename not followed');
    const h = rd(d, 'soak/h-both-have.txt');
    must(h.includes('app already has this') || h.includes('<<<<<<<'), 'h-both-have: app text lost');
    const cr = rd(d, 'soak/crlf.txt');
    must(cr.includes('line 3 new'), 'crlf file not updated');
    must(!/[^\r]\n/.test(cr) || /\r\n/.test(cr), 'crlf file lost every CRLF');
    must(rd(d, 'soak/app-only.txt') === 'app only\n', 'app-only file changed');
    must(fs.existsSync(path.join(d, 'soak/new file with spaces.txt')), 'file with spaces not added');
    must(fs.existsSync(path.join(d, 'soak/ünï-name.txt')), 'unicode-named file not added');
    must(fs.existsSync(path.join(d, 'soak/new-dir/deep/added.txt')), 'nested new file not added');
    const after = diffSnap(before, walk(d));
    const stray = after.filter(p => !p.startsWith('soak/') && p !== '.starter.json' && !tpl_changed(tpl, base).has(p));
    must(!stray.length, `unexpected changes outside the template diff: ${stray.slice(0, 5).join(', ')}`);
    // idempotent, even with the conflict markers left
    const snap = walk(d);
    const r2 = run('node', [UPDATE, '--dir', d, '--from', tpl, '--to', 'soak', '--no-install'], d, { env: { ...process.env, ...gitEnv } });
    fs.appendFileSync(log, `${r2.stdout}${r2.stderr}\n[exit ${r2.status}]\n`);
    must(r2.status === 0, `second run exit ${r2.status}`);
    must(!diffSnap(snap, walk(d)).length, 'second run changed files');
    return 'merged, conflicted, deleted, renamed, crlf, odd names ok';
  });
}
const tpl_changed = (tpl, base) => new Set(git(tpl, ['-c', 'core.quotePath=false', 'diff', '--name-only', '--no-renames', base, 'HEAD']).split('\n').filter(Boolean));

for (const a of args.app) { await realApp(a); await synthetic(a); }

const n = results.length, p = results.filter(Boolean).length;
console.log(firstFail ? `FAIL ${firstFail}  (${p}/${n} passed)` : `PASS ${p}/${n}`);
process.exit(firstFail ? 1 : 0);
