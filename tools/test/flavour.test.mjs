// tools/flavour.mjs: the marks, the render (pure) and the render in place. node --test tools/test/flavour.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { strip, render, renderDir } from '../flavour.mjs';
import { fill } from '../fill.mjs';
import { update } from '../update-from-starter.mjs';
import { toCloud, add } from '../add.mjs';

test('strip: cloud regions go, marks included; static blocks come in without their marks', () => {
  const js = ['a', '// cloud{ why', 'b', '// }cloud', '/* static{', 'c', '}static */', 'd'].join('\n');
  assert.equal(strip(js), 'a\nc\nd');
  const html = ['<p>', '  <!-- cloud{ -->', '  <i>', '  <!-- }cloud -->', '  <!-- static{', '  <b>', '  }static -->', '</p>'].join('\n');
  assert.equal(strip(html), '<p>\n  <b>\n</p>');
  assert.equal(strip(['x:', '  # cloud{', '  y: 1', '  # }cloud', 'z: 2'].join('\n')), 'x:\nz: 2');
  assert.equal(strip('no marks here'), 'no marks here');
});

test('strip: a mark without its pair, or one inside another, throws with the line', () => {
  assert.throws(() => strip('// cloud{\nx', 'a.js'), /a\.js:1: cloud\{ without \}cloud/);
  assert.throws(() => strip('x\n// }cloud', 'a.js'), /a\.js:2: \}cloud without cloud\{/);
  assert.throws(() => strip('// cloud{\n/* static{\n}static */\n// }cloud', 'a.js'), /a\.js:2: static\{ inside cloud\{/);
});

const SPEC = {
  flavour: 'static', remove: ['gone.js', 'dir'], root: 'flavours/static',
  importMap: { '@core/sync': null, '@core/store': 'https://x/store.js' },
  tsconfigPaths: { '@core/store': ['./store.d.ts'] },
  json: { 'package.json': ['scripts.rules'] },
};
const PAGE = '<script type="importmap">\n{\n  "imports": {\n    "@core/app": "https://x/app.js",\n    "@core/sync": "https://x/sync.js"\n  }\n}\n</script>\n';
const TREE = () => ({
  'flavours/static.json': Buffer.from(JSON.stringify(SPEC)),
  'flavours/static/app/own.js': Buffer.from('own\n'),
  'flavours/static/kept.js': Buffer.from('replaced\n'),
  'gone.js': Buffer.from('x'), 'dir/a.js': Buffer.from('x'),
  'kept.js': Buffer.from('template\n'),
  'marked.js': Buffer.from('a\n// cloud{\nb\n// }cloud\n'),
  'icon.png': Buffer.from([0, 1, 2]),
  'app/index.html': Buffer.from(PAGE),
  'tsconfig.json': Buffer.from('{\n  "compilerOptions": {\n    "paths": {\n      "@core/*": ["./t/*"]\n    }\n  }\n}\n'),
  'package.json': Buffer.from(JSON.stringify({ scripts: { test: 't', rules: 'r' } }, null, 2) + '\n'),
});

test('render: removes, strips, overlays the root, edits the import map, tsconfig and JSON; the input is not changed', () => {
  const files = TREE();
  const out = render(files, 'static');
  assert.deepEqual(Object.keys(out).sort(), ['app/index.html', 'app/own.js', 'icon.png', 'kept.js', 'marked.js', 'package.json', 'tsconfig.json']);
  assert.equal(out['kept.js'].toString(), 'replaced\n');
  assert.equal(out['marked.js'].toString(), 'a\n');
  assert.ok(out['icon.png'].equals(files['icon.png']));
  const html = out['app/index.html'].toString();
  assert.doesNotMatch(html, /@core\/sync/);
  assert.match(html, /"@core\/store": "https:\/\/x\/store\.js"/);
  assert.match(out['tsconfig.json'].toString(), /"@core\/store": \["\.\/store\.d\.ts"\]/);
  assert.deepEqual(JSON.parse(out['package.json'].toString()).scripts, { test: 't' });
  assert.equal(files['marked.js'].toString(), 'a\n// cloud{\nb\n// }cloud\n', 'input unchanged');
  assert.throws(() => render({ 'a.js': Buffer.from('') }, 'static'), /no flavours\/static\.json/);
});

test('renderDir: in place, records the flavour, prunes emptied folders; refuses a second render and the files module', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'flavour-'));
  try {
    for (const [rel, buf] of Object.entries(TREE())) { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), buf); }
    fs.writeFileSync(path.join(dir, '.starter.json'), JSON.stringify({ app: { name: 'a' } }));
    assert.deepEqual(renderDir({ dir, flavour: 'static', dryRun: true }).removed.sort(), ['dir/a.js', 'flavours/static.json', 'flavours/static/app/own.js', 'flavours/static/kept.js', 'gone.js']);
    assert.ok(fs.existsSync(path.join(dir, 'gone.js')), 'a dry run changes nothing');
    renderDir({ dir, flavour: 'static' });
    for (const gone of ['gone.js', 'dir', 'flavours']) assert.ok(!fs.existsSync(path.join(dir, gone)), gone);
    assert.equal(fs.readFileSync(path.join(dir, 'app/own.js'), 'utf8'), 'own\n');
    assert.equal(JSON.parse(fs.readFileSync(path.join(dir, '.starter.json'), 'utf8')).flavour, 'static');
    assert.throws(() => renderDir({ dir, flavour: 'static' }), /already static/);
    assert.throws(() => renderDir({ dir, flavour: 'other' }), /no flavour other/);
    fs.writeFileSync(path.join(dir, '.starter.json'), JSON.stringify({ modules: { files: 'recipes/files.json' } }));
    assert.throws(() => renderDir({ dir, flavour: 'static' }), /files module needs the cloud/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// cloud{ the template's own spec (a static app has no flavours/; a filled app skips these: its files are its own)
const TEMPLATE_ONLY = { skip: JSON.parse(fs.readFileSync(path.resolve(import.meta.dirname, '../../.starter.json'), 'utf8')).commit ? 'the template\'s own' : false };
test("the template's static spec: every path it removes or edits is in the template, and the render keeps no mark", TEMPLATE_ONLY, () => {
  const root = path.resolve(import.meta.dirname, '../..');
  const spec = JSON.parse(fs.readFileSync(path.join(root, 'flavours/static.json'), 'utf8'));
  for (const p of spec.remove) assert.ok(fs.existsSync(path.join(root, p)), `remove: ${p}`);
  const tracked = Object.fromEntries(['app', 'e2e', 'worker', 'tools', '.github', 'flavours', 'recipes'].flatMap(d => walk(root, d))
    .concat(['tsconfig.json', 'package.json', 'playwright.config.mjs'].map(f => [f, fs.readFileSync(path.join(root, f))])));
  const out = render(tracked, 'static');
  for (const [rel, buf] of Object.entries(out)) if (/\.(m?js|html|ya?ml|css)$/.test(rel))
    assert.doesNotMatch(buf.toString(), /^\s*(\/\/|#|<!--|\/\*)\s*(cloud\{|\}cloud|static\{)|^\s*\}static\s*(\*\/|-->)/m, rel);
  assert.ok(!Object.keys(out).some(rel => /firebase/i.test(rel)), 'no Firebase file left');
});
function walk(root, rel) {
  const out = [];
  for (const e of fs.readdirSync(path.join(root, rel), { withFileTypes: true })) {
    const r = `${rel}/${e.name}`;
    if (e.isDirectory()) { if (!['node_modules', 'fixtures'].includes(e.name)) out.push(...walk(root, r)); }
    else out.push([r, fs.readFileSync(path.join(root, r))]);
  }
  return out;
}
// a scratch template repo with the template's own files, and a static app made from it
const git = (cwd, ...args) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const commitAll = (dir, msg) => { git(dir, 'add', '-A'); git(dir, '-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '-qm', msg); return git(dir, 'rev-parse', 'HEAD').trim(); };
function copyTemplate(to) {
  const root = path.resolve(import.meta.dirname, '../..');
  for (const rel of git(root, 'ls-files', '-co', '--exclude-standard').split('\n').filter(Boolean)) {
    if (!fs.existsSync(path.join(root, rel))) continue;
    fs.mkdirSync(path.dirname(path.join(to, rel)), { recursive: true });
    fs.copyFileSync(path.join(root, rel), path.join(to, rel));
  }
}
test('a static app takes the template\'s changes to its render only; add.mjs cloud makes it the cloud app', TEMPLATE_ONLY, () => {
  const tpl = fs.mkdtempSync(path.join(os.tmpdir(), 'tpl-'));
  const app = fs.mkdtempSync(path.join(os.tmpdir(), 'static-'));
  copyTemplate(tpl);
  git(tpl, 'init', '-q', '-b', 'main');
  const base = commitAll(tpl, 'base');
  copyTemplate(app);
  fill({ dir: app, static: true, name: 'trial-notes', host: 'notes.example.org', kit: 'homedesign', commit: base.slice(0, 7) });
  const read = rel => fs.readFileSync(path.join(app, rel), 'utf8');
  const edit = (dir, rel, fn) => fs.writeFileSync(path.join(dir, rel), fn(fs.readFileSync(path.join(dir, rel), 'utf8')));
  // the app's own changes: one to a file both apps have, one to a static app's own file
  edit(app, 'app/src/screens/list.js', t => `${t}// the app's own line\n`);
  edit(app, 'app/src/local.js', t => `${t}// the app's own local line\n`);
  assert.throws(() => add({ source: path.join(tpl, 'recipes/files.json'), dir: app, log: () => {} }), /needs the cloud/);

  // the template changes a cloud region, a cloud-only file and a static file
  edit(tpl, 'app/index.html', t => t.replace(/\n(\s*<!-- \}cloud -->)/, '\n    <!-- a cloud-only change -->\n$1'));
  edit(tpl, 'worker/members.js', t => `${t}// a cloud-only change\n`);
  edit(tpl, 'flavours/static/app/src/options.js', t => `${t}// a static change\n`);
  const next = commitAll(tpl, 'next');
  const sheet = read('app/index.html');
  const r = update({ dir: app, from: tpl, install: false, checkLatest: false, log: () => {} });
  assert.deepEqual(r.changes.map(c => `${c.action} ${c.path}`), ['updated app/src/options.js']);
  assert.match(read('app/src/options.js'), /a static change/);
  assert.equal(read('app/index.html'), sheet, 'the cloud region stays out');
  assert.ok(!fs.existsSync(path.join(app, 'worker/members.js')));
  assert.equal(JSON.parse(read('.starter.json')).commit, next.slice(0, 7));

  assert.throws(() => toCloud({ dir: app, from: tpl, project: 'X', install: false, log: () => {} }), /--project/);
  const c = toCloud({ dir: app, from: tpl, project: 'trial-notes-app', install: false, log: () => {} });
  const meta = JSON.parse(read('.starter.json'));
  assert.equal(meta.flavour, undefined);
  assert.equal(meta.app.project, 'trial-notes-app');
  assert.deepEqual(c.conflicts, []);
  for (const f of ['app/src/cloud.js', 'worker/members.js', 'app/firestore.rules', 'e2e/sync.spec.mjs', 'app/public/vendor/firebase', 'recipes/files/worker/files.js', 'flavours/static.json'])
    assert.ok(fs.existsSync(path.join(app, f)), f);
  assert.match(read('worker/members.js'), /a cloud-only change/);
  assert.match(read('app/index.html'), /cloud\{[\s\S]*a cloud-only change/);
  assert.ok(!fs.existsSync(path.join(app, 'app/src/local-store.js')), 'a static file the app never changed goes');
  assert.ok(c.changes.some(x => x.action === 'kept' && x.path === 'app/src/local.js'), 'one it changed stays, listed');
  assert.match(read('app/src/screens/list.js'), /the app's own line/);
  assert.match(read('app/src/config.js'), /"projectId": "trial-notes-app"/);
  assert.match(read('wrangler.jsonc'), /"FIREBASE_PROJECT": "trial-notes-app"/);
  assert.match(read('app/index.html'), /"@core\/sync"/);
  assert.doesNotMatch(read('app/index.html'), /"@core\/store"/);
  assert.throws(() => toCloud({ dir: app, from: tpl, project: 'trial-notes-app', install: false, log: () => {} }), /cloud app already/);
  for (const d of [tpl, app]) fs.rmSync(d, { recursive: true, force: true });
});
// }cloud
