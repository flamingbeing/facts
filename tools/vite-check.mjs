// The Vite check (README, "Switch to Vite in one PR"; CI job "vite"): builds app/ with vite.config.mjs into dist/,
// checks the built page still loads core, Firebase and register.js through its import map (none of it bundled), then
// writes dist/'s service worker list and stamp, as a deploy would. CI then runs the browser suite on dist/
// (APP_DIR=dist npx playwright test). dist/ is never committed or deployed.
//   node tools/vite-check.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import { writeShell, importMap } from './sw-files.mjs';
import { stamp } from './stamp-versions.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');
await build({ configFile: path.join(ROOT, 'vite.config.mjs') });

const html = fs.readFileSync(path.join(DIST, 'index.html'), 'utf8');
const assets = path.join(DIST, 'assets');
const js = fs.readdirSync(assets).filter(f => f.endsWith('.js')).map(f => fs.readFileSync(path.join(assets, f), 'utf8')).join('\n');
const problems = [];
const before = importMap(fs.readFileSync(path.join(ROOT, 'app/index.html'), 'utf8'));
if (JSON.stringify(importMap(html)) !== JSON.stringify(before)) problems.push('the built page lost or changed its import map');
for (const name of Object.keys(before)) if (!js.includes(`"${name}"`)) problems.push(`${name} is not imported by name (bundled, or no longer used)`);
if (js.includes('createApp needs config.sdk') || js.includes('sync needs')) problems.push('engine code was bundled (core must stay external)');
// @core/files (decision 0009) stays external too: only a page that imports it loads it, exifr only on first use
if (js.includes('files: remove() takes') || js.includes('DateTimeOriginal') || js.includes('idb-keyval')) problems.push('files code was bundled (@core/files must stay external)');
if (/SDK_VERSION|@firebase\//.test(js)) problems.push('Firebase was bundled (it must load from the vendored files)');
if (fs.existsSync(path.join(DIST, 'src'))) problems.push('dist/ has src/ (the build should bundle it)');
if (problems.length) { console.error(`vite-check: ${problems.join('; ')}`); process.exit(1); }
const list = writeShell({ dir: DIST });
const { version } = stamp({ dir: DIST });
console.log(`vite-check: ok, ${(js.length / 1024).toFixed(1)} KiB of app JS, ${list.length} SHELL files, ${version}`);
