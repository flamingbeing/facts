// Tab pages: each tab ([data-tab-page="#id"] on a button or link in nav.ui-tabbar, and on the side bar's links) shows
// one .ui-screen of the page's .ui-screens as the bottom screen (screens.js base); the tab with aria-current="page"
// starts. A tab without data-tab-page (one that opens a sheet) is left alone and is no swipe stop. Each page keeps
// its own scroll; tapping the current tab with a screen pushed over it goes back to the page. The host sends "ui-tab"
// (detail.page, detail.tab) after each change.
// On a phone (< 600 px) a sideways swipe on the content moves to the next or previous page, the pages following the
// finger (a pager); past a third of the width or a flick, it goes. Never on a pushed screen, in a field, editor,
// sideways scroller, dialog, sheet or open menu, in select mode, with text selected, or within EDGE px of either edge
// (the system's Back gestures and screens.js's edge swipe). A mostly vertical move scrolls instead. Less motion: the
// swipe switches without the slide. Off: data-swipe="off" on the tab bar (or <html>), or { swipe: false }.
// A tapped tab (or side link) slides its page in from the side it sits on in the tab bar (SLIDE_MS, the logbook's
// page motion), at every width. Less motion: it just switches. Off: data-slide="off" on the tab bar (or <html>), or
// { slide: false }.
import { still, noGesture, listeners, velocity } from './gesture.js';
import { EDGE, swipeGoesBack } from './screens.js';
import { TABLET_MIN } from './shell/shell.js';

/** A first move's direction (pure): 'x' a sideways swipe, 'y' a scroll, null not far enough to tell. A swipe is well
 * under 34° from the horizontal. @param {number} mx @param {number} my */
export function swipeIntent(mx, my) {
  if (Math.max(Math.abs(mx), Math.abs(my)) < 10) return null;
  return Math.abs(mx) > Math.abs(my) * 1.5 ? 'x' : 'y';
}

/** Where a let-go swipe goes (pure): 1 the next page, -1 the previous one, 0 back to this one.
 * @param {number} dx  finger travel, negative = to the left @param {number} v  px/ms, signed like dx
 * @param {number} width @param {boolean} hasPrev @param {boolean} hasNext */
export function pageStep(dx, v, width, hasPrev, hasNext) {
  if (dx < 0 && hasNext && swipeGoesBack(-dx, -v, width)) return 1;
  if (dx > 0 && hasPrev && swipeGoesBack(dx, v, width)) return -1;
  return 0;
}

/** How long a tapped tab's page takes to slide in, in ms. */
export const SLIDE_MS = 280;

/**
 * @param {HTMLElement} bar  nav.ui-tabbar
 * @param {{ screens: { base: (s: HTMLElement) => Promise<void>, depth: () => number }, host: HTMLElement,
 *   root?: ParentNode, swipe?: boolean, slide?: boolean }} o  screens: the page's screen stack; host: its
 *   .ui-screens; root: where the tabs and side links are (default the page)
 * @returns {{ go: (page: string | HTMLElement) => void, current: () => HTMLElement, stop: () => void }}
 */
export function tabPages(bar, { screens, host, root = document, swipe = true, slide = true }) {
  const l = listeners();
  const html = document.documentElement;
  /** one of the host's screens, by selector @param {string | null | undefined} sel @returns {HTMLElement | null} */
  const find = sel => {
    if (!sel) return null;
    try { const p = /** @type {HTMLElement | null} */ (document.querySelector(sel)); return p && p.parentElement === host ? p : null; }
    catch { return null; }
  };
  /** @param {Element | null} t */
  const pageOf = t => find(t?.getAttribute('data-tab-page'));
  // the swipe stops, in the tab bar's order (hidden tabs left out)
  const stops = () => [...new Set(/** @type {HTMLElement[]} */ ([...bar.querySelectorAll('[data-tab-page]')])
    .filter(t => !t.hidden).map(pageOf).filter(p => p !== null))];
  /** @type {HTMLElement} */
  let current = pageOf(bar.querySelector('[data-tab-page][aria-current="page"]')) ?? stops()[0] ?? /** @type {HTMLElement} */ (host.querySelector(':scope > .ui-screen'));
  /** @type {Map<HTMLElement, number>} */
  const ys = new Map();

  function mark() {
    for (const t of root.querySelectorAll('[data-tab-page]')) {
      if (pageOf(t) === current) t.setAttribute('aria-current', 'page'); else t.removeAttribute('aria-current');
    }
  }
  /** @param {string | HTMLElement} target @param {Element | null} [tab] */
  function go(target, tab = null) {
    const page = typeof target === 'string' ? find(target) : target;
    if (!page || page.parentElement !== host) return;
    if (page === current) { if (screens.depth() > 0) void screens.base(page); return; }
    ys.set(current, scrollY);
    const order = stops();
    const dir = Math.sign(order.indexOf(page) - order.indexOf(current));
    current = page;
    mark();
    const y = ys.get(page) ?? 0;
    void screens.base(page).then(() => {
      scrollTo(0, y);
      if (tab && dir && slide && bar.dataset.slide !== 'off' && html.dataset.slide !== 'off' && !still()) slideIn(page, dir);
      host.dispatchEvent(new CustomEvent('ui-tab', { bubbles: true, detail: { page, tab } }));
    });
  }
  /** @type {Animation | null} */
  let sliding = null;
  /** the tapped page comes in from its side (clipped, so the start offset can't widen the page) @param {HTMLElement} page @param {number} dir */
  function slideIn(page, dir) {
    sliding?.cancel();
    host.classList.add('is-sliding');
    const a = sliding = page.animate([{ transform: `translateX(${dir * Math.round(innerWidth * .3)}px)`, opacity: 0 }, { transform: 'none', opacity: 1 }],
      { duration: SLIDE_MS, easing: 'cubic-bezier(.2, .7, .2, 1)' });
    const done = () => { if (sliding === a) { sliding = null; host.classList.remove('is-sliding'); } };
    a.finished.then(done, done);
  }
  mark();
  void screens.base(current);

  l.on(root, 'click', (/** @type {MouseEvent} */ e) => {
    const t = /** @type {Element} */ (e.target).closest?.('[data-tab-page]');
    if (!t || !pageOf(t)) return;
    e.preventDefault();
    go(/** @type {HTMLElement} */ (pageOf(t)), t);
  });

  // the swipe
  const on = () => swipe && innerWidth < TABLET_MIN && bar.dataset.swipe !== 'off' && html.dataset.swipe !== 'off';
  /** @type {number | null} */
  let x0 = null;
  let y0 = 0, dx = 0, w = 0, busy = false;
  /** @type {'x' | 'y' | null} */
  let dir = null;
  /** @type {[number, number][]} */
  let hist = [];
  /** @type {HTMLElement | null} */
  let prev = null;
  /** @type {HTMLElement | null} */
  let next = null;
  const place = () => {
    current.style.transform = `translateX(${dx}px)`;
    if (prev) prev.style.transform = `translateX(${dx - w}px)`;
    if (next) next.style.transform = `translateX(${dx + w}px)`;
  };
  function begin() {
    const all = stops(), i = all.indexOf(current);
    prev = all[i - 1] ?? null; next = all[i + 1] ?? null;
    w = host.clientWidth || innerWidth;
    if (still()) return;
    host.classList.add('is-paging');
    for (const n of [prev, next]) {
      if (!n) continue;
      n.hidden = false;
      n.classList.add('is-beside');
      n.style.top = `${scrollY - (ys.get(n) ?? 0)}px`;   // where it will be once shown at its own scroll
    }
  }
  function unpage() {
    host.classList.remove('is-paging');
    current.style.transform = '';
    for (const n of [prev, next]) {
      if (!n) continue;
      n.classList.remove('is-beside');
      n.style.transform = ''; n.style.top = '';
      if (n !== current) n.hidden = true;
    }
  }
  l.on(document, 'touchstart', (/** @type {TouchEvent} */ e) => {
    x0 = null;
    if (!on() || busy || e.touches.length > 1 || screens.depth() > 0 || !current) return;
    const t = e.touches[0];
    if (t.clientX <= EDGE || t.clientX >= innerWidth - EDGE) return;
    if (!current.contains(/** @type {Node} */ (e.target)) || noGesture(e.target)) return;
    if (html.classList.contains('ui-menu-open') || document.querySelector('dialog[open]') || host.querySelector('.is-editing')) return;
    const sel = getSelection();
    if (sel && !sel.isCollapsed) return;
    x0 = t.clientX; y0 = t.clientY; dx = 0; dir = null; hist = [[e.timeStamp, t.clientX]];
  }, { passive: true });
  l.on(document, 'touchmove', (/** @type {TouchEvent} */ e) => {
    if (x0 === null) return;
    const t = e.touches[0], mx = t.clientX - x0;
    if (!dir) {
      dir = swipeIntent(mx, t.clientY - y0);
      if (!dir) return;
      if (dir === 'y') { x0 = null; return; }   // a scroll: leave it to the page
      begin();
    }
    if (e.cancelable) e.preventDefault();
    // no page that way: the page gives a little, then holds
    dx = (mx < 0 && !next) || (mx > 0 && !prev) ? mx / 3 : mx;
    hist.push([e.timeStamp, t.clientX]);
    if (hist.length > 5) hist.shift();
    if (!still()) place();
  }, { passive: false });
  const end = async () => {
    if (x0 === null) return;
    x0 = null;
    if (dir !== 'x') return;
    const step = pageStep(dx, velocity(hist), w, !!prev, !!next);
    const to = step === 1 ? next : step === -1 ? prev : null;
    if (still() || !host.classList.contains('is-paging')) { if (to) go(to); return; }
    busy = true;
    const last = step === 1 ? -w : step === -1 ? w : 0;
    const glide = (/** @type {HTMLElement} */ el, /** @type {number} */ off) => el.animate(
      [{ transform: `translateX(${dx + off}px)` }, { transform: `translateX(${last + off}px)` }],
      { duration: 280, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'forwards' }).finished.catch(() => {});
    /** @type {[HTMLElement, number][]} */
    const moving = [];
    for (const [el, off] of /** @type {[HTMLElement | null, number][]} */ ([[current, 0], [prev, -w], [next, w]])) if (el) moving.push([el, off]);
    await Promise.all(moving.map(([el, off]) => glide(el, off)));
    unpage();
    if (to) go(to);
    for (const [el] of moving) el.getAnimations().forEach(a => a.cancel());
    busy = false;
  };
  l.on(document, 'touchend', end, { passive: true });
  l.on(document, 'touchcancel', end, { passive: true });

  return { go, current: () => current, stop: () => { l.stop(); unpage(); } };
}
