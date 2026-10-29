// The Add tab's "Draft on a topic" mode: POST /api/draft { topic, topics, model? } -> { items: [{ topic, section, line, isNew,
// title?, drafted: true, action }], model, usage }. Same door as worker/file.js (sign-in, owner check, ANTHROPIC_API_KEY,
// model mapping). Here the model writes the lines itself, so they are NOT his facts: every item is marked drafted, the page
// shows a warned card with no Confirm all, and Confirm queues it with a q of "model-drafted" so the notes' processor can
// tell. Drafts go through file.js's reconcile too, but only to drop lines already there: a draft is never offered as a
// merge or correction of his lines (action is "new" or "duplicate"). Nothing is saved here. Local (the tests): one canned item.
import { verifyIdToken } from './claims.js';
import { AREAS, Refused, addUsage, anthropic, areaReader, cleanTopics, filing, gate, json, modelId, parseList, reconcile, topicReader } from './file.js';

export const MAX_TOPIC = 200, MAX_DRAFT = 20, MAX_TOKENS = 6000;

/** @param {[string, string, string[]][]} topics  -> the system block (cached, like pass 1's) */
export function draftPrompt(topics) {
  const list = topics.map(([id, title, sections]) => `${id} | ${title} | ${sections.join('; ')}`).join('\n');
  return [
    'You draft candidate lines for a set of anaesthesia notes on a topic the owner names. They are your own draft, not his facts: he will check each one before it is used.',
    `Write at most ${MAX_DRAFT} short, well-established lines, standard textbook-level only. Leave out anything you are unsure of, any figure you are not sure of, and local protocols.`,
    'Reply with one JSON object only, no other text: {"items":[{"topic":"<area>/<slug>","title":"<topic title, only if the topic is new>","section":"<section title>","line":"<the fact as one bullet>"}]}.',
    'Topic: choose the best existing topic id from the list. Only if none fits, make a new one: area one of ' + AREAS.join(', ') + ', slug in kebab-case, and give its title. All lines use the same id.',
    'Section: an existing section of that topic if one fits, else a short new one written out in full. Drug sections come in the order Presentation, Administration, Dosage, Mechanism of action, Effects, Adverse effects, Contraindications, Indications, Pharmacokinetics.',
    'Line: house style is a short plain bullet in plain words, no arrows or symbols for up and down (write "increases", "falls"), no leading dash.',
    '', 'Topics (id | title | sections):', list || '(none yet)',
  ].join('\n');
}

/** the model's reply -> checked items, each marked drafted
 * @param {string} reply @param {Set<string>} known */
export function draftFilings(reply, known) {
  const out = [];
  for (const it of parseList(reply, 'items').list.slice(0, MAX_DRAFT)) {
    const line = String(it?.line || '').trim().replace(/^[-•*]\s*/, '');
    const f = line ? filing(it, line, known) : null;
    if (f) out.push({ ...f, drafted: true });
  }
  return out;
}

/** @param {Request} request @param {any} deps  { verify, ask, area, local } like handleFile */
export async function handleDraft(request, { verify, ask, area, local = false }) {
  const g = await gate(request, verify);
  if (g.fail) return g.fail;
  const topic = String(g.body?.topic || '').trim();
  if (!topic) return json({ error: 'Name a topic first.' }, 400);
  if (topic.length > MAX_TOPIC) return json({ error: 'Too long: name the topic in a line.' }, 400);
  const topics = cleanTopics(g.body?.topics);
  if (local) return json({ items: [{ topic: topics[0]?.[0] || 'drugs/demo-drug', section: 'Notes', line: `Drafted line about ${topic}`, isNew: false, drafted: true, action: 'new' }] });
  if (!ask) return json({ error: 'Drafting isn’t set up yet: the Worker needs its ANTHROPIC_API_KEY secret.' }, 503);
  const model = modelId(g.body?.model);
  try {
    const r = await ask(model, { system: draftPrompt(topics), user: `The topic to draft: ${topic}`, cache: true, maxTokens: MAX_TOKENS });
    const items = draftFilings(r.text, new Set(topics.map((/** @type {any[]} */ t) => t[0])));
    if (!items.length) {
      console.error('draft: reply not usable', r.stop, String(r.text).slice(0, 300));
      return json({ error: 'Couldn’t draft anything for that. Try naming it differently.' }, 502);
    }
    const rec = await reconcile(items, topicReader(area), ask, model);
    // a draft only ever adds: a "merge" or "correct" of his line stays a plain new line
    const out = rec.items.map((/** @type {any} */ it, /** @type {number} */ i) => it.action === 'duplicate' ? it : { ...items[i], action: 'new' });
    const usage = addUsage(rec.usage, r.usage);
    console.log('draft usage', model, JSON.stringify(usage));
    return json({ items: out, model: g.body?.model === 'sonnet' ? 'sonnet' : 'haiku', usage });
  } catch (e) {
    if (e instanceof Refused) return json({ error: 'The model declined that one. Try naming it differently.' }, 502);
    console.error('draft failed', /** @type {any} */ (e)?.message);
    return json({ error: 'Couldn’t reach the drafting service. Try again.' }, 502);
  }
}

export const draftRoute = {
  /** @param {URL} url */
  match: url => url.pathname === '/api/draft',
  /** @param {Request} request @param {any} env @param {{ url: URL, local: boolean, project: string }} ctx */
  handle(request, env, { url, local, project }) {
    const emulator = !!(local && env.EMULATOR);
    return handleDraft(request, {
      verify: (/** @type {string} */ t) => verifyIdToken(t, { project, emulator }),
      ask: env.ANTHROPIC_API_KEY ? anthropic(env) : null,
      area: areaReader(env, url, local),
      local,
    });
  },
};
