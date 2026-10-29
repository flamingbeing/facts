// The Add tab (owner only): he types a fact in plain words; the Worker (worker/file.js, Claude Sonnet) files it: topic,
// section and the line in house style. A confirm card shows the three, editable; Confirm saves a verdict 'add' (fact
// 'add:<area>/<slug>#<time>', text = the line, section) and flushes it to the notes' queue, Discard clears the card.
// The topic list comes from the same data Align shows (data.js, kept on this device).
import { toaster } from '@core/ui';
import { loadData } from '../data.js';
import { AREAS } from '../cards.js';
import { $, input } from '../dom.js';

const TOPIC = /^[a-z][a-z]*\/[a-z][a-z0-9-]{0,60}$/;

/**
 * @param {{ verdict: (fact: string, choice: string, text: string, base: null, q?: string, section?: string) => Promise<string>,
 *   flush: () => Promise<string>, file: (text: string, topics: [string, string, string[]][]) => Promise<{ filing?: any, error?: string }> }} app
 * @returns {{ owner: (yes: boolean) => void }}
 */
export function addScreen(app) {
  const toast = toaster($('toasts'));
  /** @type {Map<string, { title: string, sections: string[] }>} topic id -> its title and sections */
  const topics = new Map();
  let loaded = false;
  const load = () => {
    if (loaded) return;
    loaded = true;
    void loadData(files => {
      topics.clear();
      for (const f of files) for (const t of f.topics || []) topics.set(`${f.area}/${t.k}`, { title: t.t, sections: [...new Set((t.f || []).map(x => x[1]))] });
      $('add-topics').replaceChildren(...[...topics.keys()].map(k => Object.assign(document.createElement('option'), { value: k })));
    }).catch(() => { loaded = false; });
  };
  const sections = () => {
    $('add-sections').replaceChildren(...(topics.get(input('add-topic').value.trim())?.sections || []).map(s => Object.assign(document.createElement('option'), { value: s })));
  };
  const status = (/** @type {string} */ m) => { $('add-status').textContent = m; };
  const clear = () => { $('add-card').hidden = true; input('add-line').value = ''; status(''); };

  document.querySelectorAll('[data-tab-page="#add-page"]').forEach(el => el.addEventListener('click', load));
  input('add-topic').addEventListener('input', sections);

  $('add-file').addEventListener('click', async () => {
    const text = input('add-text').value.trim();
    if (!text) return status('Type a fact first.');
    load();
    status('Filing…'); $('add-file').toggleAttribute('disabled', true);
    const list = /** @type {[string, string, string[]][]} */ ([...topics].map(([id, t]) => [id, t.title, t.sections]));
    const r = await app.file(text, list);
    $('add-file').toggleAttribute('disabled', false);
    if (!r.filing) return status(r.error || 'Couldn’t file that one.');
    const f = r.filing;
    input('add-topic').value = f.topic; sections();
    input('add-section').value = f.section;
    input('add-line').value = f.line;
    $('add-new').hidden = !f.isNew;
    $('add-new').textContent = f.isNew ? `New topic${f.title ? `: ${f.title}` : ''}` : '';
    $('add-card').hidden = false; status('');
  });

  $('add-discard').addEventListener('click', clear);
  $('add-confirm').addEventListener('click', async () => {
    const topic = input('add-topic').value.trim().toLowerCase(), section = input('add-section').value.trim(), line = input('add-line').value.trim();
    if (!TOPIC.test(topic) || !AREAS.includes(topic.split('/')[0])) return status('Topic must look like area/name, e.g. drugs/dobutamine.');
    if (!section || !line) return status('Section and line are needed.');
    $('add-confirm').toggleAttribute('disabled', true);
    const why = await app.verdict(`add:${topic}#${Date.now().toString(36)}`, 'add', line, null, '', section);
    if (why) { $('add-confirm').toggleAttribute('disabled', false); return status(why); }
    const sent = await app.flush();
    $('add-confirm').toggleAttribute('disabled', false);
    input('add-text').value = '';
    clear();
    toast.show(sent ? 'Saved here; it reaches the notes at the next send.' : 'Queued for the notes.');
  });

  return { owner(yes) { for (const id of ['tab-add', 'side-add']) $(id).hidden = !yes; if (!yes) clear(); } };
}
