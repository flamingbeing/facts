// The Add tab's filing: POST /api/file { text, topics, model } -> { items, cut, skipped, model, usage }. Owner only (the same
// verified sign-in as worker/flush.js). One box: one fact or a whole pasted dump, the same route either way. Two passes:
//   1. split + file: Claude splits what he pasted into one-line facts and files each (topic, section, the line in house
//      style). The house rules and the topic list (id, title, sections; the page sends it) go first, in a cached system
//      block, so a second call within minutes reads them from the cache.
//   2. reconcile: for each existing topic it touched, the topic's existing lines (from the notes' own data, data.js) and
//      the new facts for it -> per fact an action: new (add it), duplicate (already there: the line it repeats), merge
//      (adds detail to a line: the merged line), correct (contradicts a line: the replacement and why).
// It never adds a fact: every line keeps his numbers (a changed number falls back to his own words, or to "new"). Nothing
// is saved here: each item becomes a card, and Confirm queues it through /api/flush (choice 'add', or 'edit' for a merge
// or correct). model: 'haiku' (default) or 'sonnet', mapped here; the page never names a model id.
//
// The Anthropic key is a Worker secret (ANTHROPIC_API_KEY), never in a file. Without it the route answers 503 with a plain
// message. Local (the tests): the same two passes against a canned model (localAsk), no network.
import { verifyIdToken } from './claims.js';
import { isOwner } from './flush.js';
import { UPSTREAM } from './data.js';

export const MODELS = { haiku: 'claude-haiku-5-5', sonnet: 'claude-sonnet-5-5' };
export const AREAS = ['drugs', 'regional', 'airway', 'comorbidities', 'procedures', 'physiology', 'equipment', 'crises', 'other'];
export const ACTIONS = ['new', 'duplicate', 'merge', 'correct'];
export const MAX_DUMP = 60000, MAX_LINES = 300, MAX_TOKENS = 64000;
// one reconcile call holds at most this much of a topic's existing lines (characters; ~35k tokens), so every call stays
// well under 100k input tokens (Haiku's price goes up above that); a bigger topic is reconciled in chunks
export const CHUNK = 120000;
const SLUG = /^[a-z][a-z0-9-]{0,60}$/;
const MAX_TOPICS = 2000, PARALLEL = 4;

export const json = (/** @type {unknown} */ body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });
const norm = (/** @type {string} */ s) => s.replace(/\s+/g, ' ').trim();
const unbullet = (/** @type {string} */ s) => s.trim().replace(/^[-•*]\s*/, '');
/** a line as plain words, for comparing: no bold marks, no case, no end stop */
const plain = (/** @type {string} */ s) => norm(unbullet(s).replace(/\*\*/g, '')).toLowerCase().replace(/[.;]+$/, '');

/** every number (digits with a . or , inside) in a text, in order */
/** @param {string} s */
export const numbers = s => s.match(/\d+(?:[.,]\d+)*/g) || [];

/** the model the page asked for -> its id; anything else is Haiku
 * @param {unknown} m */
export const modelId = m => MODELS[/** @type {keyof MODELS} */ (m === 'sonnet' ? 'sonnet' : 'haiku')];

/** pass 1's system text: the house rules, then the topic list. The same for every call while the notes don't change.
 * @param {[string, string, string[]][]} topics */
export function filePrompt(topics) {
  const list = topics.map(([id, title, sections]) => `${id} | ${title} | ${sections.join('; ')}`).join('\n');
  return [
    'You file the owner\'s own notes into a set of anaesthesia notes. The facts are his, so they count as vetted.',
    `His message is one fact or a pasted block. Split it into separate facts, one short line each, at most ${MAX_LINES}. If there are more, give the first ${MAX_LINES} and set "more" to true.`,
    'Reply with one JSON object only, no other text: {"items":[{"source":"<the words of his text this line comes from, copied exactly, the smallest part that holds this fact>","topic":"<area>/<slug>","title":"<topic title, only if the topic is new>","section":"<section title>","line":"<the fact as one bullet>"}],"more":false}.',
    'Topic: choose the best existing topic id from the list. Only if none fits, make a new one: area one of ' + AREAS.join(', ') + ', slug in kebab-case, and give its title. Facts about the same new topic all use the same id and title.',
    'Section: an existing section of that topic if one fits, else a short new one written out in full (Administration, not Admin). Drug sections come in the order Presentation, Administration, Dosage, Mechanism of action, Effects, Adverse effects, Contraindications, Indications, Pharmacokinetics.',
    'Line: house style is a short plain bullet in plain words, no arrows or symbols for up and down (write "increases", "falls"), no leading dash. Keep every number, unit and drug name exactly as written. Never add a fact, a number or a caveat he did not give. Skip headings and anything that is not a fact.',
    '', 'Topics (id | title | sections):', list || '(none yet)',
  ].join('\n');
}

/** pass 2's system text (the same every call) */
export const RECONCILE = [
  'You compare new facts with the existing lines of one topic in a set of anaesthesia notes. The new facts are the owner\'s own.',
  'For each new fact, by its number n, choose one action:',
  '- "new": nothing in the existing lines says it; it is added as a new line.',
  '- "duplicate": an existing line already says the same thing (wording may differ, nothing is added). Give that line\'s id.',
  '- "merge": an existing line says the same thing with less detail, and the fact adds detail to it. Give that line\'s id and "line": the existing line with the new detail worked in, one short bullet.',
  '- "correct": the fact contradicts an existing line (a different dose, number or claim about the same thing). Give that line\'s id, "line": the replacement line, and "why": one short sentence on what changed.',
  'Only choose duplicate, merge or correct when the id is of a line about the very same point; if unsure, choose "new".',
  'Keep every number, unit and drug name exactly as written in the fact and the line. Never add a fact, a number or a caveat that is in neither. House style: short plain bullet, plain words, no arrows, no leading dash.',
  'Reply with one JSON object only, no other text: {"results":[{"n":1,"action":"new"},{"n":2,"action":"duplicate","id":"<line id>"},{"n":3,"action":"merge","id":"<line id>","line":"..."},{"n":4,"action":"correct","id":"<line id>","line":"...","why":"..."}]}.',
].join('\n');

/** pass 2's message for one topic (or one chunk of its lines)
 * @param {string} topic @param {string} title @param {[string, string, string][]} lines  [id, section, text] @param {{ section: string, line: string }[]} facts */
export const reconcileMessage = (topic, title, lines, facts) => [
  `Topic: ${topic} (${title})`, '', 'Existing lines (id | section | line):', ...lines.map(([id, s, t]) => `${id} | ${s} | ${t}`),
  '', 'New facts (n | section | line):', ...facts.map((f, i) => `${i + 1} | ${f.section} | ${f.line}`),
].join('\n');

/**
 * One filed fact: the model's item -> a checked filing, or null. The line falls back to his own words (text) when the
 * model changed or dropped a number.
 * @param {any} o @param {string} text @param {Set<string>} known  existing topic ids
 */
export function filing(o, text, known) {
  // tolerant: a topic id in any case or with spaces/underscores is tidied; an unknown area files under "other"; a missing
  // section or line falls back to "Notes" and his own words, so a fixable reply is never thrown away
  const kebab = (/** @type {string} */ x) => x.trim().toLowerCase().replace(/[\s_]+/g, '-').replace(/[^a-z0-9-]/g, '').replace(/^-+|-+$/g, '');
  const [a, ...rest] = String(o?.topic || '').split('/');
  const slug = kebab(rest.join('-'));
  if (!SLUG.test(slug)) return null;
  const area = AREAS.includes(kebab(a)) ? kebab(a) : 'other';
  const topic = `${area}/${slug}`;
  const section = String(o?.section || '').trim().replace(/^#+\s*/, '').slice(0, 60) || 'Notes';
  let line = unbullet(String(o?.line || ''));
  if (!line || line.length > 500) line = unbullet(text);
  if (line.length > 500) return null;
  if (numbers(text).join('|') !== numbers(line).join('|')) line = unbullet(text);
  const isNew = !known.has(topic);
  return { topic, section, line, isNew, ...(isNew ? { title: String(o?.title || '').trim().slice(0, 100) || slug.replace(/-/g, ' ') } : {}) };
}

/**
 * Pull the objects of one array ("items" or "results") out of a reply, even one cut off by the token limit or with text
 * around it. -> { list, truncated, more }
 * @param {string} reply @param {string} [key]
 */
export function parseList(reply, key = 'items') {
  const s = String(reply);
  try {
    const o = JSON.parse(s.replace(/^[^{[]*/, '').replace(/[^}\]]*$/, ''));
    const list = Array.isArray(o) ? o : o?.[key];
    if (Array.isArray(list)) return { list: list.filter(i => i && typeof i === 'object'), truncated: false, more: o?.more === true };
  } catch { /* fall through to the scanner */ }
  // scan complete { } objects inside the array, string-aware; a half-written last one is dropped
  const at = s.search(new RegExp(`"${key}"\\s*:\\s*\\[`));
  const start = at < 0 ? s.indexOf('[') : s.indexOf('[', at);
  /** @type {any[]} */
  const list = [];
  if (start < 0) return { list, truncated: false, more: false };
  let depth = 0, from = -1, str = false, esc = false;
  for (let i = start + 1; i < s.length; i++) {
    const c = s[i];
    if (str) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') str = false; continue; }
    if (c === '"') str = true;
    else if (c === '{') { if (!depth) from = i; depth++; }
    else if (c === '}' && depth && !--depth) { try { list.push(JSON.parse(s.slice(from, i + 1))); } catch { /* skip it */ } }
  }
  return { list, truncated: true, more: false };
}

/**
 * Pass 1's pure part: the model's reply -> checked filings. Each line keeps his numbers exactly or falls back to his words.
 * @param {string} reply @param {string} dump @param {Set<string>} known  existing topic ids @param {boolean} [cutOff]  stop_reason was max_tokens
 */
export function filings(reply, dump, known, cutOff = false) {
  const { list, truncated, more } = parseList(reply, 'items');
  const whole = norm(dump), have = new Set(numbers(dump));
  /** @type {any[]} */
  const out = [];
  let skipped = 0;
  for (const it of list.slice(0, MAX_LINES)) {
    const source = norm(String(it?.source || ''));
    const grounded = !!source && whole.includes(source);
    // a source we can find in his text checks the line's numbers; no usable source: the line's numbers must all be his
    const text = grounded ? unbullet(source) : unbullet(String(it?.line || ''));
    const ok = grounded || numbers(text).every(n => have.has(n));
    const f = ok && text ? filing(it, text, known) : null;
    if (f) out.push(f); else skipped++;
  }
  return { items: out, cut: cutOff || more || truncated || list.length > MAX_LINES, skipped };
}

/**
 * Pass 2's pure part: one topic's reply -> an action per fact (same order as facts). A reply that cites no real line, or
 * whose line loses or invents a number, leaves that fact "new"; so does a fact the reply skipped.
 * @param {string} reply @param {{ line: string }[]} facts @param {[string, string, string][]} lines  [id, section, text]
 * -> { action, old?: { id, section, line }, line?, why? }[]
 */
export function verdicts(reply, facts, lines) {
  const byId = new Map(lines.map(l => [l[0], l]));
  /** @type {any[]} */
  const out = facts.map(() => ({ action: 'new' }));
  for (const r of parseList(reply, 'results').list) {
    const n = Number(r?.n) - 1, f = facts[n];
    if (!f || out[n].action !== 'new') continue;
    const action = String(r?.action || ''), l = byId.get(String(r?.id || '').trim());
    if (!ACTIONS.includes(action) || action === 'new' || !l) continue;
    const old = { id: l[0], section: l[1], line: l[2] };
    if (action === 'duplicate') { out[n] = { action, old }; continue; }
    const line = unbullet(String(r?.line || ''));
    if (!line || line.length > 500 || plain(line) === plain(l[2])) continue;
    // his numbers all survive; nothing new is invented; a merge also keeps the old line's numbers
    const mine = numbers(f.line), theirs = numbers(l[2]), got = numbers(line), from = new Set([...mine, ...theirs]);
    if (!mine.every(x => got.includes(x)) || !got.every(x => from.has(x))) continue;
    if (action === 'merge' && !theirs.every(x => got.includes(x))) continue;
    const why = action === 'correct' ? norm(String(r?.why || '')).slice(0, 200) || 'Differs from the line in the notes.' : '';
    out[n] = { action, old, line, ...(why ? { why } : {}) };
  }
  return out;
}

/** a reconcile result for one fact, from several chunks of the same topic: the first that isn't "new" wins
 * @param {any[][]} runs */
export const firstFound = runs => runs[0].map((_, i) => runs.find(r => r[i].action !== 'new')?.[i] ?? runs[0][i]);

/** split a topic's lines into chunks of at most CHUNK characters
 * @param {[string, string, string][]} lines */
export const chunks = (lines, max = CHUNK) => {
  /** @type {[string, string, string][][]} */
  const out = [[]];
  let size = 0;
  for (const l of lines) {
    const n = l[0].length + l[1].length + l[2].length + 6;
    if (size + n > max && out[out.length - 1].length) { out.push([]); size = 0; }
    out[out.length - 1].push(l); size += n;
  }
  return out;
};

/** the usage of several calls, added up */
export const addUsage = (/** @type {any} */ a, /** @type {any} */ u) => ({
  calls: a.calls + 1, input: a.input + (u?.input_tokens || 0), output: a.output + (u?.output_tokens || 0),
  cacheRead: a.cacheRead + (u?.cache_read_input_tokens || 0), cacheWrite: a.cacheWrite + (u?.cache_creation_input_tokens || 0),
});
const NO_USAGE = { calls: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };

export class Refused extends Error {}

/**
 * The Messages API, by fetch (a Worker has no SDK). -> (model, { system, user, cache, maxTokens }) => { text, stop, usage }.
 * Haiku runs at effort low. A refusal throws Refused; max_tokens comes back as stop for the caller to handle.
 * @param {any} env
 */
export const anthropic = env => async (/** @type {string} */ model, /** @type {{ system: string, user: string, cache?: boolean, maxTokens?: number }} */ o) => {
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST', headers: { 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({
      model, max_tokens: o.maxTokens || MAX_TOKENS,
      system: [{ type: 'text', text: o.system, ...(o.cache ? { cache_control: { type: 'ephemeral' } } : {}) }],
      messages: [{ role: 'user', content: o.user }],
      ...(model === MODELS.haiku ? { output_config: { effort: 'low' } } : {}),
    }),
  });
  if (!r.ok) throw new Error(`anthropic ${r.status}`);
  const j = await r.json();
  if (j?.stop_reason === 'refusal') throw new Refused('refused');
  // the reply can start with a non-text block (thinking); join every text block
  const text = (Array.isArray(j?.content) ? j.content : []).filter((/** @type {any} */ b) => b?.type === 'text').map((/** @type {any} */ b) => String(b.text || '')).join('\n');
  return { text, stop: String(j?.stop_reason || ''), usage: j?.usage || {} };
};

/**
 * The canned model of local runs (the browser tests): pass 1 files each line of his text under the first topic, section
 * Notes; pass 2 calls a fact that repeats a line "duplicate", one starting "More:" a merge with the first line, one
 * starting "Not:" a correction of it, anything else "new". Everything after it is the real code.
 * @param {[string, string, string[]][]} topics
 */
export const localAsk = topics => async (/** @type {string} */ _model, /** @type {{ system: string, user: string }} */ o) => {
  const usage = { input_tokens: 0, output_tokens: 0 };
  if (o.system !== RECONCILE) {
    const first = topics[0]?.[0] || 'drugs/demo-drug';
    const items = o.user.split('\n').map(unbullet).filter(Boolean).map(l => ({ source: l, topic: first, section: 'Notes', line: l }));
    return { text: JSON.stringify({ items }), stop: 'end_turn', usage };
  }
  const part = o.user.split('\nNew facts (n | section | line):\n');
  const lines = part[0].split('\nExisting lines (id | section | line):\n')[1].split('\n').filter(l => / \| .* \| /.test(l)).map(l => l.split(' | '));
  const src = new Map((o.user.match(/^\d+ \| .*$/gm) || []).map(l => { const [n, , ...t] = l.split(' | '); return [n, t.join(' | ')]; }));
  const results = [...src].map(([n, t]) => {
    const same = lines.find(l => plain(l.slice(2).join(' | ')) === plain(t));
    if (same) return { n, action: 'duplicate', id: same[0] };
    const m = /^(More|Not):\s*(.*)$/.exec(t), first = lines[0];
    if (m && first) return m[1] === 'More' ? { n, action: 'merge', id: first[0], line: `${first.slice(2).join(' | ')}; ${m[2]}` }
      : { n, action: 'correct', id: first[0], line: m[2], why: 'Made-up correction.' };
    return { n, action: 'new' };
  });
  return { text: JSON.stringify({ results }), stop: 'end_turn', usage };
};

/**
 * The door: POST, same origin, a verified sign-in that is the owner's, a JSON body. -> { body } or { fail: the Response }
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

/** run fns at most n at a time, results in order
 * @template T @param {(() => Promise<T>)[]} fns @param {number} n @returns {Promise<T[]>} */
async function limited(fns, n) {
  /** @type {T[]} */
  const out = [];
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, fns.length) }, async () => { while (next < fns.length) { const i = next++; out[i] = await fns[i](); } }));
  return out;
}

/**
 * Pass 2 over every existing topic the filings touched: each item gets its action (new topics: all "new").
 * @param {any[]} items @param {(topic: string) => Promise<{ title: string, lines: [string, string, string][] } | null>} read
 * @param {(model: string, o: any) => Promise<{ text: string, stop: string, usage: any }>} ask @param {string} model
 * -> { items, usage }
 */
export async function reconcile(items, read, ask, model) {
  /** @type {Map<string, number[]>} topic -> the indexes of its items */
  const by = new Map();
  items.forEach((it, i) => { if (!it.isNew) by.set(it.topic, [...(by.get(it.topic) || []), i]); });
  const out = items.map(it => ({ ...it, action: 'new' }));
  let usage = NO_USAGE;
  /** @type {(() => Promise<void>)[]} */
  const jobs = [];
  for (const [topic, idx] of by) jobs.push(async () => {
    const t = await read(topic);
    if (!t?.lines.length) return;
    const facts = idx.map(i => items[i]);
    const runs = [];
    for (const lines of chunks(t.lines)) {
      const r = await ask(model, { system: RECONCILE, user: reconcileMessage(topic, t.title, lines, facts), maxTokens: 4000 + 300 * facts.length });
      usage = addUsage(usage, r.usage);
      runs.push(verdicts(r.text, facts, lines));
    }
    firstFound(runs).forEach((v, k) => { out[idx[k]] = { ...out[idx[k]], ...v, ...(v.action === 'new' ? {} : { section: v.old.section }) }; });
  });
  await limited(jobs, PARALLEL);
  return { items: out, usage };
}

/**
 * A topic's existing lines from the notes' data (/data/<area>.json: { topics: [{ k, t, f: [[id, section, text]] }] }),
 * each area read once per call. -> (topic) => { title, lines } or null
 * @param {(area: string) => Promise<any>} area
 */
export const topicReader = area => {
  /** @type {Map<string, Promise<any>>} */
  const seen = new Map();
  return async (/** @type {string} */ topic) => {
    const [a, k] = topic.split('/');
    if (!seen.has(a)) seen.set(a, area(a).catch(() => null));
    const t = (await seen.get(a))?.topics?.find((/** @type {any} */ x) => x.k === k);
    return t ? { title: String(t.t || k), lines: (t.f || []).filter((/** @type {any} */ f) => Array.isArray(f) && f.length >= 3).map((/** @type {any[]} */ f) => [String(f[0]), String(f[1]), String(f[2])]) } : null;
  };
};

/**
 * deps = { verify(idToken), ask(model, o) -> { text, stop, usage }, or null when the key is not set, area(name) -> the
 * area's data, local }. Exported with its seams for worker/test/file.test.mjs.
 * @param {Request} request @param {any} deps
 */
export async function handleFile(request, { verify, ask, area, local = false }) {
  const g = await gate(request, verify);
  if (g.fail) return g.fail;
  const text = String(g.body?.text || '').trim();
  if (!text) return json({ error: 'Type or paste a fact first.' }, 400);
  if (text.length > MAX_DUMP) return json({ error: `Too long: up to ${MAX_DUMP} characters at a time.` }, 400);
  const topics = cleanTopics(g.body?.topics);
  const model = modelId(g.body?.model);
  if (local) ask = localAsk(topics);
  if (!ask) return json({ error: 'Filing isn’t set up yet: the Worker needs its ANTHROPIC_API_KEY secret.' }, 503);
  try {
    const r = await ask(model, { system: filePrompt(topics), user: text, cache: true, maxTokens: MAX_TOKENS });
    const known = new Set(topics.map((/** @type {any[]} */ t) => t[0]));
    const filed = filings(r.text, text, known, r.stop === 'max_tokens');
    if (!filed.items.length) {
      console.error('file: reply not usable', r.stop, String(r.text).slice(0, 300));
      return json({ error: 'Couldn’t place any of that. Try wording it differently, or a smaller paste.' }, 502);
    }
    const rec = await reconcile(filed.items, topicReader(area), ask, model);
    const usage = addUsage(rec.usage, r.usage);
    console.log('file usage', model, JSON.stringify(usage));
    return json({ items: rec.items, cut: filed.cut, skipped: filed.skipped, model: g.body?.model === 'sonnet' ? 'sonnet' : 'haiku', usage });
  } catch (e) {
    if (e instanceof Refused) return json({ error: 'The model declined that one. Try wording it differently.' }, 502);
    console.error('file failed', /** @type {any} */ (e)?.message);
    return json({ error: 'Couldn’t reach the filing service. Try again.' }, 502);
  }
}

/**
 * An area's data: the same files data.js serves, GitHub's raw files live (kept at the edge 5 minutes), the made-up set
 * locally. -> (area) => the area JSON or null
 * @param {any} env @param {URL} url @param {boolean} local
 */
export const areaReader = (env, url, local) => async (/** @type {string} */ a) => {
  if (!/^[a-z][a-z0-9-]{0,40}$/.test(a)) return null;
  const r = local ? await env.ASSETS.fetch(new Request(new URL(`/e2e/fixtures/data/${a}.json`, url), { method: 'GET' }))
    : await fetch(UPSTREAM + a + '.json', /** @type {any} */ ({ cf: { cacheTtl: 300, cacheEverything: true } }));
  return r.ok ? r.json() : null;
};

export const fileRoute = {
  /** @param {URL} url */
  match: url => url.pathname === '/api/file',
  /** @param {Request} request @param {any} env @param {{ url: URL, local: boolean, project: string }} ctx */
  handle(request, env, { url, local, project }) {
    const emulator = !!(local && env.EMULATOR);
    return handleFile(request, {
      verify: (/** @type {string} */ t) => verifyIdToken(t, { project, emulator }),
      ask: env.ANTHROPIC_API_KEY ? anthropic(env) : null,
      area: areaReader(env, url, local),
      local,
    });
  },
};
