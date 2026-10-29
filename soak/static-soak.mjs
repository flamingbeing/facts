// Soak of the static starter (README, "Pick a starter"): per seed, generate a throwaway app from this checkout with
// `tools/fill.mjs --static` (the step `new-app.mjs --static` runs, minus GitHub), then run the app's own checks and
// the soak specs. Made-up data only; no Firebase, no secrets, no deploy.
//
//   node soak/static-soak.mjs [--loops 3] [--seed 1] [--browsers chromium[,firefox,webkit]] [--workers 4]
//        [--repeat 3] [--throttle 4] [--work <dir>] [--skip check,sw,unit,tsc,vite,e2e,dist,soak] [--keep] [--starter <dir>]
//
// One summary line per loop; at the end `PASS n/N`, or the first failing seed and its log folder. Needs network once
// (npm ci, app-devkit) and a Chromium (PW_CHROMIUM or Playwright's own); firefox/webkit run in the pw-box image.
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const opt = (n, d) => (argv.includes(`--${n}`) ? argv[argv.indexOf(`--${n}`) + 1] : d);
const STARTER = path.resolve(opt('starter', path.join(HERE, '..')));
const LOOPS = +opt('loops', 3);
const SEED = +opt('seed', 1);
const BROWSERS = opt('browsers', 'chromium').split(',');
const WORKERS = opt('workers', String(Math.max(1, Math.min(4, os.cpus().length))));
const REPEAT = +opt('repeat', 3);
const THROTTLE = +opt('throttle', 1);
if (!(THROTTLE >= 1)) { console.log('FAIL --throttle wants a number >= 1'); process.exit(2); }   // Chromium CPU slowdown factor (CDP Emulation.setCPUThrottlingRate); 1 = off
const WORK = path.resolve(opt('work', path.join(os.tmpdir(), 'static-soak')));
const SKIP = new Set(opt('skip', '').split(',').filter(Boolean));
const KEEP = argv.includes('--keep');
const KITS = ['homedesign', 'nuhs', 'ntf'];
const env = { ...process.env, METADATA_SERVER_DETECTION: 'none', CI: '', PW_TEST_HTML_REPORT_OPEN: 'never' };
if (!env.PW_CHROMIUM && fs.existsSync('/opt/pw-browsers/chromium')) env.PW_CHROMIUM = '/opt/pw-browsers/chromium';

const run = (cmd, args, { cwd, log, extra = {}, timeout = 900_000 }) => {
  const r = spawnSync(cmd, args, { cwd, env: { ...env, ...extra }, encoding: 'utf8', timeout, maxBuffer: 256 << 20, shell: process.platform === 'win32' });
  if (log) fs.writeFileSync(log, `$ ${cmd} ${args.join(' ')}\n${r.stdout || ''}\n${r.stderr || ''}\n(exit ${r.status}${r.signal ? ' ' + r.signal : ''})\n`);
  return r;
};
const tail = (r, re) => ((r.stdout || '') + (r.stderr || '')).split('\n').filter(l => re.test(l)).pop()?.trim() || '';

// the pieces every seed shares: .devkit/ and node_modules/ (same lock, same pins), made once
function prepare() {
  const base = path.join(WORK, '_base');
  const stamp = '.ready-' + crypto.createHash('sha1').update(BROWSERS.join() + (env.PW_CHROMIUM || '')).update(fs.readFileSync(path.join(STARTER, 'package-lock.json'))).update(fs.readFileSync(path.join(STARTER, '.github/workflows/checks.yml'))).digest('hex').slice(0, 10);   // a new lock or devkit pin remakes it
  if (fs.existsSync(path.join(base, stamp))) return base;
  fs.rmSync(base, { recursive: true, force: true });
  copyTree(STARTER, base);
  const o = { cwd: base, log: path.join(WORK, '_prepare.log') };
  const a = devkit(base, o.log);
  const b = run('npm', ['ci', '--no-audit', '--no-fund'], { ...o, log: path.join(WORK, '_npm.log') });
  if (a.status !== 0 || b.status !== 0 || !fs.existsSync(path.join(base, '.devkit/VERSION'))) throw new Error(`prepare failed (see ${WORK}/_prepare.log, _npm.log)`);
  // browsers: Playwright's own downloads, unless a Chromium is given (PW_CHROMIUM) and only chromium is asked for
  const want = BROWSERS.filter(b => b !== 'chromium' || !env.PW_CHROMIUM);
  if (want.length) {
    const c = run('npx', ['playwright', 'install', ...want], { ...o, log: path.join(WORK, '_browsers.log'), timeout: 3_600_000 });
    if (c.status !== 0) throw new Error(`playwright install ${want} failed (see ${WORK}/_browsers.log)`);
  }
  fs.writeFileSync(path.join(base, stamp), '');
  return base;
}
// tools/dev-setup.sh without bash (Windows has none that works): app-devkit at the version checks.yml pins -> .devkit/
function devkit(base, log) {
  const ref = process.env.DEVKIT_REF || fs.readFileSync(path.join(base, '.github/workflows/checks.yml'), 'utf8').match(/app-devkit\/setup-[a-z]+@(v[0-9][0-9.]*)/)?.[1];
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'devkit-'));
  const r = run('git', ['clone', '-q', '--depth', '1', '--branch', ref, process.env.DEVKIT_URL || 'https://github.com/flamingbeing/app-devkit', path.join(tmp, 'devkit')], { cwd: tmp, log });
  if (r.status === 0) {
    fs.rmSync(path.join(base, '.devkit'), { recursive: true, force: true });
    for (const d of ['playwright', 'rules', 'tools', 'worker']) fs.cpSync(path.join(tmp, 'devkit', d), path.join(base, '.devkit', d), { recursive: true });
    fs.writeFileSync(path.join(base, '.devkit/VERSION'), ref + '\n');
  }
  fs.rmSync(tmp, { recursive: true, force: true });
  return r;
}
function copyTree(from, to) {
  const files = fs.existsSync(path.join(from, '.git'))
    ? spawnSync('git', ['ls-files', '-co', '--exclude-standard', '-z'], { cwd: from, encoding: 'utf8' }).stdout.split('\0').filter(Boolean)
    : null;
  if (!files) { fs.cpSync(from, to, { recursive: true, filter: s => !/[\\/](node_modules|\.git)([\\/]|$)/.test(s) }); return; }
  for (const f of files) {
    if (!fs.existsSync(path.join(from, f))) continue;   // deleted, not yet committed
    fs.mkdirSync(path.dirname(path.join(to, f)), { recursive: true });
    fs.copyFileSync(path.join(from, f), path.join(to, f));
  }
}

function generate(seed, dir, logs) {
  fs.rmSync(dir, { recursive: true, force: true });
  copyTree(STARTER, dir);
  const kit = KITS[seed % KITS.length];
  const name = `soakapp-${seed}`;
  const o = { cwd: dir, log: path.join(logs, 'gen.log') };
  const g = run('git', ['init', '-q'], o);
  run('git', ['add', '-A'], o);
  run('git', ['-c', 'user.email=soak@example.com', '-c', 'user.name=soak', 'commit', '-qm', 'starter'], o);
  const f = run('node', ['tools/fill.mjs', '--static', '--name', name, '--host', `${name}.example.com`, '--kit', kit], o);
  // like new-app: fill runs in a fresh clone (no node_modules, no .devkit); they come after
  const base = path.join(WORK, '_base');
  fs.cpSync(path.join(base, '.devkit'), path.join(dir, '.devkit'), { recursive: true });
  if (!fs.existsSync(path.join(dir, 'node_modules'))) fs.cpSync(path.join(base, 'node_modules'), path.join(dir, 'node_modules'), { recursive: true, verbatimSymlinks: true });   // (fill installs them itself in a fresh clone)
  fs.mkdirSync(path.join(dir, 'e2e'), { recursive: true });
  const second = run('node', ['tools/fill.mjs', '--static', '--name', name, '--host', `${name}.example.com`, '--kit', kit, '--check'], { ...o, log: path.join(logs, 'gen-again.log') });
  const spec = fs.readFileSync(path.join(HERE, 'static-e2e/soak.spec.mjs'));
  fs.writeFileSync(path.join(dir, 'e2e/soak.spec.mjs'), spec);
  return { kit, ok: g.status === 0 && f.status === 0, idem: second.status === 0 };
}

// the starter's config pins its projects to Chromium (and `--browser` is refused beside projects): a sibling config per engine
const engineConfig = (dir, b) => {
  const f = `pw-${b}.config.mjs`;
  fs.writeFileSync(path.join(dir, f), `import base from './playwright.config.mjs';
export default { ...base, use: { ...base.use, launchOptions: {} }, projects: base.projects.map(p => ({ ...p, use: { ...p.use, browserName: '${b}'${b === 'firefox' ? ', isMobile: false' : ''} } })) };
`);
  return f;
};
const pw = (dir, logs, tag, args, extra = {}) => {
  if (THROTTLE > 1) extra = { SOAK_THROTTLE: String(THROTTLE), ...extra };
  const out = [];
  for (const b of BROWSERS) {
    const r = run('npx', ['playwright', 'test', ...(b === 'chromium' ? [] : [`--config=${engineConfig(dir, b)}`]), `--workers=${WORKERS}`, '--reporter=list', ...args], { cwd: dir, log: path.join(logs, `${tag}-${b}.log`), extra, timeout: 1_500_000 });
    const m = ((r.stdout || '') + (r.stderr || ''));
    const n = k => +(m.match(new RegExp(`(\\d+) ${k}`))?.[1] || 0);
    out.push({ b, ok: r.status === 0, passed: n('passed'), failed: n('failed'), flaky: n('flaky') });
  }
  return out;
};

const PHASES = [
  ['check', (dir, logs) => { const r = run('node', ['.devkit/tools/check.mjs'], { cwd: dir, log: path.join(logs, 'check.log') }); return [r.status === 0, tail(r, /./)]; }],
  ['sw', (dir, logs) => { const r = run('node', ['tools/sw-files.mjs', 'app', '--check'], { cwd: dir, log: path.join(logs, 'sw.log') }); return [r.status === 0, tail(r, /sw-files/)]; }],
  ['unit', (dir, logs) => { const r = run('npm', ['test'], { cwd: dir, log: path.join(logs, 'unit.log') }); return [r.status === 0, `${tail(r, /^# pass/)} ${tail(r, /^# fail/)}`]; }],
  ['tsc', (dir, logs) => { const r = run('npm', ['run', 'typecheck'], { cwd: dir, log: path.join(logs, 'tsc.log') }); return [r.status === 0, '']; }],
  ['vite', (dir, logs) => { const r = run('npm', ['run', 'vite'], { cwd: dir, log: path.join(logs, 'vite.log') }); return [r.status === 0, tail(r, /vite-check/)]; }],
  ['e2e', (dir, logs) => { const o = pw(dir, logs, 'e2e', ['--grep-invert', 'soak']); return [o.every(x => x.ok), o.map(x => `${x.b} ${x.passed}p/${x.failed}f`).join(' ')]; }],
  ['dist', (dir, logs) => { const o = pw(dir, logs, 'dist', ['--grep-invert', 'soak'], { APP_DIR: 'dist' }); return [o.every(x => x.ok), o.map(x => `${x.b} ${x.passed}p/${x.failed}f`).join(' ')]; }],
  ['soak', (dir, logs) => { const o = pw(dir, logs, 'soak', ['e2e/soak.spec.mjs', `--repeat-each=${REPEAT}`]); return [o.every(x => x.ok), o.map(x => `${x.b} ${x.passed}p/${x.failed}f${x.flaky ? '/' + x.flaky + 'flaky' : ''}`).join(' ')]; }],
];

fs.mkdirSync(WORK, { recursive: true });
try { prepare(); } catch (e) { console.log(`FAIL prepare: ${e.message}`); process.exit(1); }
let pass = 0, first = null;
for (let i = 0; i < LOOPS; i++) {
  const seed = SEED + i, t0 = Date.now();
  const dir = path.join(WORK, `seed-${seed}`), logs = path.join(WORK, `logs-${seed}`);
  fs.rmSync(logs, { recursive: true, force: true }); fs.mkdirSync(logs, { recursive: true });
  const gen = generate(seed, dir, logs);
  const cells = [`gen:${gen.ok ? 'ok' : 'FAIL'}`, `again:${gen.idem ? 'ok' : 'FAIL'}`];
  let ok = gen.ok && gen.idem;
  if (gen.ok) for (const [name, fn] of PHASES) {
    if (SKIP.has(name)) continue;
    const [good, note] = fn(dir, logs);
    cells.push(`${name}:${good ? 'ok' : 'FAIL'}${good && note ? `(${note.replace(/\s+/g, ' ')})` : ''}`);
    ok &&= good;
  }
  if (ok) pass++; else first ??= { seed, logs };
  console.log(`loop ${i + 1}/${LOOPS} seed=${seed} kit=${gen.kit} ${cells.join(' ')} ${Math.round((Date.now() - t0) / 1000)}s ${ok ? 'PASS' : 'FAIL'}`);
  if (!KEEP && ok) fs.rmSync(dir, { recursive: true, force: true });
}
console.log(first ? `PASS ${pass}/${LOOPS}; first failing seed ${first.seed}, logs ${first.logs}` : `PASS ${pass}/${LOOPS}`);
process.exit(first ? 1 : 0);
