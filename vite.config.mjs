// Vite, as a check only (README, "Switch to Vite in one PR"): nothing ships from it. `npx vite build` builds app/ into
// dist/ with the same layout the Worker serves (index.html, public/ at the root), and CI runs the whole browser suite
// on dist/ too, so the switch stays one small PR. Everything the import map names stays external: the page still
// loads core, Firebase (vendored) and register.js through the map, at the versions it pins.
import { defineConfig } from 'vite';

// Where each local module's source is, for builds that bundle core from source (tools/vite-pieces.mjs); this build
// keeps them external like the rest of core. Generated from modules.json's "alias" fields: node tools/modules.mjs.
export const SOURCE_ALIAS = {
};

export default defineConfig({
  root: 'app',
  base: './',
  logLevel: 'warn',
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    target: 'es2022',
    rollupOptions: { external: id => /^(@core\/|firebase\/|app-update\/|https:\/\/)/.test(id) },
  },
});
