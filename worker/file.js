// The Add tab's filing: POST /api/file { text, topics } -> { topic, section, line, isNew }. Owner only (the same verified
// sign-in as worker/flush.js). Claude Sonnet reads what he typed and the topic list the page already has (topic id, title,
// sections), and says where it belongs and the line in anaesfacts' house style; it never adds a fact. Nothing is saved here:
// the page shows a confirm card, and Confirm queues the line through /api/flush (choice 'add').
//
// The Anthropic key is a Worker secret (ANTHROPIC_API_KEY), never in a file. Without it the route answers 503 with a plain
// message. Local (the tests): a canned filing, no network.
import { verifyIdToken } from './claims.js';
import { isOwner } from './flush.js';

export const MODEL = 'claude-sonnet-5-5';
/** the filing model he picks on the page: Haiku (default, faster) or Sonnet */
export const MODELS = { sonnet: MODEL, haiku: 'claude-haiku-5-5' };
/** @param {unknown} v */
export const pickModel = v => MODELS[/** @type {'sonnet'|'haiku'} */ (v)] || MODELS.haiku;
export const AREAS = ['drugs', 'regional', 'airway', 'comorbidities', 'procedures', 'physiology', 'equipment', 'crises', 'other'];
const SLUG = /^[a-z][a-z0-9-]{0,60}$/;
const MAX_TEXT = 1000, MAX_TOPICS = 2000;

const json = (/** @type {unknown} */ body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });

/** every number (digits with a . or , inside) in a text, in order */
/** @param {string} s */
export const numbers = s => s.match(/\d+(?:[.,]\d+)*/g) || [];

/** the prompt: house style, the rules, the topic list, what he typed
 * @param {string} text @param {[string, string, string[]][]} topics */
export function prompt(text, topics) {
  const list = topics.map(([id, title, sections]) => `${id} | ${title} | ${sections.join('; ')}`).join('\n');
  return [
    'You file one fact into a set of anaesthesia notes. The fact is the owner\'s own, so it counts as vetted.',
    'Reply with one JSON object only, no other text: {"topic":"<area>/<slug>","title":"<topic title, only if the topic is new>","section":"<section title>","line":"<the fact as one bullet>"}.',
    'Topic: choose the best existing topic id from the list. Only if none fits, make a new one: area one of ' + AREAS.join(', ') + ', slug in kebab-case, and give its title.',
    'Section: an existing section of that topic if one fits, else a short new one written out in full (Administration, not Admin). Drug sections come in the order Presentation, Administration, Dosage, Mechanism of action, Effects, Adverse effects, Contraindications, Indications, Pharmacokinetics.',
    'Line: house style is a short plain bullet in plain words, no arrows or symbols for up and down (write "increases", "falls"), no leading dash. Keep every number, unit and drug name exactly as written. Never add a fact, a number or a caveat he did not give.',
    '', 'Topics (id | title | sections):', list || '(none yet)', '', 'The fact:', text,
  ].join('\n');
}

/**
 * The pure part: the model's reply -> a checked filing, or null. The line falls back to his own words when the model
 * changed or dropped a number.
 * @param {string} reply @param {string} text @param {Set<string>} known  existing topic ids
 */
export function filing(reply, text, known) {
  let o;
  try { o = JSON.parse(String(reply).replace(/^[^{]*/, '').replace(/[^}]*$/, '')); } catch { return null; }
  // tolerant: a topic id in any case or with spaces/underscores is tidied; an unknown area files under "other"; a missing
  // section or line falls back to "Notes" and his own words, so a fixable reply is never thrown away
  const kebab = (/** @type {string} */ x) => x.trim().toLowerCase().replace(/[\s_]+/g, '-').replace(/[^a-z0-9-]/g, '').replace(/^-+|-+$/g, '');
  const [a, ...rest] = String(o?.topic || '').split('/');
  const slug = kebab(rest.join('-'));
  if (!SLUG.test(slug)) return null;
  const area = AREAS.includes(kebab(a)) ? kebab(a) : 'other';
  const topic = `${area}/${slug}`;
  const section = String(o?.section || '').trim().replace(/^#+\s*/, '').slice(0, 60) || 'Notes';
  let line = String(o?.line || '').trim().replace(/^[-•*]\s*/, '');
  if (!line || line.length > 500) line = text.trim().replace(/^[-•*]\s*/, '');
  if (line.length > 500) return null;
  const want = numbers(text).join('|'), got = numbers(line).join('|');
  if (want !== got) line = text.trim().replace(/^[-•*]\s*/, '');
  const isNew = !known.has(topic);
  return { topic, section, line, isNew, ...(isNew ? { title: String(o?.title || '').trim().slice(0, 100) || slug.replace(/-/g, ' ') } : {}) };
}

/** @param {any} env @param {number} [maxTokens]  -> (prompt, model?) => the model's text */
export const anthropic = (env, maxTokens = 1500) => async (/** @type {string} */ p, /** @type {string} */ model = MODEL) => {
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST', headers: { 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model, max_tokens: maxTokens, messages: [{ role: 'user', content: p }] }),
  });
  if (!r.ok) throw new Error(`anthropic ${r.status}`);
  // the reply can start with a non-text block (thinking); join every text block
  const blocks = (await r.json())?.content;
  return (Array.isArray(blocks) ? blocks : []).filter((/** @type {any} */ b) => b?.type === 'text').map((/** @type {any} */ b) => String(b.text || '')).join('\n');
};

/**
 * The shared door of /api/file and /api/file-many: POST, same origin, a verified sign-in that is the owner's, a JSON body.
 * -> { body } or { fail: the Response }
 * @param {Request} request @param {(t: string) => Promise<any>} verify
 */
export async function gate(request, verify) {
  const url = new URL(request.url);
  if (request.method !== 'POST') return { fail: json({ error: 'POST.' }, 405) };
  const from = request.headers.get('Origin');
  if (from && from !== url.origin) return { fail: json({ error: 'Wrong origin.' }, 403) };
  const idToken = (request.headers.get('Authorization') || '').match(/^Bearer\s+(\S+)$/)?.[1];
  if (!idToken) return { fail: json({ error: 'Sign in first.' }, 401) };
  let token;
  try { token = await verify(idToken); } catch { return { fail: json({ error: 'Sign in again.' }, 401) }; }
  if (!isOwner(token)) return { fail: json({ error: 'Owner only.' }, 403) };
  try { return { body: /** @type {any} */ (await request.json()) }; } catch { return { fail: json({ error: 'Send JSON.' }, 400) }; }
}

/** the topic list the page sends, cleaned: [id, title, sections][]
 * @param {any} list */
export const cleanTopics = list => (Array.isArray(list) ? list : []).slice(0, MAX_TOPICS)
  .filter((/** @type {any} */ t) => Array.isArray(t) && typeof t[0] === 'string')
  .map((/** @type {any[]} */ t) => [t[0].slice(0, 80), String(t[1] || '').slice(0, 100), (Array.isArray(t[2]) ? t[2] : []).map((/** @type {any} */ s) => String(s).slice(0, 60)).slice(0, 30)]);

export { json };

/**
 * deps = { verify(idToken), ask(prompt) -> text, or null when the key is not set, local }. Exported with its seams for
 * worker/test/file.test.mjs.
 * @param {Request} request @param {any} deps
 */
export async function handleFile(request, { verify, ask, local = false }) {
  const g = await gate(request, verify);
  if (g.fail) return g.fail;
  const body = g.body;
  const text = String(body?.text || '').trim();
  if (!text) return json({ error: 'Type a fact first.' }, 400);
  if (text.length > MAX_TEXT) return json({ error: 'Too long: one fact at a time.' }, 400);
  const topics = cleanTopics(body?.topics);
  if (local) {
    const first = topics[0]?.[0] || 'drugs/demo-drug';
    return json({ topic: first, section: 'Notes', line: text.replace(/^[-•*]\s*/, ''), isNew: false });
  }
  if (!ask) return json({ error: 'Filing isn’t set up yet: the Worker needs its ANTHROPIC_API_KEY secret.' }, 503);
  try {
    const reply = await ask(prompt(text, topics), pickModel(body?.model));
    const out = filing(reply, text, new Set(topics.map((/** @type {any[]} */ t) => t[0])));
    if (!out) console.error('file: reply not usable', String(reply).slice(0, 300));
    return out ? json(out) : json({ error: 'Couldn’t place that one. Try wording it differently.' }, 502);
  } catch (e) {
    console.error('file failed', /** @type {any} */ (e)?.message);
    return json({ error: 'Couldn’t reach the filing service. Try again.' }, 502);
  }
}

export const fileRoute = {
  /** @param {URL} url */
  match: url => url.pathname === '/api/file',
  /** @param {Request} request @param {any} env @param {{ url: URL, local: boolean, project: string }} ctx */
  handle(request, env, { local, project }) {
    const emulator = !!(local && env.EMULATOR);
    return handleFile(request, {
      verify: (/** @type {string} */ t) => verifyIdToken(t, { project, emulator }),
      ask: env.ANTHROPIC_API_KEY ? anthropic(env) : null,
      local,
    });
  },
};
