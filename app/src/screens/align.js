// The Align screen (#align-page): one card at a time from the shared notes (data.js), a swipe up for the next
// (vpager.js). A card asks a question about one line (an MCQ first; a statement or a blank shows its answer
// on a tap), then shows the line as the notes have it and his six answers; a line with no question shows the line
// and the answers at once. "Repo wrong" and "Edit" open the fix sheet (#fix) with the line to change. Each answer is
// a verdict (cloud.js; one doc per line); a card swiped on with no answer is saved as 'seen', once the scroll lands.
// The deck is made when the data or the filter changes (cards.js queue), not when a verdict comes in, so answering
// never moves the cards under his finger. The owner's open flags (/api/flags) come first as flag cards: the line as
// written (and, for a clash, the other topic's), the note and any suggested fix; Accept fix, Keep as written, Edit.
// An answer that asks for a change is sent to the notes' queue (app.flush) a little after the finger lifts, and when
// the page is hidden.
import { toaster, emptyState, loadState, afterGesture } from '@core/ui';
import { AREA_NAMES, chipOrder, cardsFrom, queue, flagDeck, questionFor, plain, seenFrom } from '../cards.js';
import { loadData } from '../data.js';
import { REFUSED } from '../state.js';
import { el, ago, askCard } from '../ask.js';
import { $, input, dialog } from '../dom.js';
import { vPager } from '../vpager.js';

/** @typedef {import('../cards.js').Fact} Line */
/** @typedef {import('../cards.js').Verdict} Verdict */

const ANSWERS = /** @type {const} */ ([
  ['agree', 'Agree'], ['repo-wrong', 'Notes wrong'], ['me-wrong', 'I was wrong'],
  ['also-true', 'Other option also true'], ['bad-question', 'Bad question'], ['edit', 'Edit'],
]);
const FLAG_ANSWERS = /** @type {const} */ ([['accept-fix', 'Accept fix'], ['keep', 'Keep as written'], ['edit', 'Edit']]);
const SAID = /** @type {Record<string, string>} */ (Object.fromEntries([...ANSWERS, ...FLAG_ANSWERS, ['seen', 'Seen']]));
const LEVEL = /** @type {Record<string, string>} */ ({ high: 'High', med: 'Medium', low: 'Low' });
// the answers the queue takes (worker/flush.js ACTION); the others need no flush
const CHANGES = ['repo-wrong', 'edit', 'also-true', 'bad-question', 'accept-fix', 'keep'];
const FLUSH_AFTER = 15000;

/**
 * @param {{ verdict: (fact: string, choice: string, text: string, base: Verdict | null, q?: string) => Promise<string>,
 *   flush: () => Promise<string>, flags: () => Promise<import('../cards.js').Flag[]> }} app
 * @returns {{ show: (s: import('../state.js').State) => void, hide: () => void, verdicts: (list: Verdict[]) => void }}
 */
export function alignScreen(app) {
  const toasts = toaster($('toasts'));
  const toast = (/** @type {string} */ m) => toasts.show(m);
  const state = loadState($('align-state'), { rows: 3 });
  const empty = emptyState($('align-empty'), { title: 'No cards here', hint: 'Nothing matches this area or search.' });
  const stage = $('align-deck');
  /** @type {Line[]} */
  let lines = [];
  /** @type {import('../cards.js').Flag[]} the owner's open flags (none for anyone else) */
  let flags = [];
  /** @type {Map<string, Verdict>} */
  let mine = new Map();
  let heard = false;   // the verdicts have come in once
  /** @type {Line[]} */
  let deck = [];
  /** @type {{ area?: string, search?: string }} */
  const filter = {};
  /** @type {import('app-ui/ui/card-pager.js').CardPager | null} */
  let pager = null;
  /** the card shown last (onShow), and the lines answered on this deck */
  let last = -1;
  const answered = new Set();
  let canWrite = false, started = false, owner = false;
  let touched = false;   // he has tapped something on this deck (a fresher deck then waits for the next visit)

  // one verdict, now or after the glide; the card moves on by itself after an answer
  /** @param {Line} line @param {string} choice @param {string} [text] @param {string} [q]  the question's stem */
  const save = async (line, choice, text = '', q = '') => {
    answered.add(line.id); touched = true;
    const why = await app.verdict(line.id, choice, text, mine.get(line.id) ?? null, q);
    if (why) toast(REFUSED);
    else if (owner && CHANGES.includes(choice)) flushSoon();
  };

  // the owner's changes to the notes' queue: one call a little after the last answer, once the finger is up, and
  // at once when the page is hidden (a call that fails costs nothing: the next one takes everything since)
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let flushTimer;
  let unflushed = false;
  const flushNow = () => { clearTimeout(flushTimer); if (!unflushed) return; unflushed = false; void app.flush().then(why => { if (why) unflushed = true; }); };
  const flushSoon = () => { unflushed = true; clearTimeout(flushTimer); flushTimer = setTimeout(() => afterGesture(flushNow), FLUSH_AFTER); };
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushNow(); });

  // the fix sheet: the line as the notes have it, for him to change; Save is the verdict
  const sheet = dialog('fix');
  /** @type {{ line: Line, choice: string, q: string } | null} */
  let fixing = null;
  sheet.addEventListener('close', () => {
    const f = fixing; fixing = null;
    const text = input('fix-text').value.trim();
    if (sheet.returnValue !== 'save' || !f || !text) return;
    void save(f.line, f.choice, text, f.q);
    toast('Saved');
    pager?.go(1);
  });
  /** @param {Line} line @param {string} choice @param {string} [q] */
  const openFix = (line, choice, q = '') => {
    fixing = { line, choice, q };
    $('fix-title').textContent = choice === 'edit' ? 'Edit the line' : 'What should it say?';
    $('fix-where').textContent = `${line.title} · ${line.section}`;
    input('fix-text').value = plain(line.flag?.fix ?? line.text);
    sheet.returnValue = '';   // Escape or the back gesture closes it with the last value, so a cancel would save
    sheet.showModal();
  };

  /** @param {Line} line @param {HTMLElement} card @param {string} [q]  the question's stem */
  const answers = (line, card, q = '') => {
    const box = el('div', 'align-answers');
    const list = line.flag ? FLAG_ANSWERS.map(([c, l]) => [c, c === 'accept-fix' && !line.flag?.fix ? 'Fix as the note says' : l]) : ANSWERS;
    for (const [choice, label] of list) {
      const b = /** @type {HTMLButtonElement} */ (el('button', '', label));
      b.type = 'button'; b.dataset.choice = choice; b.disabled = !canWrite;
      b.addEventListener('click', () => {
        if (choice === 'repo-wrong' || choice === 'edit') { openFix(line, choice, q); return; }
        card.dataset.said = choice;
        void save(line, choice, '', q);
        pager?.go(1);
      });
      box.append(b);
    }
    return box;
  };

  /** @param {number} i @returns {HTMLElement | null} */
  const card = i => {
    const line = deck[i];
    if (!line) return null;
    const c = el('article', 'align-card');
    c.dataset.line = line.id;
    if (line.flag) return flagCard(line, c);
    const before = mine.get(line.id);
    const q = questionFor(line, before ? Math.floor(before.at / 6e4) : 0);
    const { back } = askCard(c, line, q, { onFlip: () => { touched = true; } });
    back.append(answers(line, c, q?.stem ?? ''));
    if (before) back.append(el('p', 'small align-before', `Last: ${SAID[before.choice] ?? before.choice}, ${ago(before.at)}`));
    c.append(back);
    return c;
  };

  // a flag card: the line as written (and the clashing line), the note, the suggested fix; its answers at once
  /** @param {Line} line @param {HTMLElement} c */
  const flagCard = (line, c) => {
    const f = /** @type {import('../cards.js').Flag} */ (line.flag);
    c.classList.add('align-flag', 'bare', 'answered');
    c.append(el('p', 'align-where small', `Flag · ${LEVEL[f.level] ?? f.level} · ${line.title}`));
    const back = el('div', 'align-back');
    back.append(el('p', 'align-line', plain(f.line)));
    if (f.kind === 'conflict') {
      back.append(el('p', 'align-where small', `Clashes with ${f.topicB ?? ''}`), el('p', 'align-line', plain(f.lineB ?? '')));
    }
    back.append(el('p', 'small align-note', f.note));
    if (f.fix) back.append(el('p', 'align-answer', `Suggested: ${plain(f.fix)}`));
    back.append(answers(line, c));
    c.append(back);
    return c;
  };

  // a card left behind with no answer is 'seen' (so it goes to the back of the queue next time), unless he has answered
  // that line before: 'seen' would write over that answer and its text
  /** @param {number} i */
  const shown = i => {
    const prev = deck[last], before = prev && mine.get(prev.id);
    if (prev && i > last && !answered.has(prev.id) && canWrite && (!before || before.choice === 'seen')) void save(prev, 'seen');
    last = i;
    $('align-count').textContent = `${i + 1} of ${deck.length}`;
  };

  const build = () => {
    pager?.stop(); pager = null;
    stage.replaceChildren();
    stage.className = '';
    last = -1; answered.clear(); touched = false;
    deck = [...flagDeck(flags, lines, new Map([...mine.values()].map(v => [v.fact, v.choice])), filter), ...queue(lines, seenFrom([...mine.values()]), filter)];
    empty.show(!!lines.length && !deck.length);
    stage.hidden = !deck.length;
    if (!deck.length) { $('align-count').textContent = ''; return; }
    pager = vPager(stage, { card, onShow: shown, fill: true });
    Object.assign(window, { align: { deck: () => deck.map(l => l.id), index: () => pager?.index() ?? -1, go: (/** @type {1 | -1} */ s) => pager?.go(s) } });
  };

  // the area chips (all, then each area the data has) and the search box
  const chips = $('align-areas');
  const drawChips = () => {
    const areas = chipOrder([...new Set(lines.map(l => l.area))]);
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
  input('align-find').addEventListener('input', () => {
    clearTimeout(typing);
    typing = setTimeout(() => { filter.search = input('align-find').value.trim() || undefined; build(); }, 250);
  });

  const load = () => {
    state.loading();
    loadData((files, { from }) => {
      // a fresher copy from the network while he is part-way through the deck waits for the next visit
      if (from === 'network' && lines.length && (last > 0 || touched)) return;
      lines = cardsFrom(files);
      state.done();
      drawChips();
      build();
    }).then(() => { if (!lines.length) throw new Error('no cards'); })
      .catch(() => { if (!lines.length) state.failed('The cards could not load. Check the connection.', load); });
  };

  return {
    show(s) {
      const could = canWrite;
      canWrite = s.role === 'admin' || s.role === 'member';
      const was = owner;
      owner = s.role === 'admin';
      // the owner's flags (the Worker refuses anyone else); they join the deck if he hasn't started on it
      if (owner && !was) void app.flags().then(f => { flags = f; if (f.length && lines.length && last <= 0 && !touched) afterGesture(build); });
      if (started && could !== canWrite && lines.length) build();   // the answer buttons are made with the card
      $('align-view').hidden = false;
      if (!started) { started = true; load(); }
    },
    // signed out: his answers go (the next person's come with their watch)
    hide() { $('align-view').hidden = true; mine = new Map(); heard = false; flags = []; owner = false; },
    verdicts(list) {
      mine = new Map(list.map(v => [v.fact, v]));
      // the first time they come in, the deck is made again (seen lines to the back), if he hasn't started on it
      if (!heard && lines.length && last <= 0 && !touched) afterGesture(build);
      heard = true;
    },
  };
}
