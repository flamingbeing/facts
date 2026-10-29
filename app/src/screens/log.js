// The Log tab (#log-page): (1) his own Align, Test and Add answers, newest first, with the filter "Changes only" (the
// answers that ask for a change to the notes, worker/flush.js ACTION) or "All"; (2) the owner only: the notes' queue for
// the last 14 days (GET /api/queue), each item queued, done (a link to the pull request when there is one) or held (why).
// The queue text is private: it comes from the Worker for the owner's sign-in, is drawn here and is kept nowhere.
import { loadData } from '../data.js';
import { cardsFrom, plain, WRONG } from '../cards.js';
import { el } from '../ask.js';
import { $ } from '../dom.js';

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

/** @param {number} at -> 'Thu 29 Oct, 14:05' in Singapore time */
const when = at => new Date(at).toLocaleString('en-SG', { timeZone: 'Asia/Singapore', weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false });

/**
 * @param {{ queue: () => Promise<QueueItem[] | null> }} app
 * @returns {{ state: (s: import('../state.js').State) => void, verdicts: (list: Verdict[]) => void }}
 */
export function logScreen(app) {
  /** @type {Verdict[]} */
  let mine = [];
  /** @type {QueueItem[] | null} */
  let items = null;
  /** @type {Map<string, string>} line id -> its text, from the notes */
  const lines = new Map();
  let all = false, owner = false, ready = false, loaded = false, seen = false;   // seen: the tab has been opened (nothing is drawn before, so Align's gestures never wait on it)

  /** @param {string} fact @param {string} [text] -> what to call the thing answered */
  const label = (fact, text) => {
    if (text) return plain(text);
    const id = fact.startsWith(WRONG) ? fact.slice(WRONG.length) : fact;
    return lines.get(id) ?? (fact.startsWith('flag:') ? `Flag ${fact.slice(5)}` : id);
  };

  /** @param {string} fact @param {string} choice @param {number} at @param {string} [text] @param {string} [section] */
  const row = (fact, choice, at, text, section) => {
    const li = el('li', 'log-row');
    li.dataset.choice = choice;
    li.append(el('p', 'log-line', label(fact, text)));
    li.append(el('p', 'small log-meta', `${SAID[choice] ?? choice}${section ? ` · ${section}` : ''} · ${when(at)}`));
    return li;
  };

  const drawVerdicts = () => {
    if (!seen) return;
    const rows = mine.filter(v => all || CHANGES.includes(v.choice)).sort((a, b) => b.at - a.at);
    $('log-answers').replaceChildren(...rows.slice(0, LIMIT).map(v => row(v.fact, v.choice, v.at, v.text, v.section)));
    $('log-answers-empty').hidden = !!rows.length;
  };

  const drawQueue = () => {
    $('log-queue-block').hidden = !owner;
    if (!owner) { $('log-queue').replaceChildren(); return; }
    $('log-queue-empty').hidden = !items || !!items.length;
    $('log-queue-status').textContent = items ? '' : 'Loading…';
    $('log-queue').replaceChildren(...(items || []).map(i => {
      const li = row(i.fact, i.choice, i.at, i.text, i.section);
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
      void loadData(files => { lines.clear(); for (const l of cardsFrom(files)) lines.set(l.id, l.text); draw(); }).catch(() => { loaded = false; });
    }
    if (owner) void app.queue().then(q => { if (q) { items = q; drawQueue(); } else if (!items) $('log-queue-status').textContent = 'Couldn’t load the queue. Open the tab again.'; });
  };
  document.querySelectorAll('[data-tab-page="#log-page"]').forEach(t => t.addEventListener('click', open));

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
      for (const id of ['tab-log', 'side-log']) $(id).hidden = !ready;
      if (!ready) { mine = []; items = null; loaded = false; seen = false; }
      if (owner !== was) { if (!owner) items = null; drawQueue(); }
    },
    verdicts(list) { mine = list; drawVerdicts(); },
  };
}
