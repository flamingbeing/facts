// worker/routes.js: which folder each address serves, and what it must never serve. Run: node --test 'worker/test/*.test.mjs'
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { resolve, publicFile, SITES } from '../routes.js';

const H = Object.keys(SITES)[0];

test('the app is served at the root', () => {
  assert.deepEqual(resolve(H, '/'), { file: 'app/' });
  assert.deepEqual(resolve(H, '/app.js'), { file: 'app/app.js' });
  assert.deepEqual(resolve(H.toUpperCase() + ':443', '/'), { file: 'app/' });
  assert.deepEqual(resolve(H, '/app'), { redirect: '/app/' });
});

test('unknown hosts serve nothing; localhost serves the repo', () => {
  assert.deepEqual(resolve('x.workers.dev', '/app/'), { notFound: true });
  assert.deepEqual(resolve('localhost:8787', '/app/'), { file: 'app/' });
});

test('nothing escapes its folder', () => {
  for (const p of ['/../wrangler.jsonc', '/%2e%2e/x', '/a%2fb', '/a\\b', '/./x'])
    assert.deepEqual(resolve(H, p), { notFound: true }, p);
});

test('every folder in SITES exists', () => {
  for (const s of Object.values(SITES))
    for (const f of [s.root, ...Object.values(s.prefixes || {})].filter(Boolean))
      assert.ok(fs.existsSync(new URL('../../' + f, import.meta.url)), f);
});

test('a file not in its folder is looked for in the folder\'s public/ (the Vite layout, with no build)', () => {
  assert.equal(publicFile('app/sw.js'), 'app/public/sw.js');
  assert.equal(publicFile('app/icons/icon.svg'), 'app/public/icons/icon.svg');
  assert.equal(publicFile('app/public/sw.js'), null, 'already public/');
  assert.equal(publicFile('app/'), null, 'a folder');
  assert.equal(publicFile('index.html'), null, 'no folder');
});
