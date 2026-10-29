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
  await Promise.all(Object.keys(oldIndex?.areas || {}).map(async area => { const f = await kept(area); if (f) have.set(area, f); }));
  const order = (/** @type {string[]} */ areas) => areas.filter(a => have.has(a)).map(a => /** @type {AreaFile} */ (have.get(a)));
  if (have.size) onData(order(Object.keys(oldIndex?.areas || {})), { from: 'cache' });

  /** @type {DataIndex} */
  let index;
  try {
    const r = await fetch(BASE + 'index.json', { cache: 'no-store' });
    if (!r.ok) throw new Error(`index ${r.status}`);
    index = await r.json();
  } catch (e) { if (have.size) return; throw e; }

  // each area: the copy here when its version is the same, else fetched again (the copy here if that fails). The index
  // kept is what is kept, area by area: an area that failed keeps its old version, so it is asked for again next time
  /** @type {DataIndex} */
  const keep = { areas: {} };
  /** @type {Map<string, AreaFile>} */
  const now = new Map();
  let changed = false;
  await Promise.all(Object.entries(index.areas || {}).map(async ([area, meta]) => {
    const old = oldIndex?.areas?.[area];
    if (old?.v === meta.v && have.has(area)) { now.set(area, /** @type {AreaFile} */ (have.get(area))); keep.areas[area] = old; return; }
    try {
      const r = await fetch(`${BASE}${area}.json?v=${encodeURIComponent(meta.v)}`);
      if (!r.ok) throw new Error(`${area} ${r.status}`);
      now.set(area, /** @type {AreaFile} */ (await r.clone().json()));
      await cache?.put(BASE + area + '.json', r).catch(() => {});
      keep.areas[area] = meta;
      changed = true;
    } catch {
      const f = have.get(area);   // offline part-way: the old copy of this area
      if (f && old) { now.set(area, f); keep.areas[area] = old; }
    }
  }));
  for (const area of have.keys()) if (!index.areas?.[area]) { changed = true; await cache?.delete(BASE + area + '.json').catch(() => {}); }
  if (!now.size && !have.size) throw new Error('no areas');
  if (!changed) return;
  // (the areas fetch side by side, so `keep` filled in as they finished: stored in the index's own order, or the next start
  // from the cache would show them in whichever order the network answered)
  const ordered = { areas: Object.fromEntries(Object.keys(index.areas || {}).filter(a => keep.areas[a]).map(a => [a, keep.areas[a]])) };
  await cache?.put(BASE + 'index.json', new Response(JSON.stringify(ordered), { headers: { 'content-type': 'application/json' } })).catch(() => {});
  onData(Object.keys(index.areas || {}).filter(a => now.has(a)).map(a => /** @type {AreaFile} */ (now.get(a))), { from: 'network' });
}
