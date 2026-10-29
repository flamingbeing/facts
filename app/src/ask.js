// The question half of a card, shared by Align and the Test tab: the where-line, the question (an MCQ's options, or a
// statement or blank with a "Show answer" button) and the back (the line as the notes have it, and the answer for a
// statement or blank) that comes in once the card is answered. The caller adds its own buttons to the back and appends
// it to the card last. Plain DOM, no state; the layout is Align's (app.css .align-*).
import { plain, AREA_NAMES } from './cards.js';

/** @typedef {import('./cards.js').Fact} Line */
/** @typedef {import('./cards.js').Question} Question */

/** @param {string} tag @param {string} [cls] @param {string} [text] */
export const el = (tag, cls = '', text = '') => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
};

/** @param {number} at -> 'today', 'yesterday' or 'N days ago' */
export const ago = at => {
  const d = Math.floor((Date.now() - at) / 864e5);
  return d < 1 ? 'today' : d === 1 ? 'yesterday' : `${d} days ago`;
};

/**
 * Fills a card with a line's question. A line with no question marks the card 'bare' and answered at once. Returns the
 * back for the caller's buttons (append it to the card after them), and what the tap did: `onFlip(ok)`, with ok true or
 * false for an MCQ pick and undefined for "Show answer" (a statement or blank is for the person to judge).
 * @param {HTMLElement} c  the article @param {Line} line @param {Question | null} q
 * @param {{ onFlip?: (ok?: boolean) => void, where?: string }} [o]  where: the header (default: area name · title · section)
 * @returns {{ back: HTMLElement }}
 */
export function askCard(c, line, q, { onFlip, where } = {}) {
  c.append(el('p', 'align-where small', where ?? `${AREA_NAMES[line.area] ?? line.area} · ${line.title} · ${line.section}`));
  const back = el('div', 'align-back');
  back.append(el('p', 'align-line', plain(line.text)));
  const flip = (/** @type {boolean | undefined} */ ok) => { c.classList.add('answered'); onFlip?.(ok); };
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
        flip(k === q.answer);
      });
      opts.append(b);
    });
    c.append(opts);
  } else {
    c.append(el('p', 'align-stem', plain(q.stem)));
    const show = /** @type {HTMLButtonElement} */ (el('button', 'align-show', 'Show answer'));
    show.type = 'button';
    show.addEventListener('click', () => flip());
    c.append(show);
    back.prepend(el('p', 'align-answer', `Answer: ${plain(String(q.answer))}`));
  }
  return { back };
}
