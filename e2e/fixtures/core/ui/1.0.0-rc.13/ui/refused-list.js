// The refused list (#refused-box, #refused): saves the server refused and the sync module set aside (onRefused:
// 'archive'), each with "Try again" and "Discard". Hidden while there are none.
import { el, button } from './dom.js';

const SHOWN = 60;   // characters of a refused save shown before "…"

/** @param {Record<string, unknown>} record */
const asJson = record => JSON.stringify(record);

/**
 * @param {HTMLElement} host  the list is added here
 * @param {{ sync: import('./types').SyncApi, kind?: string, text?: (record: Record<string, unknown>) => string, idPrefix?: string }} o
 *   idPrefix: put before each of the part's ids (two on one page, or ids the app already uses)
 *   kind: only this collection's saves (default: all); text: a save in words (default: its fields as JSON)
 * @returns {() => void} stop: unsubscribes and removes the list
 */
export function refusedList(host, { sync, kind, text = asJson, idPrefix = '' }) {
  const list = el('ul', { id: `${idPrefix}refused`, class: 'ui-refused' });
  const box = el('section', { id: `${idPrefix}refused-box`, 'aria-labelledby': `${idPrefix}refused-title` },
    el('h2', { id: `${idPrefix}refused-title` }, 'Not saved: the server refused these'), list);
  host.append(box);
  const draw = () => {
    const jobs = sync.queue.refused(kind);
    box.hidden = !jobs.length;
    list.replaceChildren(...jobs.map(job => {
      const words = text(job.record || {}), why = job.code || job.error || '';
      return el('li', {},
        el('p', {}, `“${words.length > SHOWN ? words.slice(0, SHOWN) + '…' : words}”${why ? ` (${why})` : ''}`),
        button('Try again', () => sync.queue.retry(job.key), { class: 'retry' }),
        button('Discard', () => sync.queue.discard(job.key), { class: 'discard ui-danger danger' }));
    }));
  };
  const off = sync.queue.onChange(draw);
  draw();
  return () => { off(); box.remove(); };
}
