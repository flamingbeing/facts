// The device copy of the files' bytes: IndexedDB database `<name>-files`, store `blobs`, one Blob per key
// `<scope>/<id>` and `<scope>/<id>.thumb` (NOTES "Files formats"), through vendored idb-keyval. Files added here wait
// in it for their upload; files fetched from the Worker are kept for next time. A switch to another account wipes it.
// Without IndexedDB (some private windows) it keeps them in memory for the page.
import { createStore, get, set, del, clear } from '../vendor/idb-keyval/6.3.0/index.js';

/** @typedef {import('./types').BlobCache} BlobCache */

/** @param {string} name  the app's name (config.name) @returns {BlobCache} */
export function deviceCache(name) {
  let hasIdb = false;
  try { hasIdb = typeof indexedDB !== 'undefined' && !!indexedDB; } catch { /* blocked */ }
  if (!hasIdb) return memoryCache();
  /** @type {import('../vendor/idb-keyval/6.3.0/index.js').UseStore | null} */
  let store = null;
  const db = () => (store ??= createStore(`${name}-files`, 'blobs'));
  return {
    get: key => get(key, db()).then(v => v instanceof Blob ? v : null),
    set: (key, blob) => set(key, blob, db()),
    del: key => del(key, db()),
    clear: () => clear(db()),
  };
}

/** @returns {BlobCache} */
export function memoryCache() {
  /** @type {Map<string, Blob>} */
  const m = new Map();
  return {
    get: async key => m.get(key) ?? null,
    set: async (key, blob) => { m.set(key, blob); },
    del: async key => { m.delete(key); },
    clear: async () => { m.clear(); },
  };
}
