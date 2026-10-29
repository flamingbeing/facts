// Drafts: an unsent editor kept in the browser's storage so a reload (or the phone unloading the page) finds it again; a
// draft left by an earlier document, such as after a crash, is listed by listDrafts for the app to offer back. Where
// storage is blocked, reading it throws: then reads find nothing and save() throws, so the caller can say the draft
// isn't kept. Each document owns its own slot: a reload restores that slot, other tabs keep their own, and a duplicated
// tab (which inherits sessionStorage) copies on open, so two documents never overwrite one another.

/** @typedef {{ getItem(k: string): string | null, setItem(k: string, v: string): void, removeItem(k: string): void }} DraftStore */

/** @type {DraftStore} */
const NONE = Object.freeze({ getItem: () => null, setItem() { throw new Error('storage unavailable'); }, removeItem() {} });
/** @param {'localStorage' | 'sessionStorage'} name @returns {DraftStore} */
const store = name => { try { return /** @type {DraftStore | undefined} */ (globalThis[name]) || NONE; } catch { return NONE; } };

/**
 * @param {string} prefix  the app's own storage prefix
 * @param {string} owner  what the draft belongs to (an account id, a form name)
 * @param {{ storage?: DraftStore, session?: DraftStore, move?: boolean }} [o]  storage: where drafts live (default
 *   localStorage); session: where this document remembers its slot (default sessionStorage); move: the old slot is taken
 *   over, not copied (one draft at a time); a hidden or closing page puts it down for the next document to take
 * @returns {{ key: string, initial: unknown, release: () => void, save: (value: unknown) => void, clear: () => void, stop: () => void }}
 *   initial: the draft found on open (null: none); save throws where storage is blocked; stop: removes the page listeners
 *   (when the editor closes)
 */
export function draftSlot(prefix, owner, { storage = store('localStorage'), session = store('sessionStorage'), move = false } = {}) {
  const pointer = `${prefix}:active:${owner}`;
  /** @type {string | null} */
  let previous = null;
  try { previous = session.getItem(pointer); } catch { /* storage may be denied */ }
  const key = `${prefix}:${owner}:${Date.now().toString(36)}:${Math.random().toString(36).slice(2)}`;
  /** @param {string} k  a slot's key: the key that says its document set it down */
  const released = k => `${prefix}:released:${k.slice(prefix.length + 1)}`;
  const from = previous || `${prefix}:${owner}`;
  /** @type {unknown} */
  let initial = null;
  try { initial = JSON.parse(storage.getItem(from) || 'null'); } catch { /* readable storage unavailable */ }
  const remember = () => { try { session.setItem(pointer, key); } catch { /* the draft stays listed for recovery */ } };
  if (initial !== null) {
    try {
      storage.setItem(key, JSON.stringify(initial));
      remember();
      // the old slot moves over rather than staying behind as a copy (each reload would leave one); a slot another
      // document still holds (a duplicated tab) stays
      if (move && (!previous || storage.getItem(released(from)) != null)) { storage.removeItem(from); storage.removeItem(released(from)); }
    } catch { /* keep the previous pointer until a successful write */ }
  }
  const release = () => { try { storage.setItem(released(key), '1'); } catch { /* as above */ } };
  const hold = () => { try { storage.removeItem(released(key)); } catch { /* as above */ } };
  const onVisible = () => (document.visibilityState === 'hidden' ? release() : hold());
  const watching = move && typeof document !== 'undefined' && typeof addEventListener === 'function';
  if (watching) {
    addEventListener('pagehide', release);
    document.addEventListener('visibilitychange', onVisible);
  }
  return {
    key, initial, release,
    stop() {
      if (!watching) return;
      removeEventListener('pagehide', release);
      document.removeEventListener('visibilitychange', onVisible);
    },
    save(value) { storage.setItem(key, JSON.stringify(value)); remember(); hold(); },
    clear() { storage.removeItem(key); hold(); },
  };
}

/**
 * The drafts left behind for an owner (unfinished work from earlier documents).
 * @param {string} prefix @param {string} owner
 * @param {DraftStore} [storage]
 * @returns {{ key: string, value: unknown }[]}
 */
export function listDrafts(prefix, owner, storage = store('localStorage')) {
  const own = `${prefix}:${owner}:`;
  return Object.keys(storage).filter(k => k.startsWith(own)).flatMap(key => {
    try { return [{ key, value: JSON.parse(storage.getItem(key) || 'null') }]; } catch { return []; }
  });
}
