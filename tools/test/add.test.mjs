// tools/add.mjs: its edits, the search recipe's remove + add round trip on a copy of this repo, and a re-add from a
// newer source merging into a file the app changed. node --test tools/test/add.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { add, putLine, dropLine, putBlock, dropBlock, editImportMap, editInclude, resolveSource, pinned, parseArgs } from '../add.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SKIP = new Set(['.git', 'node_modules', '.devkit', 'dist', 'test-results', 'playwright-report']);
const quiet = () => {};
const read = (dir, rel) => fs.readFileSync(path.join(dir, rel), 'utf8');

// this repo's files, without git and installs (node_modules linked, for sw-files)
function copyRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'add-app-'));
  fs.cpSync(ROOT, dir, { recursive: true, filter: src => !SKIP.has(path.basename(src)) });
  fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(dir, 'node_modules'));
  return dir;
}
// every file under dir: { rel: Buffer }
function tree(dir, rel = '') {
  const out = {};
  for (const e of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (SKIP.has(e.name)) continue;
    if (e.isDirectory()) Object.assign(out, tree(dir, r));
    else out[r] = fs.readFileSync(path.join(dir, r));
  }
  return out;
}

test('putLine and dropLine: after the anchor, one line per key, idempotent', () => {
  const t = 'a\n  // add: x\nb\n';
  const once = putLine(t, '// add: x', '  one,');
  assert.equal(once, 'a\n  // add: x\n  one,\nb\n');
  assert.equal(putLine(once, '// add: x', '  one,'), once);
  assert.equal(putLine(once, '// add: x', '  one: 2,', 'one'), 'a\n  // add: x\n  one: 2,\nb\n');
  assert.equal(dropLine(once, '  one,'), t);
  assert.throws(() => putLine(t, '// add: y', 'z'), /no line holding/);
});

test('editImportMap keeps the page\'s formatting; editInclude adds and takes out globs', () => {
  const html = read(ROOT, 'app/index.html');
  assert.equal(editImportMap(html, {}), html);
  const added = editImportMap(html, { '@core/zed': './zed/index.js' });
  assert.match(added, /"@core\/zed": "\.\/zed\/index\.js"/);
  assert.equal(editImportMap(added, { '@core/zed': null }), html);
  const ts = '{\n  "include": ["a", "b"]\n}\n';
  assert.equal(editInclude(ts, ['c', 'a']), '{\n  "include": ["a", "b", "c"]\n}\n');
  assert.equal(editInclude(ts, ['a'], true), '{\n  "include": ["b"]\n}\n');
});

test('putBlock / dropBlock: several lines after the anchor, idempotent, taken out again whole', () => {
  const t = 'a\n  // add: r\nb\n';
  const once = putBlock(t, '// add: r', ['  x,', '  y,']);
  assert.equal(once, 'a\n  // add: r\n  x,\n  y,\nb\n');
  assert.equal(putBlock(once, '// add: r', ['  x,', '  y,']), once);
  assert.equal(dropBlock(once, ['  x,', '  y,']), t);
});

test('resolveSource: a bare name is the template\'s recipe at the app\'s commit, local without one', () => {
  assert.equal(resolveSource('search', { template: 'o/app-starter', commit: 'abc1234' }), 'o/app-starter@abc1234:recipes/search.json');
  assert.equal(resolveSource('search', { template: 'o/app-starter', commit: '' }), 'recipes/search.json');
  assert.equal(resolveSource('o/r@v1.0.0:recipes/x.json', {}), 'o/r@v1.0.0:recipes/x.json');
  assert.deepEqual(parseArgs(['--remove', 'search', '--dir', 'x']), { remove: true, source: 'search', dir: 'x' });
  assert.throws(() => parseArgs([]), /name a recipe/);
});

// the lean base takes a module in and out again: no trace left, the same files back, a second add changes nothing
for (const [module, gone, grep] of [
  ['search', ['app/public/search/index.js', 'app/src/screens/list-search.js', 'e2e/search.spec.mjs', 'app/public/vendor/minisearch'], /search/i],
  // cloud{ the files module needs the cloud (a static app has no recipes/files)
  ['files', ['app/public/files/index.js', 'app/src/files-data.js', 'worker/files.js', 'app/public/vendor/exifr', 'e2e/memory-bucket.mjs'], /@core\/files|memoryBucket|filesData/],
  // }cloud
]) {
  test(`${module}: add brings it in, --remove leaves the lean app with no trace of it; a second add changes nothing`, () => {
    const dir = copyRepo();
    try {
      const recipe = path.join(ROOT, `recipes/${module}.json`);
      const lean = tree(dir);
      for (const f of gone) assert.ok(!fs.existsSync(path.join(dir, f)), `lean: ${f}`);
      add({ source: recipe, dir, log: quiet });
      for (const f of gone) assert.ok(fs.existsSync(path.join(dir, f)), `added: ${f}`);
      assert.equal(JSON.parse(read(dir, '.starter.json')).modules[module], recipe);
      assert.deepEqual(add({ source: recipe, dir, log: quiet }).changes, []);

      add({ source: module, remove: true, dir, log: quiet });
      const back = tree(dir);
      assert.deepEqual(Object.keys(back).sort(), Object.keys(lean).sort());
      for (const rel of Object.keys(lean)) if (rel !== '.starter.json') assert.ok(back[rel].equals(lean[rel]), rel);
      for (const rel of ['app/index.html', 'app/src/modules.js', 'tsconfig.json', 'vite.config.mjs'])
        assert.doesNotMatch(read(dir, rel), grep, rel);
      assert.equal(JSON.parse(read(dir, '.starter.json')).modules, undefined);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
}

// a recipe repo at github/<owner>/<repo> with two commits, and a small app that took its first one
function recipeRepos() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'add-src-'));
  const repo = path.join(base, 'o/mods');
  fs.mkdirSync(repo, { recursive: true });
  const git = (...a) => execFileSync('git', ['-C', repo, ...a], { encoding: 'utf8' }).trim();
  const lines = n => Array.from({ length: n }, (_, i) => `line ${i}`).join('\n') + '\n';
  const recipe = { module: 'thing', files: [{ from: 'thing' }, { to: 'app/src/modules.js', after: '// add: imports', line: "import './thing.js';" }], cssVars: { '--thing': '1rem' }, needs: ['turn the thing on'] };
  const put = files => { for (const [rel, text] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(repo, rel)), { recursive: true }); fs.writeFileSync(path.join(repo, rel), text); } };
  const commit = () => { git('add', '-A'); git('-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '-qm', 'x'); return git('rev-parse', 'HEAD'); };
  git('init', '-q', '-b', 'main');
  put({ 'recipes/thing.json': JSON.stringify(recipe), 'thing/a.txt': lines(10) });
  const v1 = commit();
  put({ 'thing/a.txt': lines(10).replace('line 1\n', 'line 1 (v2)\n') });
  const v2 = commit();
  const app = fs.mkdtempSync(path.join(os.tmpdir(), 'add-small-'));
  fs.mkdirSync(path.join(app, 'app/src'), { recursive: true });
  fs.writeFileSync(path.join(app, '.starter.json'), JSON.stringify({ template: 'o/app-starter', commit: '' }));
  fs.writeFileSync(path.join(app, 'app/src/modules.js'), '// add: imports\n');
  return { base, app, v1, v2, lines };
}

test('a source <owner/repo>@<sha>; re-added from a newer one, a file the app changed is merged three-way', () => {
  const { base, app, v1, v2, lines } = recipeRepos();
  try {
    const opts = { dir: app, github: base, refresh: false, log: quiet };
    const first = add({ source: `o/mods@${v1}:recipes/thing.json`, ...opts });
    assert.deepEqual(first.changes.map(c => `${c.action} ${c.path}`), ['added thing/a.txt', 'edited app/public/app.css', 'edited app/public/app.css', 'edited app/src/modules.js']);
    assert.equal(read(app, 'app/src/modules.js'), "// add: imports\nimport './thing.js';\n");
    assert.equal(read(app, 'app/public/app.css'), ':root {\n  /* add: cssVars */\n  --thing: 1rem;\n}\n');
    fs.writeFileSync(path.join(app, 'thing/a.txt'), lines(10).replace('line 8\n', 'line 8 (app)\n'));
    const second = add({ source: `o/mods@${v2}:recipes/thing.json`, ...opts });
    assert.deepEqual(second.changes.map(c => `${c.action} ${c.path}`), ['merged thing/a.txt']);
    assert.equal(read(app, 'thing/a.txt'), lines(10).replace('line 1\n', 'line 1 (v2)\n').replace('line 8\n', 'line 8 (app)\n'));
    assert.equal(JSON.parse(read(app, '.starter.json')).modules.thing, `o/mods@${v2}:recipes/thing.json`);
    const gone = add({ source: 'thing', remove: true, ...opts });
    assert.deepEqual(gone.changes.map(c => `${c.action} ${c.path}`), ['kept thing/a.txt', 'edited app/public/app.css', 'edited app/src/modules.js']);
  } finally { fs.rmSync(base, { recursive: true, force: true }); fs.rmSync(app, { recursive: true, force: true }); }
});

test('pinned: the template\'s own recipe in a filled app is the template\'s at its commit; outside paths and remotes stay', () => {
  const meta = { template: 'o/app-starter', commit: 'abc1234' };
  assert.equal(pinned('recipes/search.json', meta, '/app'), 'o/app-starter@abc1234:recipes/search.json');
  assert.equal(pinned('recipes/search.json', { ...meta, commit: '' }, '/app'), null);
  assert.equal(pinned('/elsewhere/recipes/x.json', meta, '/app'), '/elsewhere/recipes/x.json');
  assert.equal(pinned('o/r@v1:recipes/x.json', meta, '/app'), 'o/r@v1:recipes/x.json');
});

test('putLine / dropLine: a reformatted line is still the same line; only the anchor\'s block is touched', () => {
  const js = '// add: imports\nimport { a } from "./a.js"\n\nconst x = 1;\n';
  assert.equal(putLine(js, '// add: imports', "import { a } from './a.js';"), "// add: imports\nimport { a } from './a.js';\n\nconst x = 1;\n");
  assert.equal(dropLine(js, "import { a } from './a.js';", '// add: imports'), '// add: imports\n\nconst x = 1;\n');
  const css = ':root {\n  /* add: cssVars */\n  --t: 1rem;\n}\n@media (x) { :root {\n  --t: 2rem;\n} }\n';
  assert.equal(putLine(css, '/* add: cssVars */', '  --t: 3rem;', '--t:'), css.replace('1rem', '3rem'));
  assert.equal(dropLine(css, '--t:', '/* add: cssVars */'), css.replace('  --t: 1rem;\n', ''));
});

test('--dry-run changes nothing, even when it has to make the cssVars block first', () => {
  const { base, app, v1 } = recipeRepos();
  try {
    const r = add({ source: `o/mods@${v1}:recipes/thing.json`, dir: app, github: base, refresh: false, dryRun: true, log: quiet });
    assert.deepEqual(r.changes.map(c => c.action), ['added', 'edited', 'edited', 'edited']);
    assert.ok(!fs.existsSync(path.join(app, 'app/public/app.css')));
    assert.ok(!fs.existsSync(path.join(app, 'thing')));
  } finally { fs.rmSync(base, { recursive: true, force: true }); fs.rmSync(app, { recursive: true, force: true }); }
});

test('re-added from a recipe that dropped a file: the file goes when unchanged, stays when the app changed it', () => {
  const { base, app, v1 } = recipeRepos();
  const repo = path.join(base, 'o/mods');
  const git = (...a) => execFileSync('git', ['-C', repo, ...a], { encoding: 'utf8' }).trim();
  try {
    const opts = { dir: app, github: base, refresh: false, log: quiet };
    git('checkout', '-q', v1);
    fs.writeFileSync(path.join(repo, 'thing/b.txt'), 'b\n');
    fs.writeFileSync(path.join(repo, 'thing/c.txt'), 'c\n');
    git('add', '-A'); git('-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '-qm', 'b c');
    const withBC = git('rev-parse', 'HEAD');
    git('rm', '-q', 'thing/b.txt', 'thing/c.txt'); git('-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '-qm', 'no b c');
    const without = git('rev-parse', 'HEAD');
    add({ source: `o/mods@${withBC}:recipes/thing.json`, ...opts });
    fs.writeFileSync(path.join(app, 'thing/c.txt'), 'c (app)\n');
    const r = add({ source: `o/mods@${without}:recipes/thing.json`, ...opts });
    assert.deepEqual(r.changes.map(c => `${c.action} ${c.path}`), ['deleted thing/b.txt', 'kept thing/c.txt']);
  } finally { fs.rmSync(base, { recursive: true, force: true }); fs.rmSync(app, { recursive: true, force: true }); }
});
