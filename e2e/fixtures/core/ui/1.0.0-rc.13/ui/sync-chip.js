// The sync chip (#status, one per page): the sync module's state in a word, with the count of saves it concerns.
import { LABELS } from './labels.js';
import { el } from './dom.js';

/**
 * @param {HTMLElement} host  the chip is added here
 * @param {{ sync: import('./types').SyncApi, labels?: Record<string, string>, idPrefix?: string }} o  labels: words over LABELS
 *   idPrefix: put before each of the part's ids (two on one page, or ids the app already uses)
 * @returns {() => void} stop: unsubscribes and removes the chip
 */
export function syncChip(host, { sync, labels = {}, idPrefix = '' }) {
  const words = { ...LABELS, ...labels };
  const chip = el('span', { id: `${idPrefix}status`, class: 'ui-chip chip', role: 'status', 'aria-live': 'polite' }, words.unknown);
  host.append(chip);
  const off = sync.status$(st => {
    chip.dataset.state = st.state;
    chip.textContent = (words[st.state] || st.state) + (st.count ? ` (${st.count})` : '');
  });
  return () => { off(); chip.remove(); };
}
