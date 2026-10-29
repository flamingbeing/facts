// Browser history for an app's screens ("tabs" named by the page): Back returns to the screen you came from, with its
// scroll position. Only screen names and scroll positions go into history, never account details or data. A direct
// link to a deep screen gets a short trail of its parents, so Back walks up instead of leaving. Nothing runs on import.

/**
 * @typedef {{ tab: string, scroll: number }} Step
 * @typedef {{ base: string, tab: string, trail: Step[], scroll: number }} NavState
 * @typedef {{ history: History, location: Pick<Location, 'pathname' | 'search' | 'hash'>,
 *   parents: Record<string, string>, allowed: (tab: string) => boolean, onNavigate: (tab: string, scroll: number) => void,
 *   getScroll?: () => number }} NavOptions  parents: each screen's parent; allowed: whether a name is a screen;
 *   onNavigate: the page shows that screen and restores the scroll
 */

/** @param {NavOptions} o */
export function createNavigation({ history, location, parents, allowed, onNavigate, getScroll = () => 0 }) {
  const base = () => location.pathname + location.search;
  /** @param {string} tab */
  const url = tab => `${base()}#${tab}`;
  /** @type {NavState | null} */
  let active = null;
  /** @returns {NavState | null} */
  const read = () => {
    const n = history.state?.uiNav;
    return n && n.base === base() && allowed(n.tab) && Array.isArray(n.trail) ? n : null;
  };
  /** @param {NavState} n @param {boolean} [replace] */
  const write = (n, replace = false) => {
    history[replace ? 'replaceState' : 'pushState']({ ...(history.state || {}), uiNav: n }, '', url(n.tab));
    active = n;
  };
  /** @param {string} tab @param {Step[]} [trail] @param {number} [scroll] @returns {NavState} */
  const entry = (tab, trail = [], scroll = 0) => ({ base: base(), tab, trail: trail.slice(-100), scroll });
  /** the trail kept for the screen showing, as a list of steps */
  const trailNow = () => (active ? [...active.trail, { tab: active.tab, scroll: active.scroll }] : []);

  /** @param {string} tab  the screen the page opened on */
  function initialize(tab) {
    const existing = read();
    if (existing && existing.tab === tab) { active = existing; return; }
    // A direct link gets a finite parent trail (for example Layout, Settings, More, then out). The main screens get no
    // artificial entry, so Back at the start can leave normally.
    const chain = [tab], seen = new Set(chain);
    while (parents[chain[0]] && allowed(parents[chain[0]]) && !seen.has(parents[chain[0]])) {
      const parent = parents[chain[0]];
      seen.add(parent);
      chain.unshift(parent);
    }
    write(entry(/** @type {string} */ (chain[0])), true);
    for (const next of chain.slice(1)) write(entry(next, trailNow()));
  }
  function remember() {
    if (!active || location.hash !== `#${active.tab}`) return;
    const current = read();
    if (!current || current.tab !== active.tab) return;
    write({ ...current, scroll: getScroll() }, true);
  }
  /** @param {string} tab @param {{ replace?: boolean }} [o] @returns {boolean} whether it went */
  function go(tab, { replace = false } = {}) {
    if (!allowed(tab) || active?.tab === tab) return false;
    remember();
    write(entry(tab, replace ? active?.trail || [] : trailNow()), replace);
    onNavigate(tab, 0);
    return true;
  }
  /** call after a native hash change (a link) so history and the screen agree @param {string} tab */
  function sync(tab) {
    if (!allowed(tab)) return;
    const changed = active?.tab !== tab;
    let n = read();
    if (!n || n.tab !== tab) {
      // A native hash change already pushed an entry: tag it rather than adding a second one for the same click.
      n = entry(tab, trailNow());
      write(n, true);
    }
    active = n;
    if (changed) onNavigate(tab, n.scroll || 0);
  }
  /** @param {string} [parent] @returns {string | undefined} where Back would go */
  function backTarget(parent) {
    const previous = active?.trail.at(-1)?.tab;
    return previous && allowed(previous) ? previous : parent;
  }
  /** Back: the screen you came from, else the parent @param {string} [parent] */
  function back(parent) {
    const previous = active?.trail.at(-1)?.tab;
    if (previous && allowed(previous)) history.back();
    else if (parent) go(parent, { replace: true });
  }
  return { initialize, go, sync, remember, back, backTarget };
}
