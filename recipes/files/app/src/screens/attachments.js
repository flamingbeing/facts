// An item's photos and files (@core/files), for the list's thumbnails and the edit sheet. A photo shows its thumbnail
// from this device's cache, or fetched once uploaded; one not uploaded yet from another device shows its name until
// its record says it is stored (the next draw tries again).

/** @typedef {import('../files-data.js').Attachment} Attachment */
/** @typedef {import('../cloud.js').Started} Started */

/**
 * A thumbnail <img> for a photo, or null for any other file. The src fills in when the bytes are here.
 * @param {Started} app @param {Attachment} f @param {string} alt
 */
export function thumbOf(app, f, alt) {
  if (!f.thumb) return null;
  const img = document.createElement('img');
  img.className = 'thumb'; img.alt = alt; img.width = 48; img.height = 48;
  img.dataset.file = f.id;
  app.files.url(f.id, { thumb: true }).then((/** @type {string} */ href) => { img.src = href; }, () => { img.dataset.missing = f.state; });
  return img;
}

/**
 * The edit sheet's list of an item's photos and files: each with its thumbnail, a link that saves it, and Remove.
 * @param {Started} app @param {Attachment[]} list @param {(f: Attachment) => void} onRemove
 * @returns {HTMLElement[]}
 */
export function attachmentRows(app, list, onRemove) {
  return list.map(f => {
    const li = document.createElement('li'), open = document.createElement('a'), rm = document.createElement('button');
    const img = thumbOf(app, f, '');
    open.textContent = f.name; open.href = '#';
    open.addEventListener('click', async e => {
      if (open.dataset.ready) return;
      e.preventDefault();
      try { open.href = await app.files.url(f.id); open.download = f.name; open.dataset.ready = '1'; open.click(); }
      catch { open.textContent = `${f.name} (not uploaded yet)`; }
    });
    rm.type = 'button'; rm.textContent = 'Remove'; rm.setAttribute('aria-label', `Remove ${f.name}`);
    rm.addEventListener('click', () => onRemove(f));
    li.append(...(img ? [img] : []), open, rm);
    return li;
  });
}
