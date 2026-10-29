// The list's search box (the search recipe's glue, recipes/search.json): full-text search over the items with
// @core/search, with the sample operators has:number and is:long. It fills the list's tools slot (#list-tools) and
// "/" jumps to the box on a computer.
import { createSearch } from '@core/search';
import { itemText } from '../items.js';

/** @typedef {import('../items.js').Item} Item */

/** the box, its label and its status line */
function drawBox(/** @type {HTMLElement} */ slot) {
  const box = document.createElement('div');
  box.id = 'search';
  const label = Object.assign(document.createElement('label'), { htmlFor: 'q', textContent: 'Search' });
  const q = Object.assign(document.createElement('input'), {
    id: 'q', type: 'search', autocomplete: 'off', placeholder: 'word, "phrase", -leave out, has:number, is:long',
  });
  const msg = Object.assign(document.createElement('p'), { id: 'search-msg', className: 'small' });
  msg.setAttribute('role', 'status');
  box.append(label, q, msg);
  slot.append(box);
  return { q, msg };
}

/** @type {import('./list.js').ListFilter} */
export function listSearch({ slot, redraw }) {
  const { q, msg } = drawBox(slot);
  const search = createSearch({
    fields: ['text'],
    operators: {
      has: (rec, v) => v === 'number' && /\d/.test(itemText(rec)),
      is: (rec, v) => v === 'long' && itemText(rec).length >= 20,
    },
    onReady: redraw,   // MiniSearch came in after a search: search again with it
  });
  /** @type {Map<string, string>} id -> the text as indexed (a new subscription starts with no "changed" ids, so compare) */
  const known = new Map();

  q.addEventListener('input', redraw);
  q.addEventListener('focus', () => void search.prepare(), { once: true });
  document.addEventListener('keydown', e => {
    const t = /** @type {HTMLElement} */ (e.target);
    if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || document.querySelector('dialog[open]')) return;
    e.preventDefault(); q.focus();
  });

  return {
    /** keeps the index current: only records whose text changed are fed */
    feed(items) {
      const now = new Set(items.map(i => i.id));
      for (const id of known.keys()) if (!now.has(id)) { search.remove(id); known.delete(id); }
      const stale = items.filter(i => known.get(i.id) !== itemText(i));
      search.feed(stale);
      for (const i of stale) known.set(i.id, itemText(i));
    },
    /** the items the box leaves in, in the order to show them; null with the box empty */
    pick(items) {
      const text = q.value.trim();
      if (!text) { msg.textContent = ''; return null; }
      const { hits, unknown } = search.search(text, { limit: 500 });
      msg.textContent = unknown.length ? `Did you mean ${unknown.map(u => u.suggest).join(', ')}?` : hits.length ? '' : 'No matches';
      const byId = new Map(items.map(i => [i.id, i]));
      return hits.map(h => byId.get(h.id)).filter(/** @returns {i is Item} */ i => !!i);
    },
  };
}
