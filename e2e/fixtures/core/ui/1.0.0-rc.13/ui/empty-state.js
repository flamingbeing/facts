// The empty state: what a list shows when it has nothing yet: a title, a line of help and, if given, one action.
import { el, button } from './dom.js';

/**
 * @param {HTMLElement} host  the block is added here, hidden until shown
 * @param {{ title: string, hint?: string, action?: { label: string, onClick: () => unknown } }} o
 * @returns {{ show: (on: boolean) => void, stop: () => void }}
 */
export function emptyState(host, { title, hint = '', action }) {
  const box = el('div', { class: 'empty-state' }, el('p', { class: 'empty-title' }, title));
  if (hint) box.append(el('p', { class: 'ui-small small' }, hint));
  if (action) box.append(button(action.label, action.onClick));
  box.hidden = true;
  host.append(box);
  return { show(on) { box.hidden = !on; }, stop() { box.remove(); } };
}
