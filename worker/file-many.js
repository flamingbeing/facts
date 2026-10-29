// The Add tab's "Paste notes" mode: POST /api/file-many { text, topics } -> { items: [{ topic, section, line, isNew, title? }],
// cut, skipped }. Same sign-in, owner check and ANTHROPIC_API_KEY secret as worker/file.js. Claude Sonnet splits a pasted
// topic or info dump into separate one-line facts and files each; it never adds a fact, a number or a caveat. Every item
// carries the part of his text it came from ("source"): if the model changed a number in the line, that item falls back to
// his own words (file.js filing()). Nothing is saved here; each item becomes a confirm card and Confirm queues it.
// Local (the tests): one canned item per non-empty line of the dump, no network.
import { verifyIdToken } from './claims.js';
import { AREAS, anthropic, cleanTopics, filing, gate, json, numbers, pickModel } from './file.js';

export const MAX_DUMP = 30000, MAX_LINES = 150, MAX_TOKENS = 32000;

const norm = (/** @type {string} */ s) => s.replace(/\s+/g, ' ').trim();
const unbullet = (/** @type {string} */ s) => s.trim().replace(/^[-•*]\s*/, '');

/** the prompt: house style, the rules, the topic list, his dump
 * @param {string} text @param {[string, string, string[]][]} topics */
export function manyPrompt(text, topics) {
  const list = topics.map(([id, title, sections]) => `${id} | ${title} | ${sections.join('; ')}`).join('\n');
  return [
    'You file a pasted block of the owner\'s own notes into a set of anaesthesia notes. The facts are his, so they count as vetted.',
    `Split the block into separate facts, one short line each, at most ${MAX_LINES}. If there are more, give the first ${MAX_LINES} and set "more" to true.`,
    'Reply with one JSON object only, no other text: {"items":[{"source":"<the words of his text this line comes from, copied exactly, the smallest part that holds this fact>","topic":"<area>/<slug>","title":"<topic title, only if the topic is new>","section":"<section title>","line":"<the fact as one bullet>"}],"more":false}.',
    'Topic: choose the best existing topic id from the list. Only if none fits, make a new one: area one of ' + AREAS.join(', ') + ', slug in kebab-case, and give its title. Facts about the same new topic all use the same id and title.',
    'Section: an existing section of that topic if one fits, else a short new one written out in full (Administration, not Admin). Drug sections come in the order Presentation, Administration, Dosage, Mechanism of action, Effects, Adverse effects, Contraindications, Indications, Pharmacokinetics.',
    'Line: house style is a short plain bullet in plain words, no arrows or symbols for up and down (write "increases", "falls"), no leading dash. Keep every number, unit and drug name exactly as written. Never add a fact, a number or a caveat he did not give. Skip headings and anything that is not a fact.',
    '', 'Topics (id | title | sections):', list || '(none yet)', '', 'His notes:', text,
  ].join('\n');
}

/**
 * Pull the item objects out of a reply, even one cut off by the token limit or with text around it.
 * -> { items, truncated, more }
 * @param {string} reply
 */
export function parseItems(reply) {
  const s = String(reply);
  try {
    const o = JSON.parse(s.replace(/^[^{[]*/, '').replace(/[^}\]]*$/, ''));
    const items = Array.isArray(o) ? o : o?.items;
    if (Array.isArray(items)) return { items: items.filter(i => i && typeof i === 'object'), truncated: false, more: o?.more === true };
  } catch { /* fall through to the scanner */ }
  // scan complete { } objects inside the "items" array, string-aware; a half-written last one is dropped
  const at = s.search(/"items"\s*:\s*\[/);
  const start = at < 0 ? s.indexOf('[') : s.indexOf('[', at);
  /** @type {any[]} */
  const items = [];
  if (start < 0) return { items, truncated: false, more: false };
  let depth = 0, from = -1, str = false, esc = false;
  for (let i = start + 1; i < s.length; i++) {
    const c = s[i];
    if (str) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') str = false; continue; }
    if (c === '"') str = true;
    else if (c === '{') { if (!depth) from = i; depth++; }
    else if (c === '}' && depth && !--depth) { try { items.push(JSON.parse(s.slice(from, i + 1))); } catch { /* skip it */ } }
  }
  return { items, truncated: true, more: false };
}

/**
 * The pure part: the model's reply -> checked items. Each line keeps his numbers exactly or falls back to his words.
 * @param {string} reply @param {string} dump @param {Set<string>} known  existing topic ids
 */
export function manyFilings(reply, dump, known) {
  const { items, truncated, more } = parseItems(reply);
  const whole = norm(dump), have = new Set(numbers(dump));
  /** @type {any[]} */
  const out = [];
  let skipped = 0;
  for (const it of items.slice(0, MAX_LINES)) {
    const source = norm(String(it?.source || ''));
    const grounded = !!source && whole.includes(source);
    // a source we can find in his text checks the line's numbers; no usable source: the line's numbers must all be his
    const text = grounded ? unbullet(source) : unbullet(String(it?.line || ''));
    const ok = grounded || numbers(text).every(n => have.has(n));
    const f = ok && text ? filing(JSON.stringify(it), text, known) : null;
    if (f) out.push(f); else skipped++;
  }
  return { items: out, cut: more || truncated || items.length > MAX_LINES, skipped };
}

/**
 * deps = { verify(idToken), ask(prompt) -> text, or null when the key is not set, local }. Exported with its seams for
 * worker/test/file-many.test.mjs.
 * @param {Request} request @param {any} deps
 */
export async function handleFileMany(request, { verify, ask, local = false }) {
  const g = await gate(request, verify);
  if (g.fail) return g.fail;
  const text = String(g.body?.text || '').trim();
  if (!text) return json({ error: 'Paste some notes first.' }, 400);
  if (text.length > MAX_DUMP) return json({ error: `Too long: up to ${MAX_DUMP} characters at a time.` }, 400);
  const topics = cleanTopics(g.body?.topics);
  if (local) {
    const first = topics[0]?.[0] || 'drugs/demo-drug';
    const lines = text.split('\n').map(unbullet).filter(Boolean);
    const items = lines.slice(0, MAX_LINES).map(line => ({ topic: first, section: 'Notes', line, isNew: false }));
    return json({ items, cut: lines.length > MAX_LINES, skipped: 0 });
  }
  if (!ask) return json({ error: 'Filing isn’t set up yet: the Worker needs its ANTHROPIC_API_KEY secret.' }, 503);
  try {
    const reply = await ask(manyPrompt(text, topics), pickModel(g.body?.model));
    const out = manyFilings(reply, text, new Set(topics.map((/** @type {any[]} */ t) => t[0])));
    if (!out.items.length) console.error('file-many: reply not usable', String(reply).slice(0, 300));
    return out.items.length ? json(out) : json({ error: 'Couldn’t place any of that. Try a smaller paste.' }, 502);
  } catch (e) {
    console.error('file-many failed', /** @type {any} */ (e)?.message);
    return json({ error: 'Couldn’t reach the filing service. Try again.' }, 502);
  }
}

export const fileManyRoute = {
  /** @param {URL} url */
  match: url => url.pathname === '/api/file-many',
  /** @param {Request} request @param {any} env @param {{ url: URL, local: boolean, project: string }} ctx */
  handle(request, env, { local, project }) {
    const emulator = !!(local && env.EMULATOR);
    return handleFileMany(request, {
      verify: (/** @type {string} */ t) => verifyIdToken(t, { project, emulator }),
      ask: env.ANTHROPIC_API_KEY ? anthropic(env, MAX_TOKENS) : null,
      local,
    });
  },
};
