// Each fact line and its questions, and the order cards come in. Pure (no DOM, no network), so
// app/test/cards.unit.test.mjs runs it in Node; data.js loads the files, screens/align.js shows the cards.
//
// The data (anaesfacts' app/ folder, served at /data/ by worker/data.js): index.json = { areas: { <area>: { v, topics,
// fact and question counts } } }; <area>.json = { area, topics: [{ k, t, f: [[hash, section, text]], q: [[hash, kind, stem,
// answer, options?]] }] }. A fact's id is <area>/<topic>#<hash>; when its line changes, so does its id.

export const AREAS = ['drugs', 'regional', 'airway', 'comorbidities', 'procedures', 'physiology', 'equipment', 'crises', 'other'];
export const AREA_NAMES = /** @type {Record<string, string>} */ ({
  drugs: 'Drugs', regional: 'Regional', airway: 'Airway', comorbidities: 'Comorbidities', procedures: 'Procedures',
  physiology: 'Physiology', equipment: 'Equipment', crises: 'Crises', other: 'Other',
});

/** @typedef {{ id: string, area: string, topic: string, title: string, section: string, text: string, qs: Question[] }} Fact */
/** @typedef {{ kind: 'mcq' | 'statement' | 'blank', stem: string, answer: string | number, options?: string[] }} Question */
/** @typedef {{ area: string, topics: { k: string, t: string, f: [string, string, string][], q: any[] }[] }} AreaFile */

/** @param {AreaFile[]} files -> every fact, in file order, with its questions */
export function cardsFrom(files) {
  /** @type {Fact[]} */
  const out = [];
  for (const file of files) {
    for (const t of file?.topics || []) {
      /** @type {Map<string, Question[]>} */
      const qs = new Map();
      for (const q of t.q || []) {
        const [h, kind, stem, answer, options] = q;
        if (!['mcq', 'statement', 'blank'].includes(kind)) continue;
        if (kind === 'mcq' && !(Array.isArray(options) && options[answer] !== undefined)) continue;
        (qs.get(h) ?? qs.set(h, []).get(h))?.push({ kind, stem, answer, ...(kind === 'mcq' ? { options } : {}) });
      }
      const topic = `${file.area}/${t.k}`;
      for (const [h, section, text] of t.f || []) {
        out.push({ id: `${topic}#${h}`, area: file.area, topic, title: t.t, section, text, qs: qs.get(h) || [] });
      }
    }
  }
  return out;
}

// The Firestore doc id of a fact's verdict ('/' and '#' are not allowed there, '~' is) and back.
/** @param {string} factId */
export const docId = factId => factId.replace('/', '~').replace('#', '~');
/** @param {string} id */
export const factIdOf = id => { const [a, t, h] = id.split('~'); return `${a}/${t}#${h}`; };

/** the app-sync collection of his answers (cloud.js; rules in firestore.app.rules) */
export const VERDICTS = 'verdicts';
/** @typedef {{ id: string, fact: string, choice: string, text?: string, at: number, by: string }} Verdict */

/** what he can say about a card (verdict docs' `choice`); 'seen' = swiped on with no answer */
export const CHOICES = ['agree', 'repo-wrong', 'me-wrong', 'also-true', 'bad-question', 'edit', 'seen'];

/**
 * The order cards come in: lines never seen first (those with a question before those without), then the ones seen
 * longest ago. A topic or area filter narrows it; a search too (topic title or fact text, every word).
 * @param {Fact[]} list
 * @param {Map<string, number>} seenAt  fact id -> when he last answered it (verdicts' `at`)
 * @param {{ area?: string, topic?: string, search?: string }} [filter]
 * @returns {Fact[]}
 */
export function queue(list, seenAt, filter = {}) {
  const words = (filter.search || '').toLowerCase().split(/\s+/).filter(Boolean);
  const pick = list.filter(f => (!filter.area || f.area === filter.area) && (!filter.topic || f.topic === filter.topic)
    && (!words.length || words.every(w => f.title.toLowerCase().includes(w) || f.text.toLowerCase().includes(w))));
  const never = pick.filter(f => !seenAt.has(f.id));
  const seen = pick.filter(f => seenAt.has(f.id)).sort((a, b) => /** @type {number} */ (seenAt.get(a.id)) - /** @type {number} */ (seenAt.get(b.id)));
  return [...never.filter(f => f.qs.length), ...never.filter(f => !f.qs.length), ...seen];
}

/**
 * Which question a fact's card asks: an MCQ first, else a statement or blank, else none (the fact itself is shown);
 * `turn` steps through them on later visits.
 * @param {Fact} fact @param {number} [turn] @returns {Question | null}
 */
export function questionFor(fact, turn = 0) {
  if (!fact.qs.length) return null;
  const order = [...fact.qs.filter(q => q.kind === 'mcq'), ...fact.qs.filter(q => q.kind !== 'mcq')];
  return order[turn % order.length];
}

/** @param {string} s  the line's own Markdown emphasis (**bold**) as plain text; a blank's ____ stays */
export const plain = s => String(s).replace(/\*\*(.+?)\*\*/g, '$1')
  .replace(/(^|\W)([*_])(?![*_\s])(.*?[^*_\s]|[^*_\s])\2(?=\W|$)/g, '$1$3').replace(/`/g, '');

/** @param {Verdict[]} verdicts -> line id -> when he last answered it (queue's seenAt) */
export const seenFrom = verdicts => new Map(verdicts.map(v => [v.fact, v.at]));

/** @param {Fact[]} list -> topics, by area then title: { topic, title, area } */
export function topicsOf(list) {
  const seen = new Map();
  for (const f of list) if (!seen.has(f.topic)) seen.set(f.topic, { topic: f.topic, title: f.title, area: f.area });
  return [...seen.values()];
}
