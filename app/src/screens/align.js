// The Align screen (#align-page): one card at a time from the shared notes (data.js), a sideways swipe for the next
// (the kit's cardPager). A card asks a question about one line (an MCQ first; a statement or a blank shows its answer
// on a tap), then shows the line as the notes have it and his six answers; a line with no question shows the line
// and the answers at once. "Repo wrong" and "Edit" open the fix sheet (#fix) with the line to change. Each answer is
// a verdict (cloud.js; one doc per line); a card swiped on with no answer is saved as 'seen', after the glide lands.
// The deck is made when the data or the filter changes (cards.js queue), not when a verdict comes in, so answering
// never moves the cards under his finger.
import { cardPager, toaster, emptyState, loadState, afterGesture } from '@core/ui';
import { AREA_NAMES, cardsFrom, queue, questionFor, plain, seenFrom } from '../cards.js';
import { loadData } from '../data.js';
import { REFUSED } from '../items.js';
import { $, input, dialog } from '../dom.js';

/** @typedef {import('../cards.js').Fact} Line */
/** @typedef {import('../cards.js').Verdict} Verdict */

const ANSWERS = /** @type {const} */ ([
  ['agree', 'Agree'], ['repo-wrong', 'Notes wrong'], ['me-wrong', 'I was wrong'],
  ['also-true', 'Other option also true'], ['bad-question', 'Bad question'], ['edit', 'Edit'],
]);
const SAID = /** @type {Record<string, string>} */ (Object.fromEntries([...ANSWERS, ['seen', 'Seen']]));

/** @param {string} tag @param {string} [cls] @param {string} [text] */
const el = (tag, cls = '', text = '') => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
};
/** @param {number} at */
const ago = at => {
  const d = Math.floor((Date.now() - at) / 864e5);
  return d < 1 ? 'today' : d === 1 ? 'yesterday' : `${d} days ago`;
};

/**
 * @param {{ verdict: (fact: string, choice: string, text: string, base: Verdict | null) => Promise<string> }} app
 * @returns {{ show: (s: import('../items.js').State) => void, hide: () => void, verdicts: (list: Verdict[]) => void }}
 */
export function alignScreen(app) {
  const toasts = toaster($('toasts'));
  const toast = (/** @type {string} */ m) => toasts.show(m);
  const state = loadState($('align-state'), { rows: 3 });
  const empty = emptyState($('align-empty'), { title: 'No cards here', hint: 'Nothing matches this area or search.' });
  const stage = $('align-deck');
  /** @type {Line[]} */
  let lines = [];
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
  let canWrite = false, started = false;
  let touched = false;   // he has tapped something on this deck (a fresher deck then waits for the next visit)

  // one verdict, now or after the glide; the card moves on by itself after an answer
  /** @param {Line} line @param {string} choice @param {string} [text] */
  const save = async (line, choice, text = '') => {
    answered.add(line.id); touched = true;
    const why = await app.verdict(line.id, choice, text, mine.get(line.id) ?? null);
    if (why) toast(REFUSED);
  };

  // the fix sheet: the line as the notes have it, for him to change; Save is the verdict
  const sheet = dialog('fix');
  /** @type {{ line: Line, choice: string } | null} */
  let fixing = null;
  sheet.addEventListener('close', () => {
    const f = fixing; fixing = null;
    const text = input('fix-text').value.trim();
    if (sheet.returnValue !== 'save' || !f || !text) return;
    void save(f.line, f.choice, text);
    toast('Saved');
    pager?.go(1);
  });
  /** @param {Line} line @param {string} choice */
  const openFix = (line, choice) => {
    fixing = { line, choice };
    $('fix-title').textContent = choice === 'edit' ? 'Edit the line' : 'What should it say?';
    $('fix-where').textContent = `${line.title} · ${line.section}`;
    input('fix-text').value = plain(line.text);
    sheet.returnValue = '';   // Escape or the back gesture closes it with the last value, so a cancel would save
    sheet.showModal();
  };

  /** @param {Line} line @param {HTMLElement} card */
  const answers = (line, card) => {
    const box = el('div', 'align-answers');
    for (const [choice, label] of ANSWERS) {
      const b = /** @type {HTMLButtonElement} */ (el('button', '', label));
      b.type = 'button'; b.dataset.choice = choice; b.disabled = !canWrite;
      b.addEventListener('click', () => {
        if (choice === 'repo-wrong' || choice === 'edit') { openFix(line, choice); return; }
        card.dataset.said = choice;
        void save(line, choice);
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
    c.append(el('p', 'align-where small', `${AREA_NAMES[line.area] ?? line.area} · ${line.title} · ${line.section}`));
    const before = mine.get(line.id);
    const q = questionFor(line, before ? Math.floor(before.at / 6e4) : 0);
    const back = el('div', 'align-back');
    const lineP = el('p', 'align-line', plain(line.text));
    back.append(lineP);
    const flip = () => { c.classList.add('answered'); touched = true; };
    if (!q) {
      c.classList.add('bare', 'answered');
    } else if (q.kind === 'mcq') {
      c.append(el('p', 'align-stem', plain(q.stem)));
      const opts = el('div', 'align-options');
      (q.options || []).forEach((o, k) => {
        const b = /** @type {HTMLButtonElement} */ (el('button', '', plain(o)));
        b.type = 'button';
        b.addEventListener('click', () => {
          if (c.classList.contains('answered')) return;
          b.classList.add('picked');
          opts.children[/** @type {number} */ (q.answer)]?.classList.add('right');
          if (k !== q.answer) b.classList.add('wrong');
          flip();
        });
        opts.append(b);
      });
      c.append(opts);
    } else {
      c.append(el('p', 'align-stem', plain(q.stem)));
      const show = /** @type {HTMLButtonElement} */ (el('button', 'align-show', 'Show answer'));
      show.type = 'button';
      show.addEventListener('click', flip);
      c.append(show);
      back.prepend(el('p', 'align-answer', `Answer: ${plain(String(q.answer))}`));
    }
    back.append(answers(line, c));
    if (before) back.append(el('p', 'small align-before', `Last: ${SAID[before.choice] ?? before.choice}, ${ago(before.at)}`));
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
    deck = queue(lines, seenFrom([...mine.values()]), filter);
    empty.show(!!lines.length && !deck.length);
    stage.hidden = !deck.length;
    if (!deck.length) { $('align-count').textContent = ''; return; }
    pager = cardPager(stage, { card, onShow: shown });
    Object.assign(window, { align: { deck: () => deck.map(l => l.id), index: () => pager?.index() ?? -1, go: (/** @type {1 | -1} */ s) => pager?.go(s) } });
  };

  // the area chips (all, then each area the data has) and the search box
  const chips = $('align-areas');
  const drawChips = () => {
    const areas = [...new Set(lines.map(l => l.area))];
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
      if (started && could !== canWrite && lines.length) build();   // the answer buttons are made with the card
      $('align-view').hidden = false; $('align-gate').hidden = true;
      if (!started) { started = true; load(); }
    },
    // signed out: his answers go (the next person's come with their watch)
    hide() { $('align-view').hidden = true; $('align-gate').hidden = false; mine = new Map(); heard = false; },
    verdicts(list) {
      mine = new Map(list.map(v => [v.fact, v]));
      // the first time they come in, the deck is made again (seen lines to the back), if he hasn't started on it
      if (!heard && lines.length && last <= 0 && !touched) afterGesture(build);
      heard = true;
    },
  };
}
