// The Add tab (owner only): one box for one fact or a whole pasted dump. The Worker (worker/file.js) splits it into
// one-line items, files each (topic, section, the line in house style) and checks each against the topic's existing
// lines. Every fact comes back as a card by what it is:
//   new        editable topic, section and line; Confirm saves a verdict 'add' (fact 'add:<area>/<slug>#<time>')
//   merge      adds detail to an existing line: the old line, the merged line (editable); Confirm saves an 'edit'
//   correct    contradicts an existing line: the old line, the replacement (editable) and why; Confirm saves an 'edit'
//   duplicate  already in the notes: set aside, collapsed under "N already there", each with "Add anyway"
// An 'edit' verdict is fact 'edit:<area>/<slug>#<line id>@<time>', text = the new line, section = the old line's, old and
// why. A change to a line always needs his tap (Confirm, or Confirm all, whose label then says it includes changes).
// Each Confirm flushes to the notes' queue. Model: Haiku by default; the toggle picks Sonnet, remembered on this device.
// The topic list comes from the same data Align shows (data.js, kept on this device).
import { toaster } from '@core/ui';
import { loadData } from '../data.js';
import { AREAS } from '../cards.js';
import { $, input } from '../dom.js';

const TOPIC = /^[a-z][a-z]*\/[a-z][a-z0-9-]{0,60}$/;
const MODEL_KEY = 'add.model';

/** @typedef {{ topic: string, section: string, line: string, isNew?: boolean, title?: string, action?: string, old?: { id: string, section: string, line: string }, why?: string }} Item */

/**
 * @param {{ verdict: (fact: string, choice: string, text: string, base: null, q?: string, section?: string, change?: { old?: string, why?: string }) => Promise<string>,
 *   flush: () => Promise<string>,
 *   file: (text: string, topics: [string, string, string[]][], model: 'haiku' | 'sonnet') => Promise<{ result?: { items: Item[], cut: boolean, skipped: number }, error?: string }> }} app
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
  const sections = (/** @type {string} */ topic) => {
    $('add-sections').replaceChildren(...(topics.get(topic.trim())?.sections || []).map(s => Object.assign(document.createElement('option'), { value: s })));
  };

  /** @type {'haiku' | 'sonnet'} */
  let model = 'haiku';
  try { if (localStorage.getItem(MODEL_KEY) === 'sonnet') model = 'sonnet'; } catch { /* no storage: Haiku */ }
  const showModel = () => {
    $('add-model').setAttribute('aria-pressed', String(model === 'sonnet'));
    $('add-model').textContent = model === 'sonnet' ? 'Model: Sonnet' : 'Model: Haiku';
  };
  showModel();
  $('add-model').addEventListener('click', () => {
    model = model === 'sonnet' ? 'haiku' : 'sonnet';
    try { localStorage.setItem(MODEL_KEY, model); } catch { /* no storage: this visit only */ }
    showModel();
  });

  let seq = 0;
  const tag = () => `${Date.now().toString(36)}${(seq++).toString(36)}`;
  /** queue one 'add' verdict -> '' or why not
   * @param {string} topic @param {string} section @param {string} line */
  const add = async (topic, section, line) => {
    topic = topic.trim().toLowerCase(); section = section.trim(); line = line.trim();
    if (!TOPIC.test(topic) || !AREAS.includes(topic.split('/')[0])) return 'Topic must look like area/name, e.g. drugs/dobutamine.';
    if (!section || !line) return 'Section and line are needed.';
    return app.verdict(`add:${topic}#${tag()}`, 'add', line, null, '', section);
  };
  /** queue one 'edit' verdict (a merge or a correction of an existing line) -> '' or why not
   * @param {Item} f @param {string} line */
  const edit = async (f, line) => {
    line = line.trim();
    if (!line || !f.old) return 'The new line is needed.';
    if (!TOPIC.test(f.topic)) return 'Topic must look like area/name, e.g. drugs/dobutamine.';
    return app.verdict(`edit:${f.topic}#${f.old.id}@${tag()}`, 'edit', line, null, '', f.old.section, { old: f.old.line, why: f.why || (f.action === 'merge' ? 'Merged with a new fact.' : '') });
  };

  const status = (/** @type {string} */ m) => { $('add-status').textContent = m; };
  const isChange = (/** @type {Element} */ c) => c.classList.contains('is-change');
  /** the stack's buttons and the duplicates' summary, after any change */
  const stack = () => {
    const cards = [...$('add-cards').children], changes = cards.filter(isChange).length, dups = $('add-dup-list').children.length;
    $('add-stack').hidden = !cards.length && !dups;
    $('add-stack-actions').hidden = !cards.length;
    $('add-confirm-all').textContent = changes ? `Confirm all (incl. ${changes} change${changes > 1 ? 's' : ''})` : 'Confirm all';
    $('add-dups').hidden = !dups;
    $('add-dups-sum').textContent = `${dups} already there`;
  };
  const clear = () => { $('add-cards').replaceChildren(); $('add-dup-list').replaceChildren(); stack(); status(''); };

  document.querySelectorAll('[data-tab-page="#add-page"]').forEach(el => el.addEventListener('click', load));

  $('add-file').addEventListener('click', async () => {
    const text = input('add-text').value.trim();
    if (!text) return status('Type or paste a fact first.');
    load();
    status('Filing…'); $('add-file').toggleAttribute('disabled', true);
    const list = /** @type {[string, string, string[]][]} */ ([...topics].map(([id, t]) => [id, t.title, t.sections]));
    const r = await app.file(text, list, model);
    $('add-file').toggleAttribute('disabled', false);
    if (!r.result) return status(r.error || 'Couldn’t file that.');
    const items = r.result.items || [];
    const dups = items.filter(i => i.action === 'duplicate'), rest = items.filter(i => i.action !== 'duplicate');
    $('add-cards').replaceChildren(...rest.map(card));
    $('add-dup-list').replaceChildren(...dups.map(dupe));
    stack();
    const bits = [rest.length ? `${rest.length} to check.` : 'Nothing new.'];
    if (r.result.cut) bits.push('Your paste was cut: only the first lines were filed; paste the rest again after these.');
    if (r.result.skipped) bits.push(`${r.result.skipped} couldn’t be placed; they’re still in the box.`);
    status(bits.join(' '));
  });

  /** a small text line of a card */
  const note = (/** @type {string} */ cls, /** @type {string} */ text) => { const p = document.createElement('p'); p.className = `small ${cls}`; p.textContent = text; return p; };

  /** one card of the stack: a new line (editable topic, section, line) or a change to an existing one (the old line, the
   * new one editable, why); Confirm queues it, Discard drops it
   * @param {Item} f */
  function card(f) {
    const change = (f.action === 'merge' || f.action === 'correct') && !!f.old;
    const el = document.createElement('div');
    el.className = `add-card ${change ? 'is-change' : 'is-new'}`;
    el.dataset.action = change ? String(f.action) : 'new';
    const field = (/** @type {string} */ label, /** @type {HTMLElement} */ control) => {
      const l = document.createElement('label'); l.textContent = label; el.append(l, control); return control;
    };
    /** @type {HTMLInputElement | null} */ let t = null;
    /** @type {HTMLInputElement | null} */ let sc = null;
    if (change && f.old) {
      el.append(note('add-c-kind', f.action === 'merge' ? `Adds detail to a line in ${f.topic}` : `Corrects a line in ${f.topic}`));
      el.append(note('add-c-old', `Was: ${f.old.line}`));
      if (f.action === 'correct' && f.why) el.append(note('add-c-why', `Why: ${f.why}`));
    } else {
      if (f.isNew) el.append(note('add-c-kind', `New topic${f.title ? `: ${f.title}` : ''}`));
      t = /** @type {HTMLInputElement} */ (field('Topic', Object.assign(document.createElement('input'), { type: 'text', value: f.topic, autocomplete: 'off', autocapitalize: 'none', spellcheck: false })));
      t.setAttribute('list', 'add-topics'); t.className = 'add-c-topic';
      sc = /** @type {HTMLInputElement} */ (field('Section', Object.assign(document.createElement('input'), { type: 'text', value: f.section, autocomplete: 'off', maxLength: 60 })));
      sc.setAttribute('list', 'add-sections'); sc.className = 'add-c-section';
      const topic = t;
      sc.addEventListener('focus', () => sections(topic.value));
    }
    const ln = /** @type {HTMLTextAreaElement} */ (field(change ? 'New line' : 'The line', Object.assign(document.createElement('textarea'), { rows: 3, value: f.line, maxLength: 500 })));
    ln.className = 'add-c-line';
    const msg = document.createElement('p'); msg.className = 'small'; msg.setAttribute('role', 'status');
    const row = document.createElement('div'); row.className = 'row';
    const ok = Object.assign(document.createElement('button'), { type: 'button', textContent: change ? 'Confirm change' : 'Confirm' }); ok.className = 'add-c-confirm';
    const no = Object.assign(document.createElement('button'), { type: 'button', textContent: 'Discard' }); no.className = 'add-c-discard';
    row.append(ok, no); el.append(msg, row);
    /** @returns {Promise<boolean>} queued */
    const send = async () => {
      el.classList.add('is-working'); ok.disabled = true;
      const why = change ? await edit(f, ln.value) : await add(t?.value || '', sc?.value || '', ln.value);
      el.classList.remove('is-working'); ok.disabled = false;
      msg.textContent = why;
      if (!why) { el.remove(); stack(); }
      return !why;
    };
    /** @type {any} */ (el).send = send;
    ok.addEventListener('click', async () => {
      if (!await send()) return;
      const sent = await app.flush();
      toast.show(sent ? 'Saved here; it reaches the notes at the next send.' : 'Queued for the notes.');
      if (!$('add-cards').children.length) status('');
    });
    no.addEventListener('click', () => { el.remove(); stack(); });
    return el;
  }

  /** a fact already in the notes: set aside, nothing queued; "Add anyway" makes it a new card
   * @param {Item} f */
  function dupe(f) {
    const el = document.createElement('div');
    el.className = 'add-dup';
    el.append(note('add-d-line', f.line), note('add-d-old', `Already there: ${f.old?.line || ''}`));
    const again = Object.assign(document.createElement('button'), { type: 'button', textContent: 'Add anyway' }); again.className = 'add-d-add';
    again.addEventListener('click', () => {
      el.remove();
      $('add-cards').append(card({ topic: f.topic, section: f.section, line: f.line, isNew: false, action: 'new' }));
      stack();
    });
    el.append(again);
    return el;
  }

  $('add-confirm-all').addEventListener('click', async () => {
    const cards = [...$('add-cards').children];
    $('add-confirm-all').toggleAttribute('disabled', true);
    let n = 0;
    for (const c of cards) if (await /** @type {any} */ (c).send()) n++;
    const sent = n ? await app.flush() : '';
    $('add-confirm-all').toggleAttribute('disabled', false);
    const left = $('add-cards').children.length;
    status(left ? `${left} need a fix before they can be queued.` : '');
    if (n) toast.show(sent ? `${n} saved here; they reach the notes at the next send.` : `${n} queued for the notes.`);
  });
  $('add-discard-all').addEventListener('click', clear);

  return { owner(yes) { for (const id of ['tab-add', 'side-add']) $(id).hidden = !yes; if (!yes) clear(); } };
}
