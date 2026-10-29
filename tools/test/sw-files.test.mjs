// tools/sw-files.mjs on made-up app folders and a made-up app-sync and app-ui. node --test tools/test/sw-files.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { shellFiles, writeShell } from '../sw-files.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const CORE = 'https://core.anawj.com/sync/1.2.3/';
const SW = `const VERSION = 'app-v1';\nconst SHELL = [\n  './',\n];\nconst MANIFEST = {};\n`;
function tree(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sw-files-'));
  for (const [f, body] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true });
    fs.writeFileSync(path.join(dir, f), body);
  }
  return dir;
}
const page = imports => `<!doctype html><script type="importmap">\n${JSON.stringify({ imports })}\n</script>`;
// a made-up app-sync 1.2.3: two entries sharing src/shared.js, one file only the unused index.js loads
const engine = () => tree({
  'package.json': JSON.stringify({ name: 'app-sync', version: '1.2.3' }),
  'app.js': "export { createApp } from './src/runner.js';\n",
  'sync.js': "import { a } from './src/shared.js';\nexport * from './src/module-sync.js';\n",
  'index.js': "import './src/only-index.js';\n",
  'src/runner.js': "/** @typedef {import('./types.js').Doc} Doc */\nimport { a } from './shared.js';\nexport const createApp = () => a;\n",
  'src/module-sync.js': "export const sync = 1;\n",
  'src/shared.js': "export const a = 1;\n",
  'src/only-index.js': '',
});

test('lists the page, its own files (public/ as served at the root) and the files each core entry loads', () => {
  const sync = engine();
  const dir = tree({
    'index.html': page({ '@core/app': CORE + 'app.js', '@core/sync': CORE + 'sync.js', 'reg': 'https://core.anawj.com/update/0.2.0/register.js', 'firebase/app': './vendor/fb/firebase-app.js' }),
    'src/app.js': '', 'src/config.js': '',
    'public/sw.js': SW, 'public/app.css': '', 'public/icons/icon.svg': '', 'public/vendor/fb/firebase-app.js': '',
    'test/x.unit.test.mjs': '', 'firestore.rules': '', 'firestore.app.rules': '', 'firebase.json': '', 'src/globals.d.ts': '', '.hidden': '', 'firestore-debug.log': '',
  });
  assert.deepEqual(shellFiles({ dir, sync }), [
    './', 'app.css', 'icons/icon.svg', 'src/app.js', 'src/config.js', 'vendor/fb/firebase-app.js',
    'https://core.anawj.com/update/0.2.0/register.js',
    CORE + 'app.js', CORE + 'src/runner.js', CORE + 'src/shared.js', CORE + 'sync.js', CORE + 'src/module-sync.js',
  ]);
});

test('a built folder (no public/, bundled assets) is listed the same way', () => {
  const dir = tree({ 'index.html': page({ '@core/app': CORE + 'app.js' }), 'assets/index-abc.js': '', 'sw.js': SW, 'app.css': '' });
  assert.deepEqual(shellFiles({ dir, sync: engine() }), ['./', 'app.css', 'assets/index-abc.js', CORE + 'app.js', CORE + 'src/runner.js', CORE + 'src/shared.js']);
});

test('refuses an engine checkout at another version than the import map, a missing file and a bare import', () => {
  const dir = tree({ 'index.html': page({ '@core/app': 'https://core.anawj.com/sync/1.2.4/app.js' }), 'sw.js': SW });
  assert.throws(() => shellFiles({ dir, sync: engine() }), /1\.2\.4.*1\.2\.3/);
  const gone = tree({ 'index.html': page({ 'firebase/app': './vendor/fb/firebase-app.js' }), 'sw.js': SW });
  assert.throws(() => shellFiles({ dir: gone, sync: engine() }), /vendor\/fb\/firebase-app\.js/);
  const bare = engine();
  fs.writeFileSync(path.join(bare, 'app.js'), "import x from 'firebase/app';\n");
  const d2 = tree({ 'index.html': page({ '@core/app': CORE + 'app.js' }), 'sw.js': SW });
  assert.throws(() => shellFiles({ dir: d2, sync: bare }), /firebase\/app/);
});

test('app-ui: the import map entries, and the style sheets and scripts the page links, with what they import', () => {
  const UI = 'https://core.anawj.com/ui/1.0.0-rc.11/';
  const ui = tree({
    'package.json': JSON.stringify({ name: 'app-ui', version: '1.0.0-rc.11' }),
    'ui/index.js': "export * from './toast.js';\n", 'ui/toast.js': "import { el } from '../theme/dom.js';\n", 'theme/dom.js': '',
    'theme/index.js': "import { el } from './dom.js';\n", 'theme/early.js': '', 'ui/ui.css': '', 'kit/index.html': '',
  });
  const html = page({ '@core/ui': UI + 'ui/index.js', '@core/theme': UI + 'theme/index.js' })
    + `<script src="${UI}theme/early.js"></script><link rel="stylesheet" href="${UI}ui/ui.css"><link rel="icon" href="${UI}icons/icon.svg">`
    + '<link rel="stylesheet" href="https://design.example/tokens.css">';
  const dir = tree({ 'index.html': html, 'sw.js': SW });
  assert.deepEqual(shellFiles({ dir, sync: engine(), ui }), [
    './', UI + 'ui/index.js', UI + 'ui/toast.js', UI + 'theme/dom.js', UI + 'theme/index.js', UI + 'ui/ui.css', UI + 'theme/early.js',
  ]);
  const old = tree({ 'index.html': page({ '@core/ui': 'https://core.anawj.com/ui/0.9.0/ui/index.js' }), 'sw.js': SW });
  assert.throws(() => shellFiles({ dir: old, sync: engine(), ui }), /app-ui 0\.9\.0.*1\.0\.0-rc\.11/);
});

test('writes the list into sw.js, and --check fails until it is written', () => {
  const dir = tree({ 'index.html': page({}), 'src/app.js': '', 'public/sw.js': SW });
  assert.throws(() => writeShell({ dir, sync: engine(), check: true }), /out of date/);
  writeShell({ dir, sync: engine() });
  const src = fs.readFileSync(path.join(dir, 'public/sw.js'), 'utf8');
  assert.match(src, /const SHELL = \[\n {2}'\.\/',\n {2}'src\/app\.js',\n\];/);
  assert.match(src, /const VERSION = 'app-v1';[\s\S]*const MANIFEST = \{\};/);
  assert.doesNotThrow(() => writeShell({ dir, sync: engine(), check: true }));
});

test("the starter's own sw.js is up to date with app/ and the pinned app-sync and app-ui", { skip: !['app-sync', 'app-ui'].every(p => fs.existsSync(path.join(ROOT, `node_modules/${p}/package.json`))) && 'no node_modules/app-sync or app-ui (npm ci)' }, () => {
  assert.doesNotThrow(() => writeShell({ dir: path.join(ROOT, 'app'), check: true }));
});
