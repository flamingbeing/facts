// tools/vendor-firebase.mjs: the rewrite, and the check that the vendored files are gstatic's, byte for byte.
// node --test tools/test/vendor-firebase.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { rewrite, restore, check, FILES } from '../vendor-firebase.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const sha = s => crypto.createHash('sha256').update(s).digest('hex');
const G = 'https://www.gstatic.com/firebasejs/1.2.3/';
const ORIG = {
  'firebase-app.js': `const name="${G}firebase-app.js";export const initializeApp=1;`,
  'firebase-auth.js': `import{getApp as i}from"${G}firebase-app.js";export const getAuth=1;`,
  'firebase-firestore.js': `import{getApp as i}from"${G}firebase-app.js";export const getFirestore=1;`,
};
const map = v => `<script type="importmap">\n${JSON.stringify({ imports: Object.fromEntries(FILES.map(f => [`firebase/${f.slice(9, -3)}`, `./vendor/firebase/${v}/${f}`])) })}\n</script>`;
function app(v = '1.2.3', edit = s => s) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vendor-'));
  fs.mkdirSync(path.join(dir, 'public/vendor/firebase', v), { recursive: true });
  for (const f of FILES) fs.writeFileSync(path.join(dir, 'public/vendor/firebase', v, f), edit(rewrite(ORIG[f], '1.2.3')));
  fs.writeFileSync(path.join(dir, 'index.html'), map(v));
  const lock = { version: '1.2.3', files: Object.fromEntries(FILES.map(f => [f, sha(ORIG[f])])) };
  return { dir, lock };
}

test('only the import of firebase-app.js changes; restore gives gstatic\'s bytes back', () => {
  const out = rewrite(ORIG['firebase-auth.js'], '1.2.3');
  assert.equal(out, 'import{getApp as i}from"./firebase-app.js";export const getAuth=1;');
  assert.equal(rewrite(ORIG['firebase-app.js'], '1.2.3'), ORIG['firebase-app.js']);   // a name string, not an import
  for (const f of FILES) assert.equal(restore(rewrite(ORIG[f], '1.2.3'), '1.2.3'), ORIG[f]);
});

test('check passes on gstatic\'s files and fails on a changed byte, another version or a stale import map', () => {
  const ok = app();
  assert.doesNotThrow(() => check(ok));
  const edited = app('1.2.3', s => s.replace('=1;', '=2;'));
  assert.throws(() => check(edited), /firebase-.*\.js is not gstatic's 1\.2\.3/);
  const other = app('1.2.4');
  assert.throws(() => check(other), /1\.2\.4|1\.2\.3/);
  const stale = app();
  fs.mkdirSync(path.join(stale.dir, 'public/vendor/firebase/1.2.2'));
  assert.throws(() => check(stale), /1\.2\.2/);
});

test("the starter's vendored Firebase is gstatic's, at the import map's version", () => {
  assert.doesNotThrow(() => check({ dir: path.join(ROOT, 'app'), lock: JSON.parse(fs.readFileSync(path.join(ROOT, 'tools/firebase.lock.json'), 'utf8')) }));
});
