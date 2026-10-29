// Align's data: the shared notes' area bundles at /data/ (worker/data.js; cards.js says their shape). The last copy is
// kept in Cache Storage, so the cards show at once and offline; then index.json is asked for fresh, and only the areas
// whose version (v) changed are fetched again.
const CACHE = 'align-data-v1';
const BASE = '/data/';

/** @typedef {{ areas: Record<string, { v: string, topics: number }> }} DataIndex */
/** @typedef {import('./cards.js').AreaFile} AreaFile */

/**
 * @param {(files: AreaFile[], o: { from: 'cache' | 'network' }) => void} onData  the areas (in index order), from this
 *   device's copy first if it has one, then again from the network when anything changed
 * @returns {Promise<void>}  rejects only when there is no copy here and the network fails
 */
export async function loadData(onData) {
  /** @type {Cache | null} */
  let cache = null;
  try { cache = await caches.open(CACHE); } catch { /* no Cache Storage (private mode): network only */ }
  /** @param {string} name @returns {Promise<any>} */
  const kept = async name => { try { const r = await cache?.match(BASE + name + '.json'); return r ? await r.json() : null; } catch { return null; } };

  /** @type {DataIndex | null} */
  const oldIndex = await kept('index');
  /** @type {Map<string, AreaFile>} */
  const have = new Map();
  for (const area of Object.keys(oldIndex?.areas || {})) { const f = await kept(area); if (f) have.set(area, f); }
  if (have.size) onData([...have.values()], { from: 'cache' });

  /** @type {DataIndex} */
  let index;
  try {
    const r = await fetch(BASE + 'index.json', { cache: 'no-store' });
    if (!r.ok) throw new Error(`index ${r.status}`);
    index = await r.json();
  } catch (e) { if (have.size) return; throw e; }

  let changed = false;
  /** @type {AreaFile[]} */
  const files = [];
  for (const [area, meta] of Object.entries(index.areas || {})) {
    let file = oldIndex?.areas?.[area]?.v === meta.v ? have.get(area) : undefined;
    if (!file) {
      try {
        const r = await fetch(`${BASE}${area}.json?v=${encodeURIComponent(meta.v)}`);
        if (!r.ok) throw new Error(`${area} ${r.status}`);
        file = /** @type {AreaFile} */ (await r.clone().json());
        await cache?.put(BASE + area + '.json', r).catch(() => {});
        changed = true;
      } catch {
        file = have.get(area);   // offline part-way: the old copy of this area, and the index stays the old one
        if (!file) continue;
        index = /** @type {DataIndex} */ (oldIndex ?? index);
      }
    }
    files.push(file);
  }
  if (have.size !== files.length) changed = true;
  if (!changed) return;
  if (index !== oldIndex) await cache?.put(BASE + 'index.json', new Response(JSON.stringify(index), { headers: { 'content-type': 'application/json' } })).catch(() => {});
  for (const area of have.keys()) if (!index.areas?.[area]) await cache?.delete(BASE + area + '.json').catch(() => {});
  onData(files, { from: 'network' });
}
