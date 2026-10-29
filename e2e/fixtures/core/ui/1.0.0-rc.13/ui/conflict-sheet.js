// The conflict "pick one" sheet: a button (#attention) while this phone holds saves that met an edit from another
// device, opening a sheet (#conflicts) with both versions of each side by side, when each changed (SGT) and who changed
// it (name, device). Keep mine / keep theirs for the whole record; with several clashing fields, one pick per field too.
import { el, button, plural } from './dom.js';

/** @param {unknown} v */
const asWords = v => v && typeof v === 'object' ? JSON.stringify(v) : String(v ?? '');

/** @param {string} title @param {import('./types').Side} side @param {string} words */
function sideBox(title, side, words) {
  const meta = [side.when, [side.by, side.device].filter(Boolean).join(', ')].filter(Boolean).join(' · ');
  return el('div', {}, el('h3', {}, title), el('p', {}, `“${words}”`), el('p', { class: 'ui-small small' }, meta || 'time and author unknown'));
}

/**
 * @param {import('./types').SyncApi} sync
 * @param {import('./types').Conflict} c
 */
function fieldPicks(sync, c) {
  /** @type {Record<string, import('./types').Pick>} */
  const picks = {};
  const keep = button('Keep these choices', () => sync.resolve(c.key, picks));
  keep.disabled = true;
  const rows = c.fields.map(f => {
    /** @param {import('./types').Pick} which */
    const pick = which => () => { picks[f.path] = which; keep.disabled = c.fields.some(x => !picks[x.path]); };
    return el('div', { class: 'ui-inline row' },
      el('p', { class: 'ui-small small' }, `${f.path}: yours “${f.mine.value}” (${f.mine.when}) · theirs “${f.theirs.value}” (${f.theirs.when})`),
      button('Mine', pick('mine')), button('Theirs', pick('theirs')));
  });
  return [el('div', {}, ...rows), keep];
}

/**
 * @param {HTMLElement} host  the button and the sheet are added here
 * @param {{ sync: import('./types').SyncApi, text?: (value: unknown) => string, idPrefix?: string }} o
 *   idPrefix: put before each of the part's ids (two on one page, or ids the app already uses)
 *   text: one side's record in words (default: as JSON)
 * @returns {() => void} stop: unsubscribes and removes both
 */
export function conflictSheet(host, { sync, text = asWords, idPrefix = '' }) {
  const open = el('button', { id: `${idPrefix}attention`, type: 'button', class: 'ui-attention attention' });
  const list = el('ul', { id: `${idPrefix}conflict-list`, class: 'ui-conflict-list' });
  const sheet = el('dialog', { id: `${idPrefix}conflicts`, 'aria-labelledby': `${idPrefix}conflicts-title` },
    el('h2', { id: `${idPrefix}conflicts-title` }, 'Changed on another device'),
    el('p', { class: 'ui-small small' }, 'Choose which version to keep. Nothing is lost until you choose.'),
    list,
    el('form', { method: 'dialog' }, el('button', {}, 'Close')));
  host.append(open, sheet);

  /** @param {import('./types').Conflict} c */
  const item = c => el('li', {},
    el('div', { class: 'ui-sides sides' },
      sideBox('Yours', c.mine, c.deleted.mine ? '(deleted)' : text(c.mine.value)),
      sideBox('Other device', c.theirs, c.deleted.theirs ? '(deleted)' : text(c.theirs.value))),
    el('div', { class: 'ui-inline row' }, button('Keep mine', () => sync.resolve(c.key, 'mine')), button('Keep theirs', () => sync.resolve(c.key, 'theirs'))),
    ...(c.fields.length > 1 ? fieldPicks(sync, c) : []));
  const held = () => sync.conflicts().map(c => sync.describe(c.key)).filter(d => d !== null);
  const drawList = () => list.replaceChildren(...held().map(item));
  const draw = () => {
    const n = sync.conflicts().length;
    open.hidden = !n;
    open.textContent = `${plural(n, 'change')} met an edit from another device: choose`;
    if (!n && sheet.open) sheet.close();
    if (sheet.open) drawList();
  };
  open.addEventListener('click', () => { drawList(); sheet.showModal(); });
  const off = sync.queue.onChange(draw);
  draw();
  return () => { off(); open.remove(); sheet.remove(); };
}
