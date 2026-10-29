// A note on this device of whether the last visit ended signed in, so the next start can show Align's frame at once
// instead of the sign-in screen or a blank page while Firebase restores the sign-in. A hint only: cloud.js still decides
// from the real sign-in, and clears it when that says signed out (sign-out, another account, "Forget this device").
const KEY = 'app:signed-in', LIST = 'app:last-list';   // (LIST: the old list snapshot, cleared with the hint)

/** @returns {boolean} */
export function lastSignedIn() {
  try { return localStorage.getItem(KEY) === '1'; } catch { return false; }
}

/** @param {boolean} yes */
export function setHint(yes) {
  try { if (yes) localStorage.setItem(KEY, '1'); else { localStorage.removeItem(KEY); localStorage.removeItem(LIST); } } catch { /* no storage: no hint */ }
}
