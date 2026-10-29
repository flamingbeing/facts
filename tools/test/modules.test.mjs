// tools/modules.mjs: one manifest -> the import map, tsconfig paths, Vite aliases, style links and the rules block.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { applyEdits, coreVersions, formatManifest, generate, manifestFrom, moduleEdits, rulesBlock, run } from '../modules.mjs';

const ROOT = path.resolve(import.meta.dirname, '../..');
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');

test('the starter\'s own manifest writes its files back unchanged; versions come from package.json', () => {
  const manifest = JSON.parse(read('modules.json'));
  const files = { html: read('app/index.html'), tsconfig: read('tsconfig.json'), vite: read('vite.config.mjs') };
  assert.deepEqual(generate(manifest, read('package.json'), files), files);
  assert.equal(formatManifest(manifestFrom(files)), formatManifest({ ...manifest, about: undefined }));
  const pkg = JSON.parse(read('package.json'));
  pkg.devDependencies['app-ui'] = 'github:flamingbeing/app-ui#v9.9.9';
  const g = generate(manifest, JSON.stringify(pkg), files);
  assert.match(g.html, /"@core\/ui": "https:\/\/core\.anawj\.com\/ui\/9\.9\.9\/ui\/index\.js"/);
  assert.match(g.html, /href="https:\/\/core\.anawj\.com\/ui\/9\.9\.9\/ui\/ui\.css"/, 'the style links move with the pin');
  assert.doesNotMatch(g.html, /ui\/1\.0\.0-rc/);
  assert.deepEqual(coreVersions(manifest, JSON.stringify({ devDependencies: { 'app-sync': '^1.2.3' } })), { 'app-sync': '1.2.3' });
});

test('a module named once lands in the map, paths, alias and style links; removing it leaves no trace', () => {
  const manifest = JSON.parse(read('modules.json'));
  const files = { html: read('app/index.html'), tsconfig: read('tsconfig.json'), vite: read('vite.config.mjs') };
  const recipe = { modules: { '@core/x': { url: './x/index.js', types: './app/public/x/index.js', alias: './app/public/x/index.js' } }, styles: ['css/x.css'] };
  const g = generate(applyEdits(manifest, recipe), read('package.json'), files);
  assert.match(g.html, /"@core\/x": "\.\/x\/index\.js"/);
  assert.match(g.html, /<link rel="stylesheet" href="app\.css">\n\s*<link rel="stylesheet" href="css\/x\.css" data-module>/);
  assert.match(g.tsconfig, /"@core\/x": \["\.\/app\/public\/x\/index\.js"\]/);
  assert.match(g.vite, /'@core\/x': '\.\/app\/public\/x\/index\.js',/);
  const back = applyEdits(applyEdits(manifest, recipe), recipe, true);
  assert.deepEqual(generate(back, read('package.json'), g), files);
});

test('old recipes\' importMap / tsconfigPaths / viteAlias read as one modules field', () => {
  const old = { importMap: { '@core/s': './s/index.js', '@core/app': 'https://core.anawj.com/sync/1.0.0/src/app.js' },
    tsconfigPaths: { '@core/s': ['./app/public/s/index.js'], other: ['./o.d.ts'] }, viteAlias: { '@core/s': './app/public/s/index.js' } };
  assert.deepEqual(moduleEdits(old), {
    imports: { '@core/s': { url: './s/index.js', types: './app/public/s/index.js', alias: './app/public/s/index.js' }, '@core/app': { core: 'app-sync', file: 'src/app.js' } },
    paths: { other: ['./o.d.ts'] },
  });
});

test('the rules block: fragments in file order at the mark\'s indent; empty when none; refused with no mark', () => {
  const app = 'rules {\n  a;\n  // modules: rules{ generated\n  // }modules\n  b;\n}\n';
  assert.equal(rulesBlock(app, {}), app);
  const two = rulesBlock(app, { 'z.rules': 'match /z {\n  allow read;\n}\n', 'a.rules': 'match /a {}\n' });
  assert.equal(two, 'rules {\n  a;\n  // modules: rules{ generated\n  match /a {}\n\n  match /z {\n    allow read;\n  }\n  // }modules\n  b;\n}\n');
  assert.equal(rulesBlock(two, {}), app);
  assert.throws(() => rulesBlock('rules {}\n', { 'a.rules': 'x' }), /no "\/\/ modules: rules\{"/);
});

test('run --check fails on a stale place and passes once written', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'modules-'));
  try {
    for (const rel of ['modules.json', 'package.json', 'app/index.html', 'tsconfig.json', 'vite.config.mjs', 'worker/headers.js'])
      fs.cpSync(path.join(ROOT, rel), path.join(dir, rel), { recursive: true });
    const m = JSON.parse(fs.readFileSync(path.join(dir, 'modules.json'), 'utf8'));
    m.imports['@core/x'] = { url: './x/index.js' };
    fs.writeFileSync(path.join(dir, 'modules.json'), formatManifest(m));
    const quiet = { log: () => {}, shell: false };
    await assert.rejects(run({ dir, check: true, ...quiet }), /out of date|modules/);
    await run({ dir, ...quiet });
    await run({ dir, check: true, ...quiet });
    assert.match(fs.readFileSync(path.join(dir, 'app/index.html'), 'utf8'), /"@core\/x": "\.\/x\/index\.js"/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
