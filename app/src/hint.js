// A note on this device of whether the last visit ended signed in, and the list as it was last drawn, so the next start
// can show the list at once (read-only) instead of the sign-in screen or a blank page while Firebase restores the sign-in.
// A hint only: cloud.js still decides from the real sign-in, and clears both when that says signed out (sign-out, another
// account, "Forget this device"). The list is already on this device, in the engine's own store; this copy is the page's own
// small snapshot of what it showed, at most LIMIT rows.
const KEY = 'app:signed-in', LIST = 'app:last-list', LIMIT = 100;

/** @returns {boolean} */
export function lastSignedIn() {
  try { return localStorage.getItem(KEY) === '1'; } catch { return false; }
}

/** @param {boolean} yes  false also forgets the snapshot of the list */
export function setHint(yes) {
  try { if (yes) localStorage.setItem(KEY, '1'); else { localStorage.removeItem(KEY); localStorage.removeItem(LIST); } } catch { /* no storage: no hint */ }
}

/** @typedef {{ id: string, text: string, createdAt?: number, updatedAt?: number }} Row */

/** @param {import('./items.js').Item[]} items  the list as it was drawn, in order */
export function keepList(items) {
  try {
    const rows = items.slice(0, LIMIT).map(({ id, text, createdAt, updatedAt }) => ({ id, text, createdAt, updatedAt }));
    localStorage.setItem(LIST, JSON.stringify(rows));
  } catch { /* no storage, or full: the next start waits for the real list */ }
}

/** @returns {Row[]} */
export function keptList() {
  try {
    const rows = JSON.parse(localStorage.getItem(LIST) || '[]');
    return Array.isArray(rows) ? rows.filter(r => r && typeof r.id === 'string' && typeof r.text === 'string') : [];
  } catch { return []; }
}
