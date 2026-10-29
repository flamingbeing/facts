// Toasts: a short note ("Saved") in a live region, gone by itself after a few seconds or when dismissed.
import { LABELS } from './labels.js';
import { el } from './dom.js';

/**
 * @param {HTMLElement} host  the region is added here (once per page)
 * @param {{ ms?: number, labels?: Record<string, string> }} [o]  ms: how long a toast stays (default 4000);
 *   labels: words over LABELS
 * @returns {{ show: (message: string, o?: { ms?: number, action?: { label: string, run: () => void } }) => () => void, stop: () => void }}
 *   show returns that toast's dismiss (action: a button such as Undo, which runs and dismisses); stop removes the region
 */
export function toaster(host, { ms = 4000, labels = {} } = {}) {
  const words = { ...LABELS, ...labels };
  const region = el('div', { class: 'toasts', role: 'status', 'aria-live': 'polite' });
  host.append(region);
  return {
    show(message, o = {}) {
      const note = el('div', { class: 'toast' }, el('span', {}, message));
      const close = el('button', { type: 'button', 'aria-label': words.dismiss }, '×');
      if (o.action) {
        const act = o.action;
        const b = el('button', { type: 'button', class: 'toast-action' }, act.label);
        b.addEventListener('click', () => { dismiss(); act.run(); });
        note.append(b);
      }
      note.append(close);
      const dismiss = () => { clearTimeout(timer); note.remove(); };
      const timer = setTimeout(dismiss, o.ms ?? ms);
      close.addEventListener('click', dismiss);
      region.append(note);
      return dismiss;
    },
    stop() { region.remove(); },
  };
}
