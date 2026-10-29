// Hide mode: a tap on a button or a card hides it on this device; a list in the settings shows what is hidden, each
// with Show, and Show all. The app keeps the list (a device setting) and calls applyHidden after drawing a page.
// What can't be hidden, so nothing needed to undo goes: the main button, anything holding the app's keep markup, the
// bar and pop-ups (keepOut), choices between options, and names with a number in them (a day, a count), which can't be
// found again. While hide mode is on, the page's tap handler must stop the tap (preventDefault and stopPropagation in
// the capture phase) so the button's own action doesn't run. A hidden item is matched by its page, kind and words (a button's label, a card's heading), so it stays
// hidden after the page is drawn again; `?nohide` in the address shows everything for that visit. Style: ui/ui.css.
// Nothing runs on import; the list code is pure, the rest needs a page.

export const MAX_HIDDEN = 100;
const KINDS = ['btn', 'card'];
const PROTECT_WORDS = /^(save|undo|done|cancel|close|back|settings|sign in|sign out|show all)\b/i;
const BUTTONS = 'button, a.btn, label.btn';
const FIELDS = 'textarea, input, select, [contenteditable]';
const CARDS = 'section.card';
const KEEP_OUT = 'dialog, .modal, .toasts, .ui-tabbar, .ui-action-bar, .ui-bar, [data-keep]';

/**
 * @typedef {{ tab: string, kind: 'btn' | 'card', name: string }} Hidden  tab: the page (letters and digits)
 */

/** @param {unknown} s */
const word = s => String(s || '').replace(/[\u0000-\u001f]/g, '').replace(/\s+/g, ' ').trim().slice(0, 60);
/** @param {Hidden} x */
export const hideKey = x => `${x.tab}|${x.kind}|${x.name}`;

/**
 * The saved list made safe: known kinds, short words, no repeats; past MAX_HIDDEN the oldest go.
 * @param {unknown} v
 * @returns {Hidden[]}
 */
export function cleanHideList(v) {
  /** @type {Hidden[]} */
  const out = [];
  const seen = new Set();
  for (const x of Array.isArray(v) ? v : []) {
    if (!x || typeof x !== 'object') continue;
    const e = { tab: word(x.tab).slice(0, 20), kind: x.kind, name: word(x.name) };
    if (!/^[a-z0-9]+$/.test(e.tab) || !KINDS.includes(e.kind) || !e.name || seen.has(hideKey(e))) continue;
    seen.add(hideKey(e));
    out.push(e);
  }
  return out.slice(-MAX_HIDDEN);
}

/** the words that name an element: a button's label, a card's first heading (none: it can't be hidden) @param {Element} el */
export function nameOf(el) {
  if (el.matches(BUTTONS)) return word(el.getAttribute('aria-label') || el.textContent || el.getAttribute('title'));
  const head = el.querySelector('h2, h3, summary, legend');
  return head ? word(head.textContent) : '';
}
/** @param {Element} el */
const isKept = el => el.matches(`.primary, ${FIELDS}, [data-keep]`) || (el.matches(BUTTONS) && PROTECT_WORDS.test(nameOf(el)));

/**
 * Why it can't be hidden, or '' when it can.
 * @param {Element} el
 * @param {{ keepOut?: string }} [o]  keepOut: a selector for the app's bars and pop-ups, added to the built-in ones
 */
export function keptBecause(el, { keepOut = '' } = {}) {
  if (el.closest(keepOut ? `${KEEP_OUT}, ${keepOut}` : KEEP_OUT)) return 'The bars and pop-ups always stay.';
  if (el.matches(CARDS) && [...el.querySelectorAll(`${BUTTONS}, ${FIELDS}`)].some(isKept)) return 'It holds the main button or an input, which always stay.';
  if (!nameOf(el)) return 'It has no name to find it by again.';
  if (isKept(el)) return 'The main button, Save and inputs always stay.';
  if (el.matches('[aria-pressed], [role=tab], [role=radio]') || el.closest('[role=tablist], [role=radiogroup]')) return 'Choices between options always stay, so you can always switch back.';
  if (/\d/.test(nameOf(el))) return 'Its name changes with your data (a date or a count), so it can’t be found again.';
  return '';
}

/** the element a tap is about: the button tapped, else the card around it @param {Element} node */
export function targetOf(node) {
  return node.closest(BUTTONS) || node.closest(CARDS);
}
/** @param {Element} el */
const kindOf = el => (el.matches(BUTTONS) ? 'btn' : 'card');
/** @param {Element} el @param {string} tab @returns {Hidden} */
export const entryFor = (el, tab) => ({ tab, kind: kindOf(el), name: nameOf(el) });

/**
 * Hide the listed items of this page in root (class user-hidden); with hide mode on (marking), mark what can go
 * (class hide-cand).
 * @param {ParentNode | null} root @param {string} tab @param {unknown} list
 * @param {{ free?: boolean, marking?: boolean, keepOut?: string }} [o]  free: show everything (hide mode's owner is
 *   looking at the list); marking: hide mode is on
 */
export function applyHidden(root, tab, list, { free = false, marking = false, keepOut = '' } = {}) {
  if (!root) return;
  const off = free || /[?&]nohide\b/.test(location.search);
  const keys = new Set(off ? [] : cleanHideList(list).filter(x => x.tab === tab).map(hideKey));
  for (const el of root.querySelectorAll(`${BUTTONS}, ${CARDS}`)) {
    const kept = () => keptBecause(el, { keepOut });
    const hit = keys.size > 0 && keys.has(hideKey(entryFor(el, tab))) && !kept();
    el.classList.toggle('user-hidden', hit);
    el.classList.toggle('hide-cand', marking && !free && !hit && !kept());
  }
}
