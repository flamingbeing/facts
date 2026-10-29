// Alert and confirm modals: a <dialog> opened modally, Tab kept inside it, Esc or the backdrop dismisses (the "no"
// answer), focus goes back to whatever had it. Each returns a promise and removes its dialog when answered.
import { LABELS } from './labels.js';
import { el } from './dom.js';

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled])';

/** The index Tab (or Shift+Tab) lands on, wrapping at both ends. @param {number} count @param {number} at @param {boolean} back */
export function wrapIndex(count, at, back) {
  if (count <= 0) return -1;
  return back ? (at <= 0 ? count - 1 : at - 1) : (at < 0 || at >= count - 1 ? 0 : at + 1);
}

/**
 * @param {string} message
 * @param {{ title?: string, buttons: { label: string, value: boolean, danger?: boolean, first?: boolean }[] }} o
 * @returns {Promise<boolean>}  the value of the button pressed; false on Esc or a click outside
 */
function ask(message, { title = '', buttons }) {
  const back = /** @type {HTMLElement | null} */ (document.activeElement);
  const id = `modal-${Math.random().toString(36).slice(2, 8)}`;
  const box = /** @type {HTMLDialogElement} */ (el('dialog', { class: 'modal', 'aria-describedby': `${id}-text`, ...(title ? { 'aria-labelledby': `${id}-title` } : { 'aria-label': message }) },
    ...(title ? [el('h2', { id: `${id}-title` }, title)] : []),
    el('p', { id: `${id}-text` }, message)));
  const row = el('div', { class: 'ui-inline row' });
  box.append(row);
  return new Promise(resolve => {
    /** @param {boolean} value */
    const done = value => { box.close(); box.remove(); back?.focus(); resolve(value); };
    for (const b of buttons) {
      const btn = el('button', { type: 'button', ...(b.danger ? { class: 'ui-danger danger' } : {}) }, b.label);
      btn.addEventListener('click', () => done(b.value));
      row.append(btn);
    }
    box.addEventListener('cancel', e => { e.preventDefault(); done(false); });
    box.addEventListener('click', e => {   // a click on the backdrop only: outside the box's own bounds
      const r = box.getBoundingClientRect();
      if (e.target === box && (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom)) done(false);
    });
    box.addEventListener('keydown', e => {
      if (e.key !== 'Tab') return;
      const all = [...box.querySelectorAll(FOCUSABLE)];
      const next = all[wrapIndex(all.length, all.indexOf(/** @type {Element} */ (document.activeElement)), e.shiftKey)];
      if (next) { e.preventDefault(); /** @type {HTMLElement} */ (next).focus(); }
    });
    document.body.append(box);
    box.showModal();
    /** @type {HTMLElement | undefined} */ (row.children[buttons.findIndex(b => b.first)] || row.children[0])?.focus();
  });
}

/** @param {string} message @param {{ title?: string, labels?: Record<string, string> }} [o] -> resolves when closed */
export async function alertModal(message, { title, labels = {} } = {}) {
  await ask(message, { title, buttons: [{ label: { ...LABELS, ...labels }.ok, value: true }] });
}

/**
 * @param {string} message
 * @param {{ title?: string, danger?: boolean, yes?: string, labels?: Record<string, string> }} [o]
 *   danger: the yes button is drawn as a danger and Cancel has the focus; yes: its words (default OK)
 * @returns {Promise<boolean>}
 */
export function confirmModal(message, { title, danger = false, yes, labels = {} } = {}) {
  const words = { ...LABELS, ...labels };
  return ask(message, { title, buttons: [
    { label: yes || words.ok, value: true, danger },
    { label: words.cancel, value: false, first: danger },
  ] });
}
