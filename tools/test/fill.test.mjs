// tools/fill.mjs on a scratch copy of this repo. node --test tools/test/fill.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fill, parseArgs } from '../fill.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SKIP = new Set(['.git', 'node_modules', '.devkit', 'test-results', 'playwright-report']);
function copy({ deps = true } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fill-'));
  fs.cpSync(ROOT, dir, { recursive: true, filter: src => !SKIP.has(path.basename(src)) });
  if (deps) fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(dir, 'node_modules'), 'junction');   // sw.js's list reads app-sync and app-ui
  // these tests are the starter's own: an app that took in this file (tools/update-from-starter.mjs) has modules, which a fresh render refuses
  const metaPath = path.join(dir, '.starter.json');
  const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
  if (meta.modules) { delete meta.modules; fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2) + '\n'); }
  return dir;
}
const read = (dir, f) => fs.readFileSync(path.join(dir, f), 'utf8');
const ARGS = { name: 'pet-log', host: 'pets.example.org', kit: 'nuhs', project: 'pet-log-app' };
const { project: _, ...STATIC } = ARGS;   // a static app has no Firebase project

// cloud{ the cloud's own files (a static app has no live smoke test, rules or web config)
test('the live smoke test\'s secret names follow the app name', () => {
  const dir = copy();
  fill({ dir, ...ARGS });
  const w = read(dir, '.github/workflows/live-smoke.yml');
  assert.match(w, /secrets\.PET_LOG_TEST_EMAIL/);
  assert.match(w, /secrets\.PET_LOG_TEST_PASSWORD/);
  assert.doesNotMatch(w, /STARTER_APP/);
  assert.match(w, /site-url: https:\/\/pets\.example\.org/);
});

test('fills name, host, kit and project everywhere', () => {
  const dir = copy();
  const { changed } = fill({ dir, ...ARGS });
  assert.ok(changed.includes('app/src/config.js') && changed.includes('wrangler.jsonc') && changed.includes('worker/routes.js'));
  assert.match(read(dir, 'worker/routes.js'), /'pets\.example\.org': \{ root: 'app\/' \}/);
  const w = read(dir, 'wrangler.jsonc');
  assert.match(w, /"name": "pet-log"/);
  assert.match(w, /"FIREBASE_PROJECT": "pet-log-app"/);
  assert.match(w, /"pattern": "pets\.example\.org"/);
  const cfg = read(dir, 'app/src/config.js');
  assert.match(cfg, /"projectId": "pet-log-app"/);
  assert.match(cfg, /"authDomain": "pets\.example\.org"/);
  assert.match(cfg, /KIT = 'https:\/\/design\.anawj\.com\/v1\/'/);
  assert.match(read(dir, 'app/index.html'), /<title>Pet log<\/title>[\s\S]*https:\/\/design\.anawj\.com\/v1\/tokens\.css/);
  assert.match(read(dir, 'worker/headers.js'), /KIT = 'https:\/\/design\.anawj\.com'/);
  // the emulator project follows the name, and stays a demo- one
  assert.match(read(dir, 'playwright.config.mjs'), /demo-pet-log/);
  assert.match(read(dir, 'app/test/rules.test.mjs'), /project: 'demo-pet-log'/);
  for (const f of ['app/index.html', 'app/public/sw.js', 'worker/routes.js', 'wrangler.jsonc', 'package.json'])
    assert.doesNotMatch(read(dir, f), /starter-app|app\.example\.com|design\.flamingbeing\.com/, f);
  assert.deepEqual(JSON.parse(read(dir, '.starter.json')).app, { ...ARGS, title: 'Pet log' });
  for (const f of ['worker/claims.js', 'worker/custom-token.js']) assert.equal(read(dir, f), read(ROOT, f), `${f} is app-devkit's`);
});
// }cloud

test('running it again changes nothing; --check says so', () => {
  const dir = copy();
  fill({ dir, ...ARGS });
  assert.deepEqual(fill({ dir, ...ARGS, check: true }).changed, []);
  assert.deepEqual(fill({ dir, ...ARGS }).changed, []);
});

// cloud{ the web config (a static app has none)
test('the web config adds apiKey and appId, and is kept on a re-run', () => {
  const dir = copy();
  const web = path.join(dir, 'web.json');
  fs.writeFileSync(web, JSON.stringify({ sdkConfig: { projectId: 'pet-log-app', apiKey: 'AIzaFAKE', appId: '1:2:web:3', authDomain: 'pet-log-app.firebaseapp.com' } }));
  fill({ dir, ...ARGS, 'web-config': web });
  const cfg = read(dir, 'app/src/config.js');
  assert.match(cfg, /"apiKey": "AIzaFAKE"/);
  assert.match(cfg, /"authDomain": "pets\.example\.org"/, 'sign-in stays on the app address');
  fill({ dir, ...ARGS, title: 'Pets' });
  assert.match(read(dir, 'app/src/config.js'), /"apiKey": "AIzaFAKE"/);
  assert.match(read(dir, 'app/index.html'), /<title>Pets<\/title>/);
});
// }cloud

test("--accent sets the default look's colour, kept on a re-run; a bad one is refused", () => {
  const dir = copy();
  fill({ dir, ...ARGS });
  assert.match(read(dir, 'app/src/config.js'), /"accent":"#3a6390"/, "the template's colour by default");
  fill({ dir, ...ARGS, accent: '#0F766E' });
  assert.match(read(dir, 'app/src/config.js'), /"accent":"#0f766e"/);
  fill({ dir, ...ARGS, title: 'Pets' });
  assert.match(read(dir, 'app/src/config.js'), /"accent":"#0f766e"/);
  assert.throws(() => fill({ dir, ...ARGS, accent: 'teal' }), /--accent 'teal'/);
  assert.deepEqual(parseArgs(['--accent', '#123456']), { accent: '#123456' });
});

// cloud{
test('a web config for another project is refused', () => {
  const dir = copy();
  const web = path.join(dir, 'web.json');
  fs.writeFileSync(web, JSON.stringify({ projectId: 'other-project', apiKey: 'x', appId: 'y' }));
  assert.throws(() => fill({ dir, ...ARGS, 'web-config': web }), /for project other-project/);
});

test('--static renders the static app, then fills it: no Firebase, sw.js and the import-map hash follow', () => {
  const dir = copy();
  const { changed } = fill({ dir, ...STATIC, static: true });
  assert.equal(JSON.parse(read(dir, '.starter.json')).flavour, 'static');
  assert.equal(JSON.parse(read(dir, '.starter.json')).app.project, '', 'no Firebase project until add cloud');
  assert.match(read(dir, 'wrangler.jsonc'), /"FIREBASE_PROJECT": ""/);
  assert.ok(changed.includes('app/src/config.js'));
  const cfg = read(dir, 'app/src/config.js');
  assert.doesNotMatch(cfg, /firebaseConfig/);
  assert.match(cfg, /"name":"pet-log"/);
  for (const f of ['app/src/cloud.js', 'app/firestore.rules', 'app/public/vendor/firebase', 'flavours', 'e2e/sync.spec.mjs'])
    assert.ok(!fs.existsSync(path.join(dir, f)), f);
  const html = read(dir, 'app/index.html');
  assert.doesNotMatch(html, /firebase\/|@core\/auth|@core\/sync"|cloud\{|static\{|id="sign-out"/);
  assert.match(html, /"@core\/store": "https:\/\/core\.anawj\.com\/sync\/[^/]+\/src\/store\.js"/);
  assert.match(read(dir, 'app/public/sw.js'), /src\/store\.js/);
  assert.doesNotMatch(read(dir, 'app/public/sw.js'), /cloud\.js|firebase/, 'sw.js lists no file the static app lacks');
  const sw = spawnSync('node', ['tools/sw-files.mjs', 'app', '--check'], { cwd: dir, encoding: 'utf8' });
  assert.equal(sw.status, 0, sw.stderr);
  assert.match(read(dir, 'playwright.config.mjs'), /^(?![\s\S]*emulator)/);
  assert.equal(JSON.parse(read(dir, 'package.json')).scripts.rules, undefined);
  assert.deepEqual(fill({ dir, ...STATIC, check: true }).changed, [], 'a re-run changes nothing');
  assert.deepEqual(fill({ dir, ...STATIC, static: true, check: true }).changed, [], '--static again: already static');
  const web = path.join(dir, 'web.json');
  fs.writeFileSync(web, JSON.stringify({ projectId: 'pet-log-app', apiKey: 'x', appId: 'y' }));
  assert.throws(() => fill({ dir, ...STATIC, 'web-config': web }), /static app has no web config/);
});

test('--static in a fresh clone (no node_modules) installs the packages, so sw.js\'s list is the static app\'s', () => {
  const dir = copy({ deps: false });
  const ran = [];
  const exec = (cmd, args, cwd) => {
    ran.push([cmd, ...args].join(' '));
    assert.equal(cwd, dir);
    fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(dir, 'node_modules'), 'junction');   // stands for the install
  };
  fill({ dir, ...STATIC, static: true, exec });
  assert.deepEqual(ran, ['npm ci --no-audit --no-fund --ignore-scripts']);
  assert.doesNotMatch(read(dir, 'app/public/sw.js'), /cloud\.js|firebase/);
  assert.equal(spawnSync('node', ['tools/sw-files.mjs', 'app', '--check'], { cwd: dir }).status, 0);
});

test('--static checks the values before it renders anything', () => {
  const dir = copy();
  assert.throws(() => fill({ dir, ...STATIC, static: true, name: 'Bad Name' }), /--name/);
  assert.throws(() => fill({ dir, ...STATIC, static: true, accent: 'teal' }), /--accent/);
  assert.throws(() => fill({ dir, ...STATIC, static: true, check: true }), /--check with --static/);
  assert.throws(() => fill({ dir, ...STATIC, static: true, title: '  ' }), /--title/);
  assert.throws(() => fill({ dir, ...STATIC, static: true, 'web-config': 'web.json' }), /no web config/);
  assert.ok(fs.existsSync(path.join(dir, 'app/src/cloud.js')));
  assert.equal(JSON.parse(read(dir, '.starter.json')).flavour, undefined);
});
// }cloud
/* static{
test('fills name, host and kit everywhere; no Firebase config', () => {
  const dir = copy();
  const { changed } = fill({ dir, ...STATIC });
  assert.ok(changed.includes('app/src/config.js') && changed.includes('wrangler.jsonc') && changed.includes('worker/routes.js'));
  const cfg = read(dir, 'app/src/config.js');
  assert.doesNotMatch(cfg, /firebaseConfig/);
  assert.match(cfg, /KIT = 'https:\/\/design\.anawj\.com\/v1\/'/);
  for (const f of ['app/index.html', 'app/public/sw.js', 'worker/routes.js', 'wrangler.jsonc', 'package.json'])
    assert.doesNotMatch(read(dir, f), /starter-app|app\.example\.com|design\.flamingbeing\.com/, f);
  const web = path.join(dir, 'web.json');
  fs.writeFileSync(web, JSON.stringify({ projectId: 'pet-log-app', apiKey: 'x', appId: 'y' }));
  assert.throws(() => fill({ dir, ...STATIC, 'web-config': web }), /static app has no web config/);
});
}static */

test('bad values are refused before anything changes', () => {
  const dir = copy();
  assert.throws(() => fill({ dir, ...ARGS, name: 'Bad Name' }), /--name/);
  assert.throws(() => fill({ dir, ...ARGS, host: 'not a host' }), /--host/);
  assert.throws(() => fill({ dir, ...ARGS, kit: 'other' }), /--kit/);
  assert.throws(() => fill({ dir, ...ARGS, title: '<b>' }), /--title/);
  assert.equal(read(dir, 'app/src/config.js'), read(ROOT, 'app/src/config.js'));
});

test('arguments', () => {
  assert.deepEqual(parseArgs(['--name', 'a', '--check']), { name: 'a', check: true });
  assert.deepEqual(parseArgs(['--static']), { static: true });
  assert.throws(() => parseArgs(['--nope']), /unknown argument/);
});

test('a rename is refused while the current name is a word in the code (it would rename the collection, rules, imports)', () => {
  const dir = copy();
  fill({ dir, ...ARGS, name: 'items', title: 'Items' });
  const before = read(dir, 'app/src/items.js');
  assert.throws(() => fill({ dir, ...ARGS, name: 'pantry', title: 'Items' }), /--name: the current name 'items' is also a word in the code/);
  assert.equal(read(dir, 'app/src/items.js'), before, 'nothing changed');
  assert.deepEqual(fill({ dir, ...ARGS, name: 'items', title: 'Items', check: true }).changed, [], 'same name again: still fine');
});

test("--kit ntf: the NTF kit's origin and its own colour; a chosen colour is kept across a kit change", () => {
  const dir = copy();
  fill({ dir, ...ARGS, kit: 'ntf' });
  const cfg = read(dir, 'app/src/config.js');
  assert.match(cfg, /export const KIT = 'https:\/\/design\.anantf\.com\/v1\/';/);
  assert.match(cfg, /"accent":"#633d3c"/);
  fill({ dir, ...ARGS, kit: 'nuhs' });
  assert.match(read(dir, 'app/src/config.js'), /"accent":"#3a6390"/, "back to the default with the kit's own");
  fill({ dir, ...ARGS, kit: 'nuhs', accent: '#0f766e' });
  fill({ dir, ...ARGS, kit: 'ntf' });
  assert.match(read(dir, 'app/src/config.js'), /"accent":"#0f766e"/, 'a chosen colour stays');
});
