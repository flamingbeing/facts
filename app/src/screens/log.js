// The Log tab (#log-page): (1) his own Align, Test and Add answers, newest first, with the filter "Changes only" (the
// answers that ask for a change to the notes, worker/flush.js ACTION) or "All"; (2) the owner only: the notes' queue for
// the last 14 days (GET /api/queue), each item queued, done (a link to the pull request when there is one) or held (why).
// The queue text is private: it comes from the Worker for the owner's sign-in, is drawn here and is kept nowhere.
// A tap on a row (a button: the keyboard too) opens its details (#log-detail): the line, its topic and section, the
// answer and when, and whether it has gone to the notes. Edit opens the fix sheet (#fix, as on Align): an answer not
// sent yet is changed in place (the same doc: the next flush takes the new text); one already sent queues a new 'edit'
// with the line it replaces (old), since the queue's copy cannot be changed. Undo is only for an answer not sent yet:
// it is saved as 'seen', which the flush skips, so it never reaches the queue. Sent: the owner's queue has it (the
// same fact and time); the queue is read again before the sheet opens. Every write is a verdict (app.verdict, the
// sync module's write queue); the owner's go to the queue a little later (app.flush), as on Align.
import { toaster } from '@core/ui';
import { loadData } from '../data.js';
import { cardsFrom, plain, WRONG } from '../cards.js';
import { el } from '../ask.js';
import { $, input, dialog } from '../dom.js';
import { REFUSED } from '../state.js';

/** @typedef {import('../cards.js').Verdict} Verdict */
/** @typedef {{ fact: string, choice: string, at: number, text?: string, section?: string, status: 'queued' | 'done' | 'held', pr?: string, note?: string, why?: string }} QueueItem */

// the answers that ask for a change (the queue's ACTION list)
const CHANGES = ['repo-wrong', 'edit', 'also-true', 'bad-question', 'accept-fix', 'keep', 'add', 'flag'];
const SAID = /** @type {Record<string, string>} */ ({
  agree: 'Agree', 'repo-wrong': 'Notes wrong', 'me-wrong': 'I was wrong', 'also-true': 'Other option also true', 'bad-question': 'Bad question',
  edit: 'Edit', seen: 'Seen', 'accept-fix': 'Accept fix', keep: 'Keep as written', add: 'Added', flag: 'Marked wrong',
});
const STATUS = /** @type {Record<string, string>} */ ({ queued: 'Queued', done: 'Done', held: 'Held' });
const LIMIT = 100;   // rows drawn in the list
const FLUSH_AFTER = 15000;
// the answers whose text is the line he wants: an edit in place keeps them (the others become an 'edit')
const TEXTS = ['repo-wrong', 'edit', 'add', 'flag'];

/** @param {number} at -> 'Thu 29 Oct, 14:05' in Singapore time */
const when = at => new Date(at).toLocaleString('en-SG', { timeZone: 'Asia/Singapore', weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false });

/**
 * @param {{ queue: () => Promise<QueueItem[] | null>, flush: () => Promise<string>,
 *   verdict: (fact: string, choice: string, text: string, base: Verdict | null, q?: string, section?: string, change?: { old?: string, why?: string }) => Promise<string> }} app
 * @returns {{ state: (s: import('../state.js').State) => void, verdicts: (list: Verdict[]) => void }}
 */
export function logScreen(app) {
  /** @type {Verdict[]} */
  let mine = [];
  /** @type {QueueItem[] | null} */
  let items = null;
  /** @type {Map<string, import('../cards.js').Fact>} line id -> the line, from the notes */
  const lines = new Map();
  /** @type {Map<string, string>} topic id -> its title */
  const topics = new Map();
  let all = false, owner = false, ready = false, loaded = false, seen = false, canWrite = false;   // seen: the tab has been opened (nothing is drawn before, so Align's gestures never wait on it)

  /** @param {string} fact @param {string} [text] -> what to call the thing answered */
  const label = (fact, text) => {
    if (text) return plain(text);
    const id = fact.startsWith(WRONG) ? fact.slice(WRONG.length) : fact;
    const l = lines.get(id);
    return l ? plain(l.text) : fact.startsWith('flag:') ? `Flag ${fact.slice(5)}` : id;
  };

  /** @param {string} fact @param {string} [section] -> 'Topic title · Section' (the line's own, else the answer's) */
  const where = (fact, section) => {
    const id = fact.replace(/^(wrong|add|edit):/, '').replace(/@\d+$/, '');
    const l = lines.get(id), topic = l?.topic ?? id.split('#')[0];
    return [l?.title ?? topics.get(topic) ?? (fact.startsWith('flag:') ? '' : topic), section || l?.section || ''].filter(Boolean).join(' · ');
  };

  /** @param {string} fact @param {string} choice @param {number} at @param {string} [text] @param {string} [section] @param {() => void} [opens] */
  const row = (fact, choice, at, text, section, opens) => {
    const li = el('li', 'log-row');
    li.dataset.choice = choice;
    const b = /** @type {HTMLButtonElement} */ (el('button', 'log-open'));
    b.type = 'button';
    b.append(el('span', 'log-line', label(fact, text)), el('span', 'small log-meta', `${SAID[choice] ?? choice}${section ? ` · ${section}` : ''} · ${when(at)}`));
    if (opens) b.addEventListener('click', opens);
    li.append(b);
    return li;
  };

  const drawVerdicts = () => {
    if (!seen) return;
    const rows = mine.filter(v => all || CHANGES.includes(v.choice)).sort((a, b) => b.at - a.at);
    $('log-answers').replaceChildren(...rows.slice(0, LIMIT).map(v => row(v.fact, v.choice, v.at, v.text, v.section, () => void details({ mine: v }))));
    $('log-answers-empty').hidden = !!rows.length;
  };

  const drawQueue = () => {
    $('log-queue-block').hidden = !owner;
    if (!owner) { $('log-queue').replaceChildren(); return; }
    $('log-queue-empty').hidden = !items || !!items.length;
    $('log-queue-status').textContent = items ? '' : 'Loading…';
    $('log-queue').replaceChildren(...(items || []).map(i => {
      const li = row(i.fact, i.choice, i.at, i.text, i.section, () => void details({ sent: i }));
      li.dataset.status = i.status;
      const s = el('p', 'small log-status');
      s.append(el('span', 'log-badge', STATUS[i.status] ?? i.status));
      if (i.status === 'held' && i.why) s.append(` ${i.why}`);
      if (i.status === 'done' && i.note) s.append(` ${i.note}`);
      if (i.status === 'done' && i.pr) {
        const a = /** @type {HTMLAnchorElement} */ (el('a', '', ' Pull request'));
        a.href = i.pr; a.target = '_blank'; a.rel = 'noopener';
        s.append(a);
      }
      li.append(s);
      return li;
    }));
  };

  const draw = () => { drawVerdicts(); drawQueue(); };

  // the notes' lines name the answers that carry no text; fetched the first time the tab is opened
  const open = () => {
    if (!ready) return;
    seen = true;
    drawVerdicts();
    if (!loaded) {
      loaded = true;
      void loadData(files => {
        lines.clear(); topics.clear();
        for (const l of cardsFrom(files)) { lines.set(l.id, l); topics.set(l.topic, l.title); }
        draw();
      }).catch(() => { loaded = false; });
    }
    if (owner) void app.queue().then(q => { if (q) { items = q; drawQueue(); } else if (!items) $('log-queue-status').textContent = 'Couldn’t load the queue. Open the tab again.'; });
  };
  document.querySelectorAll('[data-tab-page="#log-page"]').forEach(t => t.addEventListener('click', open));

  // the details sheet: one of his answers (mine) or one of the queue's items (sent)
  const toasts = toaster($('toasts'));
  const sheet = dialog('log-detail'), fix = dialog('fix');
  /** @type {{ mine?: Verdict, sent?: QueueItem, gone: boolean } | null} */
  let open1 = null;
  /** @type {{ fact: string, choice: string, base: Verdict | null, old: string, section: string, q: string, keep?: { old?: string, why?: string } } | null} */
  let fixing = null;

  /** @param {Verdict} v -> the queue has it (the same fact and time) */
  const isSent = v => !!items?.some(i => i.fact === v.fact && i.at === v.at);

  /** @param {{ mine?: Verdict, sent?: QueueItem }} what */
  const details = async what => {
    const v = what.mine, i = what.sent;
    if (v && owner && CHANGES.includes(v.choice)) { const q = await app.queue(); if (q) { items = q; drawQueue(); } }   // fresh: has it gone since?
    const it = /** @type {Verdict | QueueItem} */ (v ?? i);
    const gone = !!i || (!!v && isSent(v));
    open1 = { ...what, gone };
    $('log-detail-text').textContent = label(it.fact, it.text);
    $('log-detail-where').textContent = where(it.fact, it.section);
    $('log-detail-said').textContent = `${SAID[it.choice] ?? it.choice} · ${when(it.at)}`;
    $('log-detail-status').textContent = i ? `Sent to the notes · ${STATUS[i.status] ?? i.status}${i.status === 'held' && i.why ? `: ${i.why}` : ''}`
      : gone ? 'Sent to the notes' : !CHANGES.includes(it.choice) ? 'Asks for no change to the notes'
      : owner ? 'Queued: not sent to the notes yet' : 'Kept with your answers (only the owner’s go to the notes)';
    $('log-detail-edit').hidden = !canWrite;
    $('log-detail-undo').hidden = !canWrite || gone || !CHANGES.includes(it.choice);
    sheet.returnValue = '';   // Escape or the back gesture closes it with the last value
    sheet.showModal();
  };

  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let flushTimer;
  /** @param {Promise<string>} saved @param {string} done */
  const wrote = async (saved, done) => {
    if (await saved) { toasts.show(REFUSED); return; }
    toasts.show(done);
    if (owner) { clearTimeout(flushTimer); flushTimer = setTimeout(() => void app.flush(), FLUSH_AFTER); }
  };

  sheet.addEventListener('close', () => {
    const o = open1; open1 = null;
    if (!o || !canWrite) return;
    const v = o.mine, i = o.sent, it = /** @type {Verdict | QueueItem} */ (v ?? i);
    // the doc this answer is: his own (mine) or, for a queue item, his answer on that fact if this device has it
    const base = v ?? mine.find(m => m.fact === it.fact) ?? null;
    if (sheet.returnValue === 'undo' && v && !o.gone) { void wrote(app.verdict(v.fact, 'seen', '', base, '', v.section ?? ''), 'Undone: it won’t go to the notes'); return; }
    if (sheet.returnValue !== 'edit') return;
    const text = label(it.fact, it.text);
    // sent: a new 'edit' of the line (a Test tab flag names it as wrong:<line>; the edit is of the line itself)
    fixing = o.gone ? { fact: it.fact.replace(/^wrong:/, ''), choice: 'edit', base: null, old: text, section: it.section ?? '', q: '' }
      : { fact: it.fact, choice: TEXTS.includes(it.choice) ? it.choice : 'edit', base, old: '', section: it.section ?? '', q: v?.q ?? '', keep: { old: /** @type {any} */ (v)?.old, why: /** @type {any} */ (v)?.why } };
    if (o.gone) fixing.base = mine.find(m => m.fact === fixing?.fact) ?? null;
    $('fix-title').textContent = 'Edit the line';
    $('fix-where').textContent = where(it.fact, it.section);
    input('fix-text').value = text;
    fix.returnValue = '';
    fix.showModal();
  });
  fix.addEventListener('close', () => {
    const f = fixing; fixing = null;
    const text = input('fix-text').value.trim();
    if (!f || fix.returnValue !== 'save' || !text) return;
    // an Add tab change edited in place keeps the line it replaces and why
    const change = f.old ? { old: f.old, why: 'edited from the Log' } : f.keep ?? {};
    void wrote(app.verdict(f.fact, f.choice, text, f.base, f.q, f.section, change), 'Saved');
  });

  for (const b of document.querySelectorAll('#log-filter button')) {
    b.addEventListener('click', () => {
      all = /** @type {HTMLElement} */ (b).dataset.filter === 'all';
      for (const c of document.querySelectorAll('#log-filter button')) c.setAttribute('aria-pressed', String(c === b));
      drawVerdicts();
    });
  }

  return {
    state(s) {
      ready = s.phase === 'ready';
      const was = owner;
      owner = ready && s.role === 'admin';
      canWrite = ready && (s.role === 'admin' || s.role === 'member');
      for (const id of ['tab-log', 'side-log']) $(id).hidden = !ready;
      if (!ready) { mine = []; items = null; loaded = false; seen = false; }
      if (owner !== was) { if (!owner) items = null; drawQueue(); }
    },
    verdicts(list) { mine = list; drawVerdicts(); },
  };
}
