// Align's and Test's deck: one card at a time, the next one below. Swipe up for the next card, down for the one
// before. The browser does the scrolling itself (scroll-snap while a finger is on it, one card per swipe), so it feels like any list on the
// phone. Sideways swipes are left to the tab pager, so a swipe left or right on a card changes the tab, as it does
// anywhere else. It has the same API as the kit's cardPager (index, go, refresh, stop), which it replaced on these
// two screens. It keeps three slots: the card before, this one and the next. When a scroll lands on a neighbour, the
// far slot moves to the other end and the scroll is set back by the same amount in the same frame, so nothing
// visibly jumps. The card he is on is never rebuilt, so a flipped card stays flipped.
// onShow waits until the scroll has settled and the finger has lifted (afterGesture), as the kit's does.
// A card taller than the stage is scrolled through before the next one comes up.
import { afterGesture } from '@core/ui';

/** @typedef {import('app-ui/ui/card-pager.js').CardPager} CardPager */

const SETTLE = 120;   // ms with no scroll before a landing counts (scrollend where the browser has it)

/**
 * @param {HTMLElement} stage
 * @param {{ card: (i: number) => HTMLElement | null, start?: number, onShow?: (i: number) => void, fill?: boolean }} o
 * @returns {CardPager}
 */
export function vPager(stage, { card, start = 0, onShow, fill: fills = false }) {
  stage.classList.add('v-cards');
  const fit = fills ? fillHeight(stage) : null;
  const tabbed = !stage.hasAttribute('tabindex');
  if (tabbed) stage.tabIndex = 0;
  let i = start, on = true;
  /** @type {number | null} */
  let told = null;
  /** previous, this, next (in page order) */
  const slots = [0, 1, 2].map(() => {
    const s = document.createElement('div');
    s.className = 'v-card-slot';
    stage.append(s);
    return s;
  });

  /** @param {number} k @param {number} at */
  const fill = (k, at) => {
    const c = card(at);
    slots[k].replaceChildren(...(c ? [c] : []));
    slots[k].hidden = !c;
  };
  const mark = () => slots.forEach((s, k) => { if (k === 1) s.removeAttribute('aria-hidden'); else s.setAttribute('aria-hidden', 'true'); });
  // the stage's scroll to the top of this card, at once
  const centre = () => { stage.scrollTop = slots[1].offsetTop; };   // (the stage is the slots' offsetParent: app.css)
  const tell = () => {
    const at = i;
    afterGesture(() => { if (on && at === i && at !== told) { told = at; onShow?.(at); } });
  };

  // the slot whose top edge is at or above the stage's top: the card in view (a tall card counts until it has gone)
  const inView = () => {
    const top = stage.scrollTop + 2;
    let k = 1;
    for (let j = 0; j < 3; j++) if (!slots[j].hidden && slots[j].offsetTop <= top) k = j;
    return k;
  };

  // a scroll has landed: on a neighbour, the slots turn so this card is in the middle again
  const landed = () => {
    if (!on) return;
    const k = inView(), s = slots[k];
    // left between two cards (the snap is only proximity): settle on the nearer edge, and land again from there
    const into = stage.scrollTop - s.offsetTop, over = Math.max(0, s.offsetHeight - stage.clientHeight);
    if (into > over + 1) {
      const top = into - over < s.offsetHeight - into ? s.offsetTop + over : s.offsetTop + s.offsetHeight;
      stage.scrollTo({ top, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
      scrolled();
      return;
    }
    if (k === 1) { snap(false); return; }
    const step = k === 2 ? 1 : -1, before = stage.scrollTop - slots[k].offsetTop;   // how far into that card he is
    i += step;
    if (step > 0) { const s = /** @type {HTMLDivElement} */ (slots.shift()); slots.push(s); stage.append(s); fill(2, i + 1); }
    else { const s = /** @type {HTMLDivElement} */ (slots.pop()); slots.unshift(s); stage.prepend(s); fill(0, i - 1); }
    stage.scrollTop = slots[1].offsetTop + before;
    mark();
    snap(false);
    tell();
  };

  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let quiet;
  const scrolled = () => { clearTimeout(quiet); quiet = setTimeout(landed, SETTLE); };
  const ended = () => { clearTimeout(quiet); landed(); };
  stage.addEventListener('scroll', scrolled, { passive: true });
  stage.addEventListener('scrollend', ended);
  // the browser's snap helps a swipe land on one card; it is on only from a touch until the scroll lands (app.css)
  // (an inline style, not a class: only the stage's own style is recalculated, not every card's, mid-swipe)
  /** @param {boolean} to */
  const snap = to => { stage.style.scrollSnapType = to ? 'y proximity' : ''; };
  const touch = () => snap(true);
  stage.addEventListener('touchstart', touch, { passive: true });
  stage.addEventListener('touchend', scrolled, { passive: true });

  /** @param {KeyboardEvent} e */
  const key = e => {
    if (e.target !== stage) return;
    const step = e.key === 'ArrowDown' || e.key === 'PageDown' ? 1 : e.key === 'ArrowUp' || e.key === 'PageUp' ? -1 : 0;
    if (step && api.go(/** @type {1 | -1} */ (step))) e.preventDefault();
  };
  stage.addEventListener('keydown', key);

  /** @type {CardPager} */
  const api = {
    index: () => i,
    go(step) {
      const to = slots[step > 0 ? 2 : 0];
      if (to.hidden) return false;
      // a button's step jumps and the card slides in (transform and opacity only); a smooth scroll begun in a click is
      // dropped by some browsers, and fights a scroll the stage is still settling from
      stage.scrollTop = to.offsetTop;
      const c = to.firstElementChild;
      if (c && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
        c.animate([{ transform: `translateY(${step * 1.5}rem)`, opacity: 0.4 }, { transform: 'none', opacity: 1 }], { duration: 180, easing: 'ease-out' });
      }
      ended();   // lands now: an instant scroll fires no scrollend everywhere
      return true;
    },
    refresh() {
      fill(1, i);
      if (slots[1].hidden) { const c = card(i - 1); if (c) { i--; slots[1].replaceChildren(c); slots[1].hidden = false; } }   // the queue shrank
      fill(0, i - 1); fill(2, i + 1);
      centre(); mark();
      told = null; tell();
    },
    stop() {
      on = false; clearTimeout(quiet);
      stage.removeEventListener('scroll', scrolled); stage.removeEventListener('scrollend', ended); stage.removeEventListener('keydown', key);
      stage.removeEventListener('touchstart', touch); stage.removeEventListener('touchend', scrolled);
      fit?.();
      for (const s of slots) s.remove();
      stage.classList.remove('v-cards'); snap(false);
      if (tabbed) stage.removeAttribute('tabindex');
    },
  };
  api.refresh();
  return api;
}

// fill: the stage's top on the page as --ui-cards-top (the kit's variable and rule, app.css), measured again when
// what is above it or the window changes size. Hidden (another tab), it waits: showing it again is a size change too.
/** @param {HTMLElement} stage @returns {() => void} stop */
function fillHeight(stage) {
  stage.classList.add('v-cards-fill');
  let top = '';
  const measure = () => {
    if (!stage.getClientRects().length) return;
    const t = `${Math.round(stage.getBoundingClientRect().top + scrollY)}px`;
    if (t !== top) stage.style.setProperty('--ui-cards-top', top = t);
  };
  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null;
  ro?.observe(stage);
  if (stage.parentElement) ro?.observe(stage.parentElement);
  addEventListener('resize', measure);
  measure();
  return () => {
    ro?.disconnect(); removeEventListener('resize', measure);
    stage.classList.remove('v-cards-fill'); stage.style.removeProperty('--ui-cards-top');
  };
}
