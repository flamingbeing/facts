// Vite check for the pieces (shaking): a page that imports settings carries the module, a page that imports only readFile
// carries the file code but not the module, a page that imports only parseQuery from @core/search carries no MiniSearch,
// and a page that imports none of it carries nothing. Builds small pages into a temp folder; nothing is kept.
//   node tools/vite-pieces.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import { SOURCE_ALIAS } from '../vite.config.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = fs.mkdtempSync(path.join(os.tmpdir(), 'pieces-src-'));
const OUT = fs.mkdtempSync(path.join(os.tmpdir(), 'pieces-out-'));
const MODULE = 'sign in first (account options belong to an account)';   // module.js only
const FILE = 'not JSON';                                                // file.js only
const SEARCH = '@core/search' in SOURCE_ALIAS;   // the search recipe is in (recipes/search.json)
const PAGES = {
  full: "import { settings } from '@core/settings'; console.log(settings({ options: {} }));",
  file: "import { readFile } from '@core/settings'; console.log(readFile);",
  none: "console.log('no settings here');",
  ...SEARCH && {
    query: "import { parseQuery } from '@core/search'; console.log(parseQuery('a'));",
    index: "import { createSearch } from '@core/search'; console.log(createSearch({ fields: ['a'] }));",
  },
};
const alias = { '@core/settings': path.join(ROOT, 'node_modules/app-ui/settings/index.js'), ...Object.fromEntries(Object.entries(SOURCE_ALIAS).map(([k, v]) => [k, path.join(ROOT, v)])) };
for (const [name, code] of Object.entries(PAGES)) {
  fs.writeFileSync(path.join(SRC, `${name}.js`), code);
  fs.writeFileSync(path.join(SRC, `${name}.html`), `<!doctype html><script type="module" src="./${name}.js"></script>`);
}

await build({
  configFile: false, root: SRC, base: './', logLevel: 'warn',
  resolve: { alias },
  build: { outDir: OUT, emptyOutDir: true, target: 'es2022', rollupOptions: { output: { experimentalMinChunkSize: 0 }, input: Object.fromEntries(Object.keys(PAGES).map(n => [n, path.join(SRC, `${n}.html`)])) } },
});

// every script a built page loads: its module scripts and, from each, the chunks it imports
function carried(page) {
  const seen = new Set();
  const visit = file => {
    if (seen.has(file)) return;
    seen.add(file);
    for (const m of fs.readFileSync(file, 'utf8').matchAll(/(?:from|import)\s*["'](\.[^"']+\.js)["']/g)) visit(path.resolve(path.dirname(file), m[1]));
  };
  for (const m of fs.readFileSync(path.join(OUT, `${page}.html`), 'utf8').matchAll(/<script[^>]+type="module"[^>]+src="([^"]+)"/g)) visit(path.join(OUT, m[1]));
  return [...seen].map(f => fs.readFileSync(f, 'utf8')).join('\n');
}
const full = carried('full'), file = carried('file'), none = carried('none');
const problems = [];
if (!full.includes(MODULE) || !full.includes(FILE)) problems.push('the page that uses settings does not carry it');
if (file.includes(MODULE)) problems.push('a page that imports only readFile carries module.js');
if (!file.includes(FILE)) problems.push('a page that imports readFile does not carry it');
if (none.includes(MODULE) || none.includes(FILE)) problems.push('a page that uses none of it carries it');
if (SEARCH) {
  const query = carried('query'), index = carried('index');
  if (!index.includes('removeAll') || !index.includes('discard')) problems.push('the page that uses createSearch does not carry MiniSearch');
  if (query.includes('removeAll') || query.includes('discard')) problems.push('a page that imports only parseQuery carries MiniSearch');
  if (none.includes('removeAll') || none.includes('discard') || none.includes('editDistance')) problems.push('a page that uses none of search carries it');
}
fs.rmSync(SRC, { recursive: true, force: true }); fs.rmSync(OUT, { recursive: true, force: true });
if (problems.length) { console.error(`vite-pieces: ${problems.join('; ')}`); process.exit(1); }
console.log(`vite-pieces: @core/settings${SEARCH ? ' and @core/search' : ''} shake: a page carries only what it imports`);
