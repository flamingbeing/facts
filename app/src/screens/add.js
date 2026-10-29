// The Add tab (owner only): he types a fact in plain words; the Worker (worker/file.js, Claude Sonnet) files it: topic,
// section and the line in house style. A confirm card shows the three, editable; Confirm saves a verdict 'add' (fact
// 'add:<area>/<slug>#<time>', text = the line, section) and flushes it to the notes' queue, Discard clears the card.
// "Paste notes" mode: a whole topic or info dump goes to /api/file-many (worker/file-many.js), which splits it into lines;
// each becomes its own confirm card (edit, Confirm, Discard), plus Confirm all / Discard all. Each Confirm queues one 'add'
// verdict exactly as above.
// The topic list comes from the same data Align shows (data.js, kept on this device).
import { toaster } from '@core/ui';
import { loadData } from '../data.js';
import { AREAS } from '../cards.js';
import { $, input } from '../dom.js';

const TOPIC = /^[a-z][a-z]*\/[a-z][a-z0-9-]{0,60}$/;

/**
 * @param {{ verdict: (fact: string, choice: string, text: string, base: null, q?: string, section?: string) => Promise<string>,
 *   flush: () => Promise<string>, file: (text: string, topics: [string, string, string[]][]) => Promise<{ filing?: any, error?: string }>,
 *   fileMany: (text: string, topics: [string, string, string[]][]) => Promise<{ many?: { items: any[], cut: boolean, skipped: number }, error?: string }> }} app
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
  const sections = (topic = input('add-topic').value) => {
    $('add-sections').replaceChildren(...(topics.get(topic.trim())?.sections || []).map(s => Object.assign(document.createElement('option'), { value: s })));
  };
  let seq = 0;
  /** queue one 'add' verdict -> '' or why not
   * @param {string} topic @param {string} section @param {string} line */
  const queue = async (topic, section, line) => {
    topic = topic.trim().toLowerCase(); section = section.trim(); line = line.trim();
    if (!TOPIC.test(topic) || !AREAS.includes(topic.split('/')[0])) return 'Topic must look like area/name, e.g. drugs/dobutamine.';
    if (!section || !line) return 'Section and line are needed.';
    return app.verdict(`add:${topic}#${Date.now().toString(36)}${(seq++).toString(36)}`, 'add', line, null, '', section);
  };
  let many = false;
  const status = (/** @type {string} */ m) => { $('add-status').textContent = m; };
  const clear = () => { $('add-card').hidden = true; input('add-line').value = ''; status(''); };

  document.querySelectorAll('[data-tab-page="#add-page"]').forEach(el => el.addEventListener('click', load));
  input('add-topic').addEventListener('input', () => sections());

  $('add-file').addEventListener('click', async () => {
    const text = input('add-text').value.trim();
    if (!text) return status(many ? 'Paste some notes first.' : 'Type a fact first.');
    load();
    status('Filing…'); $('add-file').toggleAttribute('disabled', true);
    const list = /** @type {[string, string, string[]][]} */ ([...topics].map(([id, t]) => [id, t.title, t.sections]));
    if (many) {
      const m = await app.fileMany(text, list);
      $('add-file').toggleAttribute('disabled', false);
      if (!m.many) return status(m.error || 'Couldn’t file those.');
      $('add-cards').replaceChildren(...m.many.items.map(card));
      stack();
      const bits = [`${m.many.items.length} to check.`];
      if (m.many.cut) bits.push('Your paste was cut: only the first lines were filed; paste the rest again after these.');
      if (m.many.skipped) bits.push(`${m.many.skipped} couldn’t be placed; they’re still in the box.`);
      return status(bits.join(' '));
    }
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

  const stack = () => { $('add-stack').hidden = !many || !$('add-cards').children.length; };
  /** one confirm card of the stack: editable topic, section and line; Confirm queues it, Discard drops it
   * @param {{ topic: string, section: string, line: string, isNew?: boolean, title?: string }} f */
  function card(f) {
    const el = document.createElement('div');
    el.className = 'add-card';
    const field = (/** @type {string} */ label, /** @type {HTMLElement} */ control) => {
      const l = document.createElement('label'); l.textContent = label; el.append(l, control); return control;
    };
    if (f.isNew) { const p = document.createElement('p'); p.className = 'small'; p.textContent = `New topic${f.title ? `: ${f.title}` : ''}`; el.append(p); }
    const t = /** @type {HTMLInputElement} */ (field('Topic', Object.assign(document.createElement('input'), { type: 'text', value: f.topic, autocomplete: 'off', autocapitalize: 'none', spellcheck: false })));
    t.setAttribute('list', 'add-topics'); t.className = 'add-c-topic';
    const sc = /** @type {HTMLInputElement} */ (field('Section', Object.assign(document.createElement('input'), { type: 'text', value: f.section, autocomplete: 'off', maxLength: 60 })));
    sc.setAttribute('list', 'add-sections'); sc.className = 'add-c-section';
    sc.addEventListener('focus', () => sections(t.value));
    const ln = /** @type {HTMLTextAreaElement} */ (field('The line', Object.assign(document.createElement('textarea'), { rows: 3, value: f.line, maxLength: 500 })));
    ln.className = 'add-c-line';
    const msg = document.createElement('p'); msg.className = 'small'; msg.setAttribute('role', 'status');
    const row = document.createElement('div'); row.className = 'row';
    const ok = Object.assign(document.createElement('button'), { type: 'button', textContent: 'Confirm' }); ok.className = 'add-c-confirm';
    const no = Object.assign(document.createElement('button'), { type: 'button', textContent: 'Discard' }); no.className = 'add-c-discard';
    row.append(ok, no); el.append(msg, row);
    /** @returns {Promise<boolean>} queued */
    const send = async () => {
      el.classList.add('is-working'); ok.disabled = true;
      const why = await queue(t.value, sc.value, ln.value);
      el.classList.remove('is-working'); ok.disabled = false;
      msg.textContent = why;
      if (!why) { el.remove(); stack(); }
      return !why;
    };
    /** @type {any} */ (el).send = send;
    ok.addEventListener('click', async () => {
      if (await send()) { await app.flush(); toast.show('Queued for the notes.'); if (!$('add-cards').children.length) status(''); }
    });
    no.addEventListener('click', () => { el.remove(); stack(); });
    return el;
  }
  $('add-confirm-all').addEventListener('click', async () => {
    const cards = [...$('add-cards').children];
    $('add-confirm-all').toggleAttribute('disabled', true);
    let n = 0;
    for (const c of cards) if (await /** @type {any} */ (c).send()) n++;
    if (n) await app.flush();
    $('add-confirm-all').toggleAttribute('disabled', false);
    const left = $('add-cards').children.length;
    status(left ? `${left} need a fix before they can be queued.` : '');
    if (n) toast.show(`${n} queued for the notes.`);
  });
  $('add-discard-all').addEventListener('click', () => { $('add-cards').replaceChildren(); stack(); status(''); });
  $('add-mode').addEventListener('click', () => {
    many = !many;
    $('add-mode').setAttribute('aria-pressed', String(many));
    $('add-mode').textContent = many ? 'One fact' : 'Paste notes';
    $('add-text-label').textContent = many ? 'Your notes, pasted' : 'A fact, in your own words';
    const box = /** @type {HTMLTextAreaElement} */ (/** @type {unknown} */ (input('add-text')));
    box.rows = many ? 12 : 4; box.maxLength = many ? 12000 : 1000;
    box.placeholder = many ? 'Paste a whole topic or a dump of lines; each becomes its own card' : 'e.g. Dobutamine can be given peripherally for a short time';
    $('add-file').textContent = many ? 'File them' : 'File it';
    if (many) clear();
    status(''); stack();
  });

  $('add-discard').addEventListener('click', clear);
  $('add-confirm').addEventListener('click', async () => {
    $('add-confirm').toggleAttribute('disabled', true);
    const why = await queue(input('add-topic').value, input('add-section').value, input('add-line').value);
    if (why) { $('add-confirm').toggleAttribute('disabled', false); return status(why); }
    const sent = await app.flush();
    $('add-confirm').toggleAttribute('disabled', false);
    input('add-text').value = '';
    clear();
    toast.show(sent ? 'Saved here; it reaches the notes at the next send.' : 'Queued for the notes.');
  });

  return { owner(yes) { for (const id of ['tab-add', 'side-add']) $(id).hidden = !yes; if (!yes) { clear(); $('add-cards').replaceChildren(); stack(); } } };
}
