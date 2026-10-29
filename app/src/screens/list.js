// The list screen (#list-view): the items, with add and edit (members and admins), the kit's conflict sheet and the
// list of saves the server refused. With the files recipe each item shows its photos' thumbnails (and a clip for other files).
import { conflictSheet, refusedList, toaster, emptyState, undoToast, loadState } from '@core/ui';
import { COLL, REFUSED, itemText } from '../items.js';
import { $, input, sectionScreen } from '../dom.js';
import { itemSheet } from './item-sheet.js';
import { modules } from '../modules.js';

/** @typedef {import('../items.js').Item} Item */
/**
 * The list's tools slot (modules.js "listFilter"; the search recipe fills it): draws into the slot and narrows the list.
 * @typedef {(o: { slot: HTMLElement, redraw: () => void }) => { feed: (items: Item[]) => void, pick: (items: Item[]) => Item[] | null }} ListFilter
 */
/**
 * The items' files slot (modules.js "itemFiles"; the files recipe fills it): thumbnails on the list, a part of the edit sheet.
 * @typedef {object} ItemFiles
 * @property {(byItem: Map<string, unknown[]>) => void} feed  every item's files, whenever one changes
 * @property {(itemId: string) => unknown[]} of  an item's files as this device has them
 * @property {(item: Item) => HTMLElement | null} thumbs  the list row's thumbnails
 * @property {(slot: HTMLElement, editing: () => Item | null) => () => void} mount  fills the edit sheet's slot -> redraw it
 * (app: cloud.js's Started, which the files module needs; any here, as a static app has no cloud.js)
 * @typedef {(o: { app: any, toast: (message: string) => unknown }) => ItemFiles} ItemFilesSlot
 */

/** @param {import('../items.js').ItemsApp} app */
export function listScreen(app) {
  let canWrite = false;
  /** @type {Item[]} */
  let all = [];
  const filter = modules.listFilter?.({ slot: $('list-tools'), redraw: () => api.draw(all, new Set()) });
  /** a stamp as ms: a number, or an ISO string (app-sync reads either); 0 when there is none */
  const num = (/** @type {unknown} */ v) => (typeof v === 'number' ? v : typeof v === 'string' ? Date.parse(v) || 0 : 0);
  /** @type {Record<string, (a: Item, b: Item) => number>} */
  const ORDER = {
    text: (a, b) => String(a.text).localeCompare(String(b.text)),
    modified: (a, b) => num(b.updatedAt) - num(a.updatedAt),
    created: (a, b) => num(b.createdAt ?? b.updatedAt) - num(a.createdAt ?? a.updatedAt),
  };
  /** the items to show, in order: the filter's pick, else all of them as this device's "Sort the list" says */
  const visible = () => filter?.pick(all) ?? [...all].sort(ORDER[app.settings.get('sort')] ?? ORDER.text);
  const when = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
  /** "Added 28 Oct, 14:02 · Changed 29 Oct, 09:10" (an item from before createdAt has only the second) */
  const stamps = (/** @type {Item} */ item) => [['Added', item.createdAt], ['Changed', item.updatedAt]]
    .filter(([, t]) => num(t)).map(([w, t]) => `${w} ${when.format(num(t))}`).join(' · ');
  const toasts = toaster($('toasts'));
  const toast = toasts.show;
  const loading = loadState($('items-state'));   // skeleton rows until the list first arrives
  if (!$('items').children.length) loading.loading();   // (rows from the last visit are already up: app.js)
  const files = modules.itemFiles?.({ app, toast });
  const sheet = itemSheet(app, toast, undoToast(toasts), files);
  const empty = emptyState($('empty'), { title: 'Nothing here yet', hint: 'Items you add show up here.', action: { label: 'Add the first item', onClick: () => input('new-text').focus() } });
  conflictSheet($('conflict-sheet'), { sync: app.sync, text: itemText });
  refusedList($('refused-list'), { sync: app.sync, kind: COLL, text: itemText });
  $('add').addEventListener('submit', async e => {
    e.preventDefault();
    const text = input('new-text').value.trim();
    if (!text) return;
    // clear the box now, not after the save: on a slow network the next item may be typed while this one saves
    // (a refused save is kept in the refused list, not in the box)
    input('new-text').value = '';
    let refused;
    try { refused = await app.add(text); }
    catch (err) { if (!input('new-text').value) input('new-text').value = text; throw err; }   // not saved: give it back
    toast(refused ? REFUSED : 'Added');
  });

  const screen = sectionScreen('list-view', s => {
    const could = canWrite;
    canWrite = s.role === 'admin' || s.role === 'member';
    $('add').hidden = !canWrite;
    // (a screen change is a view transition, so the list can be drawn before the role arrives)
    if (canWrite !== could) draw(all, new Set());
  });
  /** @param {Item[]} items @param {Set<string>} changed */
  const draw = (items, changed) => {
    all = items; filter?.feed(items);
    loading.done();
    const list = visible();
    $('items').replaceChildren(...list.map(item => {
      const li = document.createElement('li'), b = document.createElement('button');
      b.type = 'button'; b.textContent = item.text; b.disabled = !canWrite;
      b.addEventListener('click', () => sheet.open(item));
      const thumbs = files?.thumbs(item);
      if (thumbs) b.append(thumbs);
      const meta = stamps(item);
      li.classList.toggle('changed', changed.has(item.id));
      li.append(b);
      // (beside the button, not in it: the button's name stays the item's text)
      if (meta) { const s = document.createElement('small'); s.className = 'item-when'; s.textContent = meta; li.append(s); }
      return li;
    }));
    $('count').textContent = list.length === items.length ? `${items.length} ${items.length === 1 ? 'item' : 'items'}` : `${list.length} of ${items.length} items`;
    empty.show(items.length === 0 && canWrite);
  };
  app.settings.watch('sort', () => draw(all, new Set()));
  const api = {
    ...screen,
    /** @param {Item[]} items @param {Set<string>} changed  ids changed (here or elsewhere) since the last draw */
    draw,
    /** @returns {Item[]} all the items in this device's sort order (what the next start paints first) */
    shown: () => [...all].sort(ORDER[app.settings.get('sort')] ?? ORDER.text),
    /** @param {Map<string, unknown[]>} by  every item's files */
    drawFiles(by) { files?.feed(by); draw(all, new Set()); sheet.redraw(); },
  };
  return api;
}
