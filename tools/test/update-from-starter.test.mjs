// tools/update-from-starter.mjs on a scratch template repo and an app made from it. node --test tools/test/update-from-starter.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { update, findBase, globRe, importMapHash, syncVersions, bumpSync, bumpSyncIn, devkitPins, older, merge3, parseArgs } from '../update-from-starter.mjs';

const TPL_APP = { name: 'starter-app', host: 'app.example.com', kit: 'homedesign', project: 'demo-starter-app', title: 'Starter app' };
const APP = { name: 'pet-log', host: 'pets.example.org', kit: 'homedesign', project: 'pet-log-app', title: 'Pet log' };
const html = v => `<!doctype html>\n<script type="importmap">\n{ "imports": { "@core/app": "https://core.anawj.com/sync/${v}/app.js" } }\n</script>\n`;
const headers = h => `// headers\nexport const IMPORT_MAP = "${h}";\nexport const X = 1;\n`;
const sw = (code, shell) => `// sw\nconst SHELL = [\n${shell.map(f => `  '${f}',\n`).join('')}];\n${code}\n`;
const pkg = v => `{\n  "name": "starter-app",\n  "devDependencies": {\n    "app-sync": "github:flamingbeing/app-sync#v${v}"\n  }\n}\n`;
const lines = n => Array.from({ length: n }, (_, i) => `line ${i}`);

const run = (cwd, ...args) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
function writeAll(dir, files) {
  for (const [rel, text] of Object.entries(files)) {
    const p = path.join(dir, rel);
    if (text === null) { fs.rmSync(p, { force: true }); continue; }
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, text);
  }
}
function commit(dir, files, msg) {
  writeAll(dir, files);
  run(dir, 'add', '-A');
  run(dir, '-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '-qm', msg);
  return run(dir, 'rev-parse', 'HEAD').trim();
}
const swap = text => text.replaceAll('app.example.com', APP.host).replaceAll('starter-app', APP.name);

// a template with one commit, and an app made from it (the template's files with the app's values)
function setup() {
  const tpl = fs.mkdtempSync(path.join(os.tmpdir(), 'tpl-'));
  run(tpl, 'init', '-q', '-b', 'main');
  const files = {
    '.starter.json': JSON.stringify({ template: 'x/app-starter', version: '0.2.0', commit: '', app: TPL_APP }, null, 2),
    'README.md': lines(20).join('\n') + '\n',
    'worker/routes.js': `export const SITES = { 'app.example.com': { root: 'app/' } };\n// one\n`,
    'worker/headers.js': headers(importMapHash(html('1.3.10'))),
    'app/index.html': html('1.3.10'),
    'app/public/sw.js': sw('// code v1', ['./', 'src/a.js']),
    'app/src/config.js': 'export const APP = {};\n',
    'package.json': pkg('1.3.10'),
    'old.md': 'to be deleted\n',
    'changed-by-app.md': 'template text\n',
    'icon.png': Buffer.from([1, 2, 3]),
  };
  const base = commit(tpl, files, 'base');
  const app = fs.mkdtempSync(path.join(os.tmpdir(), 'app-'));
  for (const [rel, v] of Object.entries(files)) writeAll(app, { [rel]: typeof v === 'string' ? swap(v) : v });
  writeAll(app, {
    '.starter.json': JSON.stringify({ template: 'x/app-starter', version: '0.2.0', commit: base.slice(0, 7), app: APP }, null, 2) + '\n',
    'README.md': ['# Pet log', ...lines(20).slice(1)].join('\n') + '\n',   // the app's own first line
    'app/public/sw.js': sw('// code v1', ['./', 'src/a.js', 'src/pets.js']),          // the app's own file list
    'changed-by-app.md': 'app text\n',
    'app/src/config.js': 'export const APP = { name: "pet-log" };\n',
  });
  return { tpl, app, base };
}

test('brings in the template\'s changes with the app\'s values, merging with the app\'s own edits', () => {
  const { tpl, app } = setup();
  const readme = lines(20); readme[19] = 'line 19, reworded';
  const to = commit(tpl, {
    'README.md': readme.join('\n') + '\n',
    'worker/routes.js': `export const SITES = { 'app.example.com': { root: 'app/' } };\n// two\n`,
    'worker/headers.js': headers(importMapHash(html('1.3.11'))).replace('X = 1', 'X = 2'),
    'app/index.html': html('1.3.11'),
    'app/public/sw.js': sw('// code v2', ['./', 'src/a.js', 'src/b.js']),
    'app/src/config.js': 'export const APP = { template: true };\n',
    'package.json': pkg('1.3.11'),
    'new/tool.mjs': `// for app.example.com\n`,
    'old.md': null,
    'changed-by-app.md': null,
  }, 'next');
  const r = update({ dir: app, from: tpl, install: false, checkLatest: false, log: () => {} });
  const read = f => fs.readFileSync(path.join(app, f), 'utf8');
  assert.equal(r.behind, 1);
  assert.deepEqual(r.conflicts, []);
  assert.equal(read('README.md').split('\n')[0], '# Pet log', 'the app\'s line kept');
  assert.match(read('README.md'), /line 19, reworded/, 'the template\'s line merged in');
  assert.match(read('worker/routes.js'), /'pets\.example\.org'.*\n\/\/ two/, 'swapped and updated');
  assert.equal(read('new/tool.mjs'), '// for pets.example.org\n', 'added, with the app\'s values');
  assert.ok(!fs.existsSync(path.join(app, 'old.md')), 'deleted (the app never changed it)');
  assert.equal(read('changed-by-app.md'), 'app text\n', 'kept: the app changed it');
  assert.equal(read('app/src/config.js'), 'export const APP = { name: "pet-log" };\n', 'ignored by default');
  assert.match(read('app/public/sw.js'), /code v2/);
  assert.match(read('app/public/sw.js'), /'src\/pets\.js'/, 'SHELL is the app\'s (regenerated later), never a conflict');
  assert.match(read('worker/headers.js'), /X = 2/);
  assert.match(read('worker/headers.js'), new RegExp(`IMPORT_MAP = "${importMapHash(read('app/index.html')).replace(/[+/]/g, '\\$&')}"`), 'hash matches the new import map');
  assert.deepEqual(syncVersions(read('app/index.html'), read('package.json')), { map: ['1.3.11'], dep: '1.3.11' });
  assert.equal(JSON.parse(read('.starter.json')).commit, to.slice(0, 7));
  assert.deepEqual(JSON.parse(read('.starter.json')).app, APP);
});

test('a file the template moved into a module\'s recipe stays in the app that has it, and the module is recorded', () => {
  const { tpl, app } = setup();
  const to = commit(tpl, {
    'old.md': null,
    'recipes/old.json': JSON.stringify({ module: 'old', root: 'recipes/old', files: [{ from: 'old.md' }] }),
    'recipes/old/old.md': 'to be deleted\n',
  }, 'old.md becomes the old recipe');
  const r = update({ dir: app, from: tpl, install: false, checkLatest: false, log: () => {} });
  assert.equal(fs.readFileSync(path.join(app, 'old.md'), 'utf8'), 'to be deleted\n', 'kept, though the app never changed it');
  assert.deepEqual(r.changes.filter(c => c.path === 'old.md').map(c => c.action), ['kept']);
  assert.equal(JSON.parse(fs.readFileSync(path.join(app, '.starter.json'), 'utf8')).modules.old, `x/app-starter@${to.slice(0, 7)}:recipes/old.json`);
});

test('a line changed on both sides is a conflict; --dry-run changes nothing; ignore and rename from .starter.json', () => {
  const { tpl, app } = setup();
  commit(tpl, { 'README.md': ['# Template', ...lines(20).slice(1)].join('\n') + '\n', 'icon.png': Buffer.from([9]), 'worker/routes.js': '// moved\n' }, 'next');
  const meta = JSON.parse(fs.readFileSync(path.join(app, '.starter.json'), 'utf8'));
  fs.writeFileSync(path.join(app, '.starter.json'), JSON.stringify({ ...meta, update: { ignore: ['icon.*'], rename: { 'worker/routes.js': 'worker/sites-map.js' } } }));
  fs.renameSync(path.join(app, 'worker/routes.js'), path.join(app, 'worker/sites-map.js'));
  const before = fs.readFileSync(path.join(app, 'README.md'), 'utf8');
  const dry = update({ dir: app, from: tpl, dryRun: true, install: false, checkLatest: false, log: () => {} });
  assert.deepEqual(dry.conflicts, ['README.md']);
  assert.equal(fs.readFileSync(path.join(app, 'README.md'), 'utf8'), before, 'dry run');
  const r = update({ dir: app, from: tpl, install: false, checkLatest: false, log: () => {} });
  assert.deepEqual(r.conflicts, ['README.md']);
  assert.match(fs.readFileSync(path.join(app, 'README.md'), 'utf8'), /<<<<<<< app\n# Pet log\n[|=]/);
  assert.ok(r.changes.some(c => c.action === 'ignored' && c.path === 'icon.png'));
  assert.equal(fs.readFileSync(path.join(app, 'worker/sites-map.js'), 'utf8'), '// moved\n', 'merged into the app\'s renamed file');
  assert.ok(!fs.existsSync(path.join(app, 'worker/routes.js')));
});

test('files with non-ASCII names are brought in, not crashed on', () => {
  const { tpl, app } = setup();
  commit(tpl, { 'docs/café notes.md': 'accent\n', 'docs/"quoted".md': 'q\n' }, 'odd names');
  const r = update({ dir: app, from: tpl, install: false, checkLatest: false, log: () => {} });
  assert.deepEqual(r.conflicts, []);
  assert.equal(fs.readFileSync(path.join(app, 'docs/café notes.md'), 'utf8'), 'accent\n');
  assert.equal(fs.readFileSync(path.join(app, 'docs/"quoted".md'), 'utf8'), 'q\n');
});

test('an app checkout with CRLF line endings merges line by line and keeps CRLF', () => {
  const { tpl, app } = setup();
  const readme = lines(20); readme[10] = 'line 10, reworded';
  commit(tpl, { 'README.md': readme.join('\n') + '\n' }, 'edit');
  const own = ['# Pet log', ...lines(20).slice(1)]; 
  fs.writeFileSync(path.join(app, 'README.md'), own.join('\r\n') + '\r\n');
  const r = update({ dir: app, from: tpl, install: false, checkLatest: false, log: () => {} });
  assert.deepEqual(r.conflicts, []);
  const text = fs.readFileSync(path.join(app, 'README.md'), 'utf8');
  assert.ok(text.startsWith('# Pet log\r\n') && text.includes('line 10, reworded\r\n') && !/[^\r]\n/.test(text));
});

test('the import map\'s CSP hash is the same for a CRLF checkout', () => {
  assert.equal(importMapHash(html('1.3.10').replace(/\n/g, '\r\n')), importMapHash(html('1.3.10')));
});

test('--behind counts the template commits since the app\'s base', () => {
  const { tpl, app } = setup();
  commit(tpl, { 'a.md': '1\n' }, 'one');
  commit(tpl, { 'a.md': '2\n' }, 'two');
  assert.equal(update({ dir: app, from: tpl, dryRun: true, checkLatest: false, log: () => {} }).behind, 2);
  assert.throws(() => update({ dir: app, from: tpl, base: 'nope', dryRun: true, checkLatest: false, log: () => {} }));
});

test('--find-base picks the template commit the app was made from when .starter.json has none', () => {
  const { tpl, app, base } = setup();
  commit(tpl, { 'worker/routes.js': '// later\n', 'README.md': 'rewritten\n' }, 'later');
  const meta = JSON.parse(fs.readFileSync(path.join(app, '.starter.json'), 'utf8'));
  fs.writeFileSync(path.join(app, '.starter.json'), JSON.stringify({ ...meta, commit: '' }));
  assert.equal(findBase(tpl, 'main', { ...meta, commit: '' }, app).sha, base);
  assert.throws(() => update({ dir: app, from: tpl, dryRun: true, checkLatest: false, log: () => {} }), /--find-base/);
  assert.equal(update({ dir: app, from: tpl, findBase: true, dryRun: true, checkLatest: false, log: () => {} }).from, base.slice(0, 7));
});

test('--sync bumps app-sync\'s two names and the hash', () => {
  const { app } = setup();
  bumpSyncIn(app, '1.4.0', { install: false, log: () => {} });
  const h = fs.readFileSync(path.join(app, 'app/index.html'), 'utf8');
  assert.deepEqual(syncVersions(h, fs.readFileSync(path.join(app, 'package.json'), 'utf8')), { map: ['1.4.0'], dep: '1.4.0' });
  assert.ok(fs.readFileSync(path.join(app, 'worker/headers.js'), 'utf8').includes(importMapHash(h)));
  assert.throws(() => bumpSyncIn(app, 'v1', { log: () => {} }));
});

test('--sync takes prerelease pins, in both names', () => {
  const { app } = setup();
  const was = fs.readFileSync(path.join(app, 'app/index.html'), 'utf8');
  fs.writeFileSync(path.join(app, 'app/index.html'), was.replace('1.3.10', '1.4.0-rc.1'));
  fs.writeFileSync(path.join(app, 'package.json'), pkg('1.4.0-rc.1').replace('starter-app', 'pet-log'));
  assert.deepEqual(syncVersions(fs.readFileSync(path.join(app, 'app/index.html'), 'utf8'), fs.readFileSync(path.join(app, 'package.json'), 'utf8')), { map: ['1.4.0-rc.1'], dep: '1.4.0-rc.1' });
  bumpSyncIn(app, '1.4.0', { install: false, log: () => {} });
  assert.deepEqual(syncVersions(fs.readFileSync(path.join(app, 'app/index.html'), 'utf8'), fs.readFileSync(path.join(app, 'package.json'), 'utf8')), { map: ['1.4.0'], dep: '1.4.0' });
  bumpSyncIn(app, '1.5.0-rc.2', { install: false, log: () => {} });
  assert.deepEqual(syncVersions(fs.readFileSync(path.join(app, 'app/index.html'), 'utf8'), fs.readFileSync(path.join(app, 'package.json'), 'utf8')), { map: ['1.5.0-rc.2'], dep: '1.5.0-rc.2' });
  assert.throws(() => bumpSyncIn(app, '1.5.0-', { install: false, log: () => {} }));
});

test('--sync moves the lock to the new tag with npm install of that tag', () => {
  const { app } = setup();
  const calls = [];
  bumpSyncIn(app, '1.4.0', { log: () => {}, exec: (cmd, args) => { calls.push([cmd, ...args]); } });
  assert.deepEqual(calls.filter(c => c[0] === 'npm'), [['npm', 'install', '--save-dev', '--no-audit', '--no-fund', 'app-sync@github:flamingbeing/app-sync#v1.4.0']]);
});

test('--sync refreshes the e2e core fixtures: the pinned version\'s folder, then the download', () => {
  const { app } = setup();
  writeAll(app, { 'e2e/fixtures/core/sync/1.3.10/app.js': 'old\n', 'e2e/fixtures/core/update/0.2.0/register.js': 'update\n', 'tools/refresh-core-fixtures.sh': '#!/bin/sh\n' });
  const calls = [];
  bumpSyncIn(app, '1.4.0', { log: () => {}, exec: (cmd, args) => { calls.push([cmd, ...args]); } });
  assert.ok(fs.existsSync(path.join(app, 'e2e/fixtures/core/sync/1.4.0/app.js')));
  assert.ok(!fs.existsSync(path.join(app, 'e2e/fixtures/core/sync/1.3.10')));
  assert.ok(fs.existsSync(path.join(app, 'e2e/fixtures/core/update/0.2.0/register.js')), 'other kits left alone');
  assert.ok(calls.some(c => c[0] === 'bash' && c[1] === 'tools/refresh-core-fixtures.sh'));
  // --no-install: the folder is renamed, nothing downloaded
  const second = setup().app;
  writeAll(second, { 'e2e/fixtures/core/sync/1.3.10/app.js': 'old\n', 'tools/refresh-core-fixtures.sh': '#!/bin/sh\n' });
  const none = [];
  bumpSyncIn(second, '1.4.0', { install: false, log: () => {}, exec: (...a) => none.push(a) });
  assert.deepEqual(none, []);
  assert.ok(fs.existsSync(path.join(second, 'e2e/fixtures/core/sync/1.4.0/app.js')));
});

test('helpers', () => {
  assert.ok(globRe('docs/**').test('docs/a/b.md'));
  assert.ok(globRe('**/*.png').test('a/b/c.png') && globRe('**/*.png').test('c.png'));
  assert.ok(!globRe('*.md').test('docs/a.md'));
  assert.ok(globRe('icon.?ng').test('icon.png'));
  assert.deepEqual(bumpSync(html('1.0.0'), pkg('1.0.0'), '2.0.0'), { html: html('2.0.0'), pkg: pkg('2.0.0') });
  assert.deepEqual(devkitPins({ 'c.yml': 'uses: flamingbeing/app-devkit/setup-node@v1.9.2\n  devkit-ref: v1.9.2\nuses: flamingbeing/app-devkit/.github/workflows/live-smoke.yml@v1.10.1' }),
    [{ file: 'c.yml', what: 'setup-node', ver: 'v1.9.2' }, { file: 'c.yml', what: 'devkit-ref', ver: 'v1.9.2' }, { file: 'c.yml', what: '.github/workflows/live-smoke.yml', ver: 'v1.10.1' }]);
  assert.ok(older('v1.9.2', 'v1.10.3') && !older('v1.10.3', 'v1.10.3') && !older('v2.0.0', 'v1.10.3'));
  assert.deepEqual(merge3('A\nb\nc\nd\n', 'a\nb\nc\nd\n', 'a\nb\nc\nD\n'), { text: 'A\nb\nc\nD\n', conflicts: 0 });
  assert.deepEqual(parseArgs(['--behind', '5', '--dir', 'x']), { install: true, behind: 5, dir: 'x' });
  assert.equal(parseArgs(['--behind']).behind, Infinity);
});
