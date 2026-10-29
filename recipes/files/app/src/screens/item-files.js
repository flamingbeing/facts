// The files recipe's screen side (recipes/files.json): it fills the list's "itemFiles" slot (modules.js). The list row
// shows an item's thumbnails; the edit sheet lists its photos and files under the text, with Add, open and Remove.
import { confirmModal } from '@core/ui';
import { thumbOf, attachmentRows } from './attachments.js';

/** @typedef {import('../files-data.js').Attachment} Attachment */
/** @typedef {import('../cloud.js').Item} Item */

/** @type {import('./list.js').ItemFilesSlot} */
export function itemFiles({ app, toast }) {
  /** @type {Map<string, Attachment[]>} */
  let by = new Map();
  const of = (/** @type {string} */ id) => by.get(id) || [];

  /** the edit sheet's part: a list, an Add button and a hidden picker; -> redraw it */
  function mount(/** @type {HTMLElement} */ slot, /** @type {() => Item | null} */ editing) {
    const ul = document.createElement('ul'), add = document.createElement('button'), pick = document.createElement('input');
    ul.id = 'edit-files'; ul.className = 'files'; ul.hidden = true; ul.setAttribute('aria-label', 'Photos and files');
    add.id = 'edit-attach'; add.type = 'button'; add.textContent = 'Add photo or file';
    pick.id = 'edit-file'; pick.type = 'file'; pick.multiple = true; pick.hidden = true;
    slot.replaceChildren(ul, add, pick);
    add.addEventListener('click', () => pick.click());
    pick.addEventListener('change', async () => {
      const picked = [...(pick.files || [])], item = editing();
      pick.value = '';
      if (!item || !picked.length) return;
      try {
        for (const file of picked) await app.files.add(file, { extra: { item: item.id } });
        toast(picked.length > 1 ? `${picked.length} files added` : 'File added');
      } catch (e) {
        toast(/** @type {{ code?: string }} */ (e)?.code === 'too-big' ? 'That file is too big.' : 'Could not add the file.');
      }
    });
    return () => {
      const item = editing();
      if (!item) return;
      const list = of(item.id);
      ul.replaceChildren(...attachmentRows(app, list, async f => {
        if (!await confirmModal(`Remove ${f.name}?`, { title: 'Remove file', danger: true, yes: 'Remove' })) return;
        await app.files.remove(f);
        toast('Removed');
      }));
      ul.hidden = list.length === 0;
    };
  }

  return {
    feed(next) { by = /** @type {Map<string, Attachment[]>} */ (next); },
    of,
    thumbs(item) {
      const attached = of(item.id);
      if (!attached.length) return null;
      // decorative here (the sheet names them), so the button's name stays the item's text
      const thumbs = document.createElement('span');
      thumbs.className = 'thumbs'; thumbs.setAttribute('aria-hidden', 'true');
      const others = attached.filter(f => !f.thumb).length;
      thumbs.append(...attached.flatMap(f => thumbOf(app, f, '') || []), ...(others ? [`📎${others > 1 ? others : ''}`] : []));
      return thumbs;
    },
    mount,
  };
}
