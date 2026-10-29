// Shrinking tab bar: nav.ui-tabbar[data-minimise] shrinks to the current tab while the page scrolls down and comes
// back on a scroll up, near the top, or a tap on the current tab. It never moves with a swipe (the edge swipe moves
// the screen's content only).
import { listeners } from './gesture.js';

/** -> the next accumulated scroll and whether the bar is small, from the last state and a scroll step (pure) */
export function tabBarStep(/** @type {{ acc: number, small: boolean }} */ s, /** @type {number} */ y, /** @type {number} */ d) {
  const acc = (d > 0) === (s.acc > 0) ? s.acc + d : d;
  if (y < 40 || acc < -24) return { acc, small: false };
  if (acc > 40) return { acc, small: true };
  return { acc, small: s.small };
}

/**
 * @param {HTMLElement} bar  nav.ui-tabbar
 * @param {{ scroller?: HTMLElement | Window }} [opts]  what scrolls (default the page)
 * @returns {() => void} stop
 */
export function shrinkingTabBar(bar, { scroller = window } = {}) {
  const l = listeners();
  const y = () => scroller instanceof Window ? scroller.scrollY : scroller.scrollTop;
  let last = y(), s = { acc: 0, small: false };
  l.on(scroller, 'scroll', () => {
    const now = y();
    s = tabBarStep(s, now, now - last);
    last = now;
    bar.classList.toggle('is-minimised', s.small);
  }, { passive: true });
  l.on(bar, 'click', (/** @type {MouseEvent} */ e) => {
    const t = /** @type {Element} */ (e.target);
    if (bar.classList.contains('is-minimised') && t.closest('[aria-current="page"]')) {
      e.preventDefault();
      s = { acc: 0, small: false };
      bar.classList.remove('is-minimised');
    }
  });
  return () => { l.stop(); bar.classList.remove('is-minimised'); };
}
