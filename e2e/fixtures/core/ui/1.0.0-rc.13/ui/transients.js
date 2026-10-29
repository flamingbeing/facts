// Back closes the top dialog: each dialog or editor gets one history entry, so the Back button (or gesture) dismisses
// the newest one first instead of leaving the screen. The state holds opaque ids only, never the dialog's content.
// Nothing runs on import: the page creates it with the browser's history, location and window.

/**
 * @typedef {{ history: History, location: Pick<Location, 'pathname' | 'search' | 'hash' | 'href'>, events: Pick<Window, 'addEventListener'> }} Env
 * @typedef {{ readonly active: boolean, close: () => Promise<void> }} Transient
 * @typedef {{ id: string, dismiss: () => void, active: boolean, pending: Promise<void> | null, resolve?: () => void }} Entry
 */

/**
 * @param {Env} env
 * @returns {{ open: (dismiss: () => void) => Transient, dismissAll: () => Promise<void>, reset: () => void }}
 *   open: adds the entry; dismiss runs when Back (or close) takes it away; close() goes Back for it and resolves once
 *   it has landed; dismissAll closes every one, newest first; reset forgets them without running dismiss (sign-out)
 */
export function createTransients({ history, location, events }) {
  /** @type {Entry[]} */
  const entries = [];
  const base = () => location.pathname + location.search;
  /** @returns {string[]} */
  const ids = () => (history.state?.uiTransient?.base === base() ? history.state.uiTransient.ids || [] : []);
  let serial = 0;
  /** @param {Entry} entry */
  function finish(entry) {
    if (!entry.active) return;
    entry.active = false;
    entries.splice(entries.indexOf(entry), 1);
    try { entry.dismiss(); } finally { entry.resolve?.(); }
  }
  function sync() {
    const present = new Set(ids());
    for (const entry of [...entries].reverse()) if (!present.has(entry.id)) finish(entry);
  }
  // A close's history.back() lands later (WebKit: much later). A page opened in between (location.hash = …) is pushed
  // on top of the closing entry, so the late step lands on that entry and would undo the newer page. Each step on its
  // way is kept here; when one lands on its own closing entry, the newer page is put back without a new entry.
  /** @type {{ id: string, from: string, to: string | null, at: number }[]} */
  const steps = [];
  const href = () => location.href ?? location.pathname + location.search + location.hash;
  /** @param {string} id */
  function goBack(id) { steps.push({ id, from: href(), to: null, at: Date.now() }); history.back(); }
  function repair() {
    // Chromium fires popstate for a hash change too, so a popstate isn't always the step: each step is matched by
    // where it lands (its own closing entry: undo it; the address it left from: landed as asked; else still to come)
    for (const step of [...steps]) {
      const here = ids(), own = here.includes(step.id);
      if (Date.now() - step.at > 10000) { steps.splice(steps.indexOf(step), 1); continue; }   // never landed
      if (!own && href() !== step.from) continue;
      steps.splice(steps.indexOf(step), 1);
      if (!own) continue;
      const state = { ...(history.state || {}), uiTransient: { base: base(), ids: here.slice(0, here.indexOf(step.id)) } };
      if (step.to) history.replaceState(state, '', step.to);
      else { history.replaceState(state, '', href()); history.forward(); }   // the newer page's address went unseen: step to it
    }
  }
  events.addEventListener('popstate', () => { repair(); sync(); }, true);
  events.addEventListener('hashchange', e => {
    const to = /** @type {HashChangeEvent | undefined} */ (e)?.newURL || href();
    for (const step of steps) if (to !== step.from) step.to = to;
    sync();
  }, true);

  /** @param {() => void} dismiss */
  function open(dismiss) {
    const previous = ids(), inherited = previous.at(-1);
    const reuse = inherited && !entries.some(x => x.id === inherited);
    const id = reuse ? inherited : `view-${Date.now().toString(36)}-${++serial}`;
    /** @type {Entry} */
    const entry = { id, dismiss, active: true, pending: null };
    if (!reuse) history.pushState({ ...(history.state || {}), uiTransient: { base: base(), ids: [...ids(), id] } }, '', location.pathname + location.search + location.hash);
    entries.push(entry);
    return {
      get active() { return entry.active; },
      close() {
        if (!entry.active) return Promise.resolve();
        if (entry.pending) return entry.pending;
        if (ids().at(-1) !== id) { finish(entry); return Promise.resolve(); }
        entry.pending = new Promise(resolve => { entry.resolve = resolve; });
        goBack(id);
        return entry.pending;
      },
    };
  }
  async function dismissAll() {
    while (entries.length) {
      const entry = /** @type {Entry} */ (entries.at(-1));
      if (entry.pending) await entry.pending;
      else if (ids().at(-1) === entry.id) {
        entry.pending = new Promise(resolve => { entry.resolve = resolve; });
        goBack(entry.id);
        await entry.pending;
      } else finish(entry);
    }
  }
  function reset() {
    // Sign-out: callbacks must not write old content into the next account.
    for (const entry of entries.splice(0)) { entry.active = false; entry.resolve?.(); }
    steps.length = 0;
    history.replaceState({ ...(history.state || {}), uiTransient: { base: base(), ids: [] } }, '', location.pathname + location.search + location.hash);
  }
  return { open, dismissAll, reset };
}
