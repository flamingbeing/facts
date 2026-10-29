// Vendored Firebase: gstatic's browser files for one SDK version, served from the app's own address
// (app/public/vendor/firebase/<ver>/), so the service worker installs them with the rest of the app and the page needs
// no second site to start. The bytes are gstatic's; only the one import of firebase-app.js becomes relative
// (./firebase-app.js). tools/firebase.lock.json holds the version and the sha256 of each gstatic file.
//   node tools/vendor-firebase.mjs <ver>    download <ver>, replace the old version, point the import map at it
//   node tools/vendor-firebase.mjs --check  no network: the files are gstatic's (lock), at the import map's version (CI)
// A bump points modules.json's firebase/* entries at the new folder and runs node tools/modules.mjs (the import map,
// sw.js's list and the import map's hash follow).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { MANIFEST, run } from './modules.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const APP = path.join(ROOT, 'app'), LOCK = path.join(ROOT, 'tools/firebase.lock.json');
export const FILES = ['firebase-app.js', 'firebase-auth.js', 'firebase-firestore.js'];
const GSTATIC = v => `https://www.gstatic.com/firebasejs/${v}/`;
const sha = s => crypto.createHash('sha256').update(s).digest('hex');
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export const rewrite = (src, v) => src.replace(new RegExp(`(from\\s*["'])${esc(GSTATIC(v))}firebase-app\\.js(["'])`, 'g'), '$1./firebase-app.js$2');
export const restore = (src, v) => src.replace(/(from\s*["'])\.\/firebase-app\.js(["'])/g, `$1${GSTATIC(v)}firebase-app.js$2`);

// dir: the app folder; lock: { version, files: { name: sha256 of gstatic's file } }. Throws on the first problem.
export function check({ dir, lock }) {
  const v = lock.version, vendor = path.join(dir, 'public/vendor/firebase');
  const html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
  for (const f of FILES) {
    const want = `./vendor/firebase/${v}/${f}`;
    if (!html.includes(`"${want}"`)) throw new Error(`the import map does not load ${want} (the lock is at ${v})`);
  }
  const dirs = fs.existsSync(vendor) ? fs.readdirSync(vendor) : [];
  if (dirs.join() !== v) throw new Error(`app/public/vendor/firebase/ should hold only ${v}, it holds: ${dirs.join(', ') || 'nothing'}`);
  for (const f of FILES) {
    const file = path.join(vendor, v, f);
    if (!fs.existsSync(file)) throw new Error(`${f} is missing`);
    if (sha(restore(fs.readFileSync(file, 'utf8'), v)) !== lock.files[f]) throw new Error(`${f} is not gstatic's ${v} (run node tools/vendor-firebase.mjs ${v})`);
  }
}

async function vendor(v) {
  const vendorDir = path.join(APP, 'public/vendor/firebase'), files = {};
  const got = {};
  for (const f of FILES) {
    const r = await fetch(GSTATIC(v) + f);
    if (!r.ok) throw new Error(`${GSTATIC(v)}${f}: ${r.status}`);
    got[f] = await r.text();
    files[f] = sha(got[f]);
  }
  fs.rmSync(vendorDir, { recursive: true, force: true });
  fs.mkdirSync(path.join(vendorDir, v), { recursive: true });
  for (const f of FILES) fs.writeFileSync(path.join(vendorDir, v, f), rewrite(got[f], v));
  fs.writeFileSync(LOCK, JSON.stringify({ version: v, source: GSTATIC(v), files }, null, 2) + '\n');
  const manifest = path.join(ROOT, MANIFEST);
  fs.writeFileSync(manifest, fs.readFileSync(manifest, 'utf8').replace(/"\.\/vendor\/firebase\/[^/"]+\/(firebase-\w+\.js)"/g, `"./vendor/firebase/${v}/$1"`));
  await run({ dir: ROOT });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const a = process.argv.slice(2);
  try {
    if (a.includes('--check')) {
      const lock = JSON.parse(fs.readFileSync(LOCK, 'utf8'));
      check({ dir: APP, lock });
      console.log(`vendor-firebase: ok (${lock.version}, ${FILES.length} files are gstatic's)`);
    } else if (/^\d+\.\d+\.\d+$/.test(a[0] || '')) {
      await vendor(a[0]);
      console.log(`vendor-firebase: ${a[0]} in app/public/vendor/firebase/, modules.json and everything generated from it`);
    } else throw new Error('usage: node tools/vendor-firebase.mjs <x.y.z> | --check');
  } catch (e) { console.error('vendor-firebase: ' + e.message); process.exit(1); }
}
