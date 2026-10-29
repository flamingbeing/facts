// The Test tab (#test-page): the same cards as Align (ask.js), over every line that has a question, but scored and spaced
// (schedule.js). An MCQ is graded by the pick; a statement or a blank shows its answer on a tap and then asks Right or
// Wrong. Each answer saves the line's spacing state (cloud.js recall: one doc per person and line) and the deck is made
// when the data, the filter or the first states change, not on an answer, so cards never move under his finger. Lines
// with an open flag (the owner's /api/flags) and lines he sent back are left out. "This fact is wrong" (the owner's
// button) saves a verdict on 'wrong:<line>' with choice 'flag', which the queue (worker/flush.js) takes to the notes'
// processor, and takes the card out of the deck at once. A wrong answer only reschedules; it never edits the notes.
import { cardPager, toaster, emptyState, loadState, afterGesture } from '@core/ui';
import { AREA_NAMES, cardsFrom, questionFor, flaggedIds, plain, WRONG } from '../cards.js';
import { grade, testDeck, topicScores } from '../schedule.js';
import { loadData } from '../data.js';
import { REFUSED } from '../state.js';
import { el, askCard } from '../ask.js';
import { $, input } from '../dom.js';

/** @typedef {import('../cards.js').Fact} Line */
/** @typedef {import('../schedule.js').Recall} Recall */
/** @typedef {Recall & { id: string, fact: string }} RecallDoc */

// a line sent back to Align stays out of the deck for this long (the processor settles it within a day; if the flag is
// dropped as not a problem, the line comes back)
const SENT_BACK_MS = 7 * 864e5;

/**
 * @param {{ verdict: (fact: string, choice: string, text: string, base: null, q?: string) => Promise<string>,
 *   recall: (fact: string, st: Recall, base: RecallDoc | null) => Promise<string>,
 *   flush: () => Promise<string>, flags: () => Promise<import('../cards.js').Flag[]> }} app
 * @returns {{ state: (s: import('../state.js').State) => void, recall: (list: RecallDoc[]) => void,
 *   verdicts: (list: import('../cards.js').Verdict[]) => void }}
 */
export function testScreen(app) {
  const toast = toaster($('toasts'));
  const state = loadState($('test-state'), { rows: 3 });
  const empty = emptyState($('test-empty'), { title: 'No cards here', hint: 'Nothing matches this area or search.' });
  const stage = $('test-deck');
  /** @type {Line[]} */
  let lines = [];
  /** @type {import('../cards.js').Flag[]} the owner's open flags (none for anyone else) */
  let flags = [];
  /** @type {Map<string, RecallDoc>} */
  let docs = new Map();
  /** @type {Map<string, Recall>} */
  const states = new Map();
  /** @type {Set<string>} lines sent back to Align (his 'wrong:' verdicts, recent) */
  let sentBack = new Set();
  let heard = false;   // the states have come in once
  /** @type {Line[]} */
  let deck = [];
  /** @type {{ area?: string, search?: string }} */
  const filter = {};
  /** @type {import('app-ui/ui/card-pager.js').CardPager | null} */
  let pager = null;
  let last = -1, touched = false, owner = false, ready = false, started = false;
  let here = '';   // the topic of the card shown

  // the score: lines whose last answer was right, of those answered, overall and per topic (in the area picked)
  const renderScores = () => {
    const rows = topicScores(lines, states, filter);
    const right = rows.reduce((n, r) => n + r.right, 0), answered = rows.reduce((n, r) => n + r.answered, 0);
    const mine = rows.find(r => r.topic === here);
    $('test-score').textContent = `Score ${right}/${answered}${mine ? ` · ${mine.title} ${mine.right}/${mine.answered}` : ''}`;
    $('test-topics').replaceChildren(...rows.map(r => {
      const li = el('li');
      li.dataset.topic = r.topic;
      li.append(el('span', '', r.title), el('span', 'test-n', `${r.right}/${r.answered}`));
      return li;
    }));
  };

  /** @param {Line} line @param {boolean} ok */
  const answer = async (line, ok) => {
    const next = grade(states.get(line.id) ?? null, ok, Date.now());
    states.set(line.id, next);
    renderScores();
    const why = await app.recall(line.id, next, docs.get(line.id) ?? null);
    if (why) toast.show(REFUSED);
  };

  /** @param {Line} line */
  const sendBack = line => {
    sentBack.add(line.id);
    void app.verdict(WRONG + line.id, 'flag', plain(line.text), null).then(why => { if (why) toast.show(REFUSED); });
    afterGesture(() => { void app.flush(); });
    const at = pager?.index() ?? -1;
    if (deck[at]?.id === line.id) deck.splice(at, 1);
    toast.show('Sent back to Align');
    if (!deck.length) return build();
    pager?.refresh();
  };

  /** @param {number} i @returns {HTMLElement | null} */
  const card = i => {
    const line = deck[i];
    if (!line) return null;
    const c = el('article', 'align-card test-card');
    c.dataset.line = line.id;
    const q = questionFor(line, states.get(line.id)?.reps ?? 0);
    let graded = false;
    /** @param {boolean} ok */
    const record = ok => { if (graded) return; graded = true; c.dataset.said = ok ? 'right' : 'wrong'; void answer(line, ok); };
    const { back } = askCard(c, line, q, { onFlip: ok => { touched = true; if (ok !== undefined) record(ok); } });
    const box = el('div', 'align-answers');
    /** @param {string} choice @param {string} label @param {() => void} fn */
    const button = (choice, label, fn) => {
      const b = /** @type {HTMLButtonElement} */ (el('button', '', label));
      b.type = 'button'; b.dataset.choice = choice;
      b.addEventListener('click', fn);
      box.append(b);
      return b;
    };
    if (q?.kind === 'mcq') button('next', 'Next', () => pager?.go(1));
    else {
      button('right', 'Right', () => { record(true); pager?.go(1); });
      button('wrong', 'Wrong', () => { record(false); pager?.go(1); });
    }
    if (owner) button('flag', 'This fact is wrong', () => sendBack(line)).classList.add('test-flag');
    back.append(box);
    c.append(back);
    return c;
  };

  /** @param {number} i */
  const shown = i => {
    last = i;
    here = deck[i]?.topic ?? '';
    $('test-count').textContent = `${i + 1} of ${deck.length}`;
    renderScores();
  };

  const build = () => {
    pager?.stop(); pager = null;
    stage.replaceChildren();
    stage.className = '';
    last = -1; touched = false; here = '';
    const skip = new Set([...flaggedIds(flags, lines), ...sentBack]);
    deck = testDeck(lines, states, Date.now(), filter, skip);
    empty.show(!!lines.length && !deck.length);
    stage.hidden = !deck.length;
    renderScores();
    if (!deck.length) { $('test-count').textContent = ''; return; }
    pager = cardPager(stage, { card, onShow: shown, fill: true });
    Object.assign(window, { quiz: { deck: () => deck.map(l => l.id), index: () => pager?.index() ?? -1, go: (/** @type {1 | -1} */ s) => pager?.go(s) } });
  };

  // the area chips (all, then each area with a question) and the search box, as Align's
  const chips = $('test-areas');
  const drawChips = () => {
    const areas = [...new Set(lines.filter(l => l.qs.length).map(l => l.area))];
    chips.replaceChildren(...['', ...areas].map(a => {
      const b = /** @type {HTMLButtonElement} */ (el('button', 'chip', a ? AREA_NAMES[a] ?? a : 'All'));
      b.type = 'button'; b.dataset.area = a;
      b.setAttribute('aria-pressed', String((filter.area || '') === a));
      b.addEventListener('click', () => {
        filter.area = a || undefined;
        for (const c of chips.children) c.setAttribute('aria-pressed', String(c === b));
        build();
      });
      return b;
    }));
  };
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let typing;
  input('test-find').addEventListener('input', () => {
    clearTimeout(typing);
    typing = setTimeout(() => { filter.search = input('test-find').value.trim() || undefined; build(); }, 250);
  });

  const load = () => {
    state.loading();
    loadData((files, { from }) => {
      if (from === 'network' && lines.length && (last > 0 || touched)) return;   // a fresher copy waits for the next visit
      lines = cardsFrom(files);
      state.done();
      drawChips();
      build();
    }).then(() => { if (!lines.length) throw new Error('no cards'); })
      .catch(() => { if (!lines.length) state.failed('The cards could not load. Check the connection.', load); });
  };
  // the data is fetched the first time the tab is opened
  const open = () => { if (ready && !started) { started = true; load(); } };
  document.querySelectorAll('[data-tab-page="#test-page"]').forEach(t => t.addEventListener('click', open));

  /** a fresh deck, if he has not started on this one */
  const refresh = () => { if (lines.length && last <= 0 && !touched) afterGesture(build); };

  return {
    state(s) {
      const was = owner;
      ready = s.phase === 'ready';
      owner = ready && s.role === 'admin';
      for (const id of ['tab-test', 'side-test']) $(id).hidden = !ready;
      if (owner && !was) void app.flags().then(f => { flags = f; if (f.length) refresh(); });
      if (!owner && was) { flags = []; pager?.refresh(); }
      if (owner !== was) pager?.refresh();   // the flag button is made with the card
      if (!ready) { states.clear(); docs = new Map(); sentBack = new Set(); heard = false; }
    },
    recall(list) {
      docs = new Map(list.map(d => [d.fact, d]));
      for (const [id, d] of docs) if (!states.has(id) || states.get(id)?.last !== d.last) states.set(id, d);
      // the first time they come in, the deck is made again (due lines first), if he hasn't started on it
      if (!heard) refresh();
      heard = true;
      renderScores();
    },
    verdicts(list) {
      const now = Date.now();
      sentBack = new Set(list.filter(v => v.fact.startsWith(WRONG) && now - v.at < SENT_BACK_MS).map(v => v.fact.slice(WRONG.length)));
    },
  };
}
