// Vite check for the outside-package fixture (README, "Adding an outside package"): the bare name `zod` resolves to the
// vendored file, and only the page that imports it carries its code. Builds into a temp folder; nothing is kept.
//   node tools/vite-outside-package.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURE = path.join(ROOT, 'e2e/fixtures/outside-package');
const OUT = fs.mkdtempSync(path.join(os.tmpdir(), 'outside-package-'));
const MARKER = 'ZodError';

await build({
  configFile: false,
  root: FIXTURE,
  base: './',
  logLevel: 'warn',
  resolve: { alias: { zod: path.join(FIXTURE, 'vendor/zod/3.23.8/index.mjs') } },
  build: {
    outDir: OUT,
    emptyOutDir: true,
    target: 'es2022',
    rollupOptions: { input: { index: path.join(FIXTURE, 'index.html'), plain: path.join(FIXTURE, 'plain.html') } },
  },
});

// every script a built page loads: its module scripts and, from each, the chunks it imports
function scriptsOf(page) {
  const seen = new Set();
  const visit = file => {
    if (seen.has(file)) return;
    seen.add(file);
    for (const m of fs.readFileSync(file, 'utf8').matchAll(/(?:from|import)\s*["'](\.[^"']+\.js)["']/g)) visit(path.resolve(path.dirname(file), m[1]));
  };
  for (const m of fs.readFileSync(path.join(OUT, page), 'utf8').matchAll(/<script[^>]+type="module"[^>]+src="([^"]+)"/g)) visit(path.join(OUT, m[1]));
  return [...seen];
}
const carries = page => scriptsOf(page).some(f => fs.readFileSync(f, 'utf8').includes(MARKER));

const problems = [];
if (!carries('index.html')) problems.push('the page that imports zod does not carry it (not resolved to the vendored file?)');
if (carries('plain.html')) problems.push('the page that does not import zod carries it');
fs.rmSync(OUT, { recursive: true, force: true });
if (problems.length) { console.error(`vite-outside-package: ${problems.join('; ')}`); process.exit(1); }
console.log('vite-outside-package: zod resolves to the vendored file and stays out of the page that does not import it');
