// The Add tab's "Draft on a topic" mode: POST /api/draft { topic, topics, model? } -> { items: [{ topic, section, line, isNew,
// title?, drafted: true }] }. Same door as worker/file.js (sign-in, owner check, ANTHROPIC_API_KEY). Here the model writes
// the lines itself, so they are NOT his facts: every item is marked drafted, the page shows a warned card with no Confirm
// all, and Confirm queues it with a q of "model-drafted" so the notes' processor can tell. Nothing is saved here.
// Local (the tests): one canned item.
import { verifyIdToken } from './claims.js';
import { AREAS, anthropic, cleanTopics, filing, gate, json, pickModel } from './file.js';
import { parseItems } from './file-many.js';

export const MAX_TOPIC = 200, MAX_DRAFT = 20, MAX_TOKENS = 6000;

/** @param {string} topic @param {[string, string, string[]][]} topics */
export function draftPrompt(topic, topics) {
  const list = topics.map(([id, title, sections]) => `${id} | ${title} | ${sections.join('; ')}`).join('\n');
  return [
    'You draft candidate lines for a set of anaesthesia notes on a topic the owner names. They are your own draft, not his facts: he will check each one before it is used.',
    `Write at most ${MAX_DRAFT} short, well-established lines, standard textbook-level only. Leave out anything you are unsure of, any figure you are not sure of, and local protocols.`,
    'Reply with one JSON object only, no other text: {"items":[{"topic":"<area>/<slug>","title":"<topic title, only if the topic is new>","section":"<section title>","line":"<the fact as one bullet>"}]}.',
    'Topic: choose the best existing topic id from the list. Only if none fits, make a new one: area one of ' + AREAS.join(', ') + ', slug in kebab-case, and give its title. All lines use the same id.',
    'Section: an existing section of that topic if one fits, else a short new one written out in full. Drug sections come in the order Presentation, Administration, Dosage, Mechanism of action, Effects, Adverse effects, Contraindications, Indications, Pharmacokinetics.',
    'Line: house style is a short plain bullet in plain words, no arrows or symbols for up and down (write "increases", "falls"), no leading dash.',
    '', 'Topics (id | title | sections):', list || '(none yet)', '', 'The topic to draft:', topic,
  ].join('\n');
}

/** the model's reply -> checked items, each marked drafted
 * @param {string} reply @param {Set<string>} known */
export function draftFilings(reply, known) {
  const out = [];
  for (const it of parseItems(reply).items.slice(0, MAX_DRAFT)) {
    const line = String(it?.line || '').trim().replace(/^[-•*]\s*/, '');
    const f = line ? filing(JSON.stringify(it), line, known) : null;
    if (f) out.push({ ...f, drafted: true });
  }
  return out;
}

/** @param {Request} request @param {any} deps  { verify, ask, local } like handleFile */
export async function handleDraft(request, { verify, ask, local = false }) {
  const g = await gate(request, verify);
  if (g.fail) return g.fail;
  const topic = String(g.body?.topic || '').trim();
  if (!topic) return json({ error: 'Name a topic first.' }, 400);
  if (topic.length > MAX_TOPIC) return json({ error: 'Too long: name the topic in a line.' }, 400);
  const topics = cleanTopics(g.body?.topics);
  if (local) return json({ items: [{ topic: topics[0]?.[0] || 'drugs/demo-drug', section: 'Notes', line: `Drafted line about ${topic}`, isNew: false, drafted: true }] });
  if (!ask) return json({ error: 'Drafting isn’t set up yet: the Worker needs its ANTHROPIC_API_KEY secret.' }, 503);
  try {
    const reply = await ask(draftPrompt(topic, topics), pickModel(g.body?.model));
    const items = draftFilings(reply, new Set(topics.map((/** @type {any[]} */ t) => t[0])));
    if (!items.length) console.error('draft: reply not usable', String(reply).slice(0, 300));
    return items.length ? json({ items }) : json({ error: 'Couldn’t draft anything for that. Try naming it differently.' }, 502);
  } catch (e) {
    console.error('draft failed', /** @type {any} */ (e)?.message);
    return json({ error: 'Couldn’t reach the drafting service. Try again.' }, 502);
  }
}

export const draftRoute = {
  /** @param {URL} url */
  match: url => url.pathname === '/api/draft',
  /** @param {Request} request @param {any} env @param {{ url: URL, local: boolean, project: string }} ctx */
  handle(request, env, { local, project }) {
    const emulator = !!(local && env.EMULATOR);
    return handleDraft(request, {
      verify: (/** @type {string} */ t) => verifyIdToken(t, { project, emulator }),
      ask: env.ANTHROPIC_API_KEY ? anthropic(env, MAX_TOKENS) : null,
      local,
    });
  },
};
