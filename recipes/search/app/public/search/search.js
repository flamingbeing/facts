// createSearch: an in-memory index over MiniSearch (vendored) for the records an app already holds. Nothing runs on
// import; the index lives only as long as the object, so build it at start and keep it current from sync's watch.
// MiniSearch (~78 KB) loads on first need, not with the page: prepare() (call it when the search box gets focus) or
// the first search. Until it is in, words match as plain text (no ranking, no typo tolerance) and onReady runs once it
// is, so the page can search again. loadSearch() loads it ahead (tests, or an app that searches at start).
import { parseQuery } from './query.js';

/** @type {any} */
let MiniSearch = null;
/** @type {Promise<void> | null} */
let loading = null;
export const loadSearch = () => loading ??= import('../vendor/minisearch/7.2.0/index.js').then(m => { MiniSearch = m.default; });

/** One field's text for one record: strings as is, arrays joined, anything else empty.
 * @param {Record<string, unknown>} rec @param {string} field */
const textOf = (rec, field) => {
  const v = rec[field];
  return Array.isArray(v) ? v.join(' ') : typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '';
};

/** @param {import('./types.d.ts').Options} options @returns {import('./types.d.ts').Search} */
export function createSearch({ fields, boost = {}, store = [], operators = {}, newest = rec => Number(rec.updatedAt ?? 0) || 0, onReady }) {
  /** @type {any} the MiniSearch index, built from the records once MiniSearch is in */
  let index = null;
  /** @type {Map<string, Record<string, unknown>>} */
  const records = new Map();
  const names = [...fields, ...Object.keys(operators)];
  const build = () => {
    if (index || !MiniSearch) return index;
    index = new MiniSearch({
      fields: [...fields],
      storeFields: [...store],
      idField: 'id',
      extractField: (/** @type {Record<string, unknown>} */ doc, /** @type {string} */ f) => textOf(doc, f),
      searchOptions: { boost, prefix: true, fuzzy: 0.2 },
    });
    index.addAll([...records].map(([id, rec]) => ({ ...rec, id })));
    return index;
  };
  let waiting = false;
  const prepare = () => loadSearch().then(() => { const was = !!index; build(); if (waiting && !was) { waiting = false; onReady?.(); } });

  /** @param {Record<string, unknown>} rec */
  const put = rec => {
    const id = String(rec.id);
    if (index) { if (index.has(id)) index.replace({ ...rec, id }); else index.add({ ...rec, id }); }
    records.set(id, rec);
  };
  /** @param {string} id */
  const drop = id => { if (index?.has(id)) index.discard(id); records.delete(id); };

  /** ids that match one term, with a score for a plain word
   * @param {import('./query.js').Term} t @returns {Map<string, { score: number, fields: string[] }>} */
  const matchTerm = t => {
    /** @type {Map<string, { score: number, fields: string[] }>} */
    const out = new Map();
    const op = t.field ? operators[t.field] : undefined;
    if (op) {
      for (const [id, rec] of records) if (op(rec, t.text)) out.set(id, { score: 0, fields: [String(t.field)] });
    } else if (t.phrase) {
      const inFields = t.field ? [t.field] : fields;
      for (const [id, rec] of records) {
        const hit = inFields.filter(f => textOf(rec, f).toLowerCase().includes(t.text));
        if (hit.length) out.set(id, { score: 0, fields: hit });
      }
    } else if (!build()) {
      // MiniSearch not in yet: each word as plain text, and search again once it is (onReady)
      waiting = true; void prepare();
      const inFields = t.field ? [t.field] : fields, words = t.text.toLowerCase().split(/\s+/).filter(Boolean);
      for (const [id, rec] of records) {
        const hit = inFields.filter(f => { const x = textOf(rec, f).toLowerCase(); return words.every(w => x.includes(w)); });
        if (hit.length) out.set(id, { score: 0, fields: hit });
      }
    } else {
      const opts = t.field ? { fields: [t.field] } : {};
      for (const r of index.search(t.text, { ...opts, combineWith: 'AND' })) {
        out.set(String(r.id), { score: r.score, fields: [...new Set(Object.values(r.match).flat())] });
      }
    }
    return out;
  };

  return {
    feed(list) { for (const rec of list) put(rec); },
    update(rec) { put(rec); },
    remove(id) { drop(String(id)); },
    clear() { index?.removeAll(); records.clear(); },
    get size() { return records.size; },
    prepare,
    search(q, { limit = 50 } = {}) {
      const { groups, unknown } = parseQuery(q, { fields: names });
      if (!groups.length) return { hits: [], unknown };
      /** @type {Map<string, { score: number, fields: Set<string> }> | null} */
      let acc = null;
      let scored = false;
      for (const group of groups) {
        /** @type {Map<string, { score: number, fields: Set<string> }>} */
        const next = new Map();
        for (const t of group) {
          const found = matchTerm(t);
          if (t.neg) {
            for (const id of records.keys()) if (!found.has(id)) next.set(id, next.get(id) ?? { score: 0, fields: new Set() });
            continue;
          }
          if (!t.phrase && !(t.field && operators[t.field])) scored = true;
          for (const [id, f] of found) {
            const cur = next.get(id) ?? { score: 0, fields: new Set() };
            cur.score = Math.max(cur.score, f.score);
            for (const x of f.fields) cur.fields.add(x);
            next.set(id, cur);
          }
        }
        // every group must match: keep what is in both, adding the scores
        if (!acc) acc = next;
        else {
          /** @type {typeof next} */
          const both = new Map();
          for (const [id, cur] of acc) {
            const n = next.get(id);
            if (n) both.set(id, { score: cur.score + n.score, fields: new Set([...cur.fields, ...n.fields]) });
          }
          acc = both;
        }
      }
      const hits = [...(acc ?? [])].map(([id, h]) => ({ id, score: h.score, fields: [...h.fields], ...pick(records.get(id), store) }));
      // words rank by score; a query of only filters, phrases or leave-outs lists newest first
      hits.sort(scored
        ? (a, b) => b.score - a.score || newest(records.get(b.id) ?? {}) - newest(records.get(a.id) ?? {})
        : (a, b) => newest(records.get(b.id) ?? {}) - newest(records.get(a.id) ?? {}));
      return { hits: hits.slice(0, limit), unknown };
    },
  };
}

/** @param {Record<string, unknown> | undefined} rec @param {string[]} keys */
function pick(rec, keys) {
  /** @type {Record<string, unknown>} */
  const out = {};
  if (rec) for (const k of keys) out[k] = rec[k];
  return out;
}
