// The Test tab's spacing and deck: a small FSRS-style scheduler (FSRS-4.5's forgetting curve and update rules, with the
// default weights, for a right/wrong answer only) and the order cards come in. Pure (no DOM, no network), so
// app/test/schedule.unit.test.mjs runs it in Node; screens/test.js shows the cards and cloud.js keeps the states.
//
// A state is { s, d, due, last, reps, lapses, ok }: stability s (days until recall falls to 90%), difficulty d (1 to 10),
// when it is due and was last answered (ms), answers and misses so far, and whether the last answer was right.

const DAY = 864e5;
/** @typedef {{ s: number, d: number, due: number, last: number, reps: number, lapses: number, ok: boolean }} Recall */

// FSRS-4.5 default weights, the ones used here: w[0] first stability after a miss, w[2] after a hit, w[4] and w[5] the
// starting difficulty, w[6] its step, w[7] its pull back to the middle, w[8..10] growth after a hit, w[11..14] after a miss
const W = [0.4872, 1.4003, 3.7145, 13.8206, 5.1618, 1.2298, 0.8975, 0.031, 1.6474, 0.1367, 1.0461, 2.1072, 0.0793, 0.3246, 1.587, 0.2272, 2.8755];
const FACTOR = 19 / 81, DECAY = -0.5;
/** a missed card comes back after this (a relearning step), whatever its stability */
export const RELEARN = 10 * 60e3;
const MAX_DAYS = 365;

const clamp = (/** @type {number} */ x, /** @type {number} */ lo, /** @type {number} */ hi) => Math.min(hi, Math.max(lo, x));

/** @param {Recall} r @param {number} now -> the chance he still recalls it, 0 to 1 */
export const retrievability = (r, now) => (1 + FACTOR * Math.max(0, now - r.last) / DAY / r.s) ** DECAY;

/**
 * The state after one answer. `before` null: first time.
 * @param {Recall | null} before @param {boolean} ok @param {number} now @returns {Recall}
 */
export function grade(before, ok, now) {
  if (!before) {
    const d = clamp(ok ? W[4] : W[4] + 2 * W[5], 1, 10);
    const s = ok ? W[2] : W[0];
    return { s, d, due: ok ? now + s * DAY : now + RELEARN, last: now, reps: 1, lapses: ok ? 0 : 1, ok };
  }
  const r = retrievability(before, now);
  // difficulty: a miss makes it harder (+2 steps), a hit leaves it; either way it is pulled gently toward the start
  const step = ok ? 0 : 2 * W[6];
  const d = clamp(W[7] * W[4] + (1 - W[7]) * (before.d + step), 1, 10);
  let s;
  if (ok) {
    s = before.s * (1 + Math.exp(W[8]) * (11 - before.d) * before.s ** -W[9] * (Math.exp(W[10] * (1 - r)) - 1));
    s = Math.max(s, before.s);   // answered early, a hit never shortens the interval
  } else {
    s = W[11] * before.d ** -W[12] * ((before.s + 1) ** W[13] - 1) * Math.exp(W[14] * (1 - r));
    s = Math.min(s, before.s);   // a miss never lengthens it
  }
  s = clamp(s, 0.1, MAX_DAYS);
  return { s, d, due: ok ? now + Math.max(1, Math.round(s)) * DAY : now + RELEARN, last: now, reps: before.reps + 1, lapses: before.lapses + (ok ? 0 : 1), ok };
}

/**
 * The order cards come in: those due now first (the most overdue first), then lines never answered (those with a
 * question; file order), then the rest by when they fall due (soonest first, so a recent miss comes before a long
 * interval; the one seen longest ago first on a tie). A topic or area filter narrows it; a search too (topic title or
 * line text, every word). Lines without a question and any in `skip` (open flags, sent back) are left out.
 * @template {{ id: string, area: string, topic: string, title: string, text: string, qs: unknown[] }} F
 * @param {F[]} list @param {Map<string, Recall>} states  line id -> its state @param {number} now
 * @param {{ area?: string, topic?: string, search?: string }} [filter] @param {Set<string>} [skip]  line ids left out
 * @returns {F[]}
 */
export function testDeck(list, states, now, filter = {}, skip = new Set()) {
  const words = (filter.search || '').toLowerCase().split(/\s+/).filter(Boolean);
  const pick = list.filter(f => f.qs.length && !skip.has(f.id) && (!filter.area || f.area === filter.area) && (!filter.topic || f.topic === filter.topic)
    && (!words.length || words.every(w => f.title.toLowerCase().includes(w) || f.text.toLowerCase().includes(w))));
  const at = (/** @type {F} */ f) => /** @type {Recall} */ (states.get(f.id));
  const known = pick.filter(f => states.has(f.id));
  const due = known.filter(f => at(f).due <= now).sort((a, b) => at(a).due - at(b).due);
  const later = known.filter(f => at(f).due > now).sort((a, b) => at(a).due - at(b).due || at(a).last - at(b).last);
  return [...due, ...pick.filter(f => !states.has(f.id)), ...later];
}

/**
 * The score per topic: of the lines answered, how many he got right last time. Topics in the order the list has them.
 * @param {{ id: string, topic: string, title: string }[]} list @param {Map<string, Recall>} states
 * @param {{ area?: string, topic?: string }} [filter]
 * @returns {{ topic: string, title: string, right: number, answered: number }[]}
 */
export function topicScores(list, states, filter = {}) {
  /** @type {Map<string, { topic: string, title: string, right: number, answered: number }>} */
  const out = new Map();
  for (const f of list) {
    const st = states.get(f.id);
    if (!st) continue;
    if (filter.area && !f.topic.startsWith(`${filter.area}/`)) continue;
    const row = out.get(f.topic) ?? out.set(f.topic, { topic: f.topic, title: f.title, right: 0, answered: 0 }).get(f.topic);
    if (!row) continue;
    row.answered++;
    if (st.ok) row.right++;
  }
  return [...out.values()];
}
