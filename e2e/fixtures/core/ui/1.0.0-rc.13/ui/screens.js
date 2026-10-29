// Pushed screens with edge-swipe back: .ui-screens holds .ui-screen sections; the first shows, [data-push="#id"]
// pushes another over it (it slides in from the side), and .ui-back or [data-pop] goes back. Each push is a history
// entry, so Back (Android's, the browser's) pops too; the edge swipe moves the top screen with the finger and lets
// the one under show. Only the content moves: bars and the tab bar stay put.
// The edge swipe is on only where the phone has no Back gesture of its own: the iPhone home-screen app (in Safari and
// on Android the system's swipe would fire as well). html[data-edge-back="always"] turns it on everywhere (testing).
// It starts within EDGE px of the left edge and only when the finger moves mostly sideways; past a third of the width
// or a flick, it goes back.
import { still, noGesture, listeners, velocity } from './gesture.js';

export const EDGE = 24;

/** @param {Navigator} [nav] @param {(q: string) => boolean} [media] @param {string | null} [attr]  html[data-edge-back] */
export function edgeBackOn(nav = navigator, media = q => typeof matchMedia === 'function' && matchMedia(q).matches,
  attr = document.documentElement.getAttribute('data-edge-back')) {
  if (attr === 'always') return true;
  if (attr === 'off') return false;
  const ios = /iP(hone|ad|od)/.test(nav.userAgent) || (nav.platform === 'MacIntel' && nav.maxTouchPoints > 1);
  const standalone = /** @type {any} */ (nav).standalone === true || media('(display-mode: standalone)');
  return ios && standalone;
}

/** Whether a let-go swipe goes back (pure). @param {number} dx @param {number} v px/ms @param {number} width */
export const swipeGoesBack = (dx, v, width) => dx > width / 3 || (v > 0.5 && dx > 40);

/**
 * @param {HTMLElement} host  .ui-screens
 * @param {{ onChange?: (top: HTMLElement) => void }} [opts]  onChange: after each push or pop (e.g. largeTitle.watch)
 * @returns {{ push: (target: string | HTMLElement, from?: HTMLElement | null) => void, pop: (animate?: boolean) => void,
 *   depth: () => number, base: (screen: HTMLElement) => Promise<void>, stop: () => void }}  base: tab pages (tab-pages.js)
 */
export function screenStack(host, { onChange } = {}) {
  const l = listeners();
  const all = () => /** @type {HTMLElement[]} */ ([...host.querySelectorAll(':scope > .ui-screen')]);
  // y: where the page was scrolled when the next screen was pushed over this one (back there on the pop)
  /** @type {{ screen: HTMLElement, from: HTMLElement | null, y: number }[]} */
  const stack = [{ screen: all()[0], from: null, y: 0 }];
  all().forEach((s, i) => { s.hidden = i > 0; });
  const top = () => stack[stack.length - 1].screen;

  /** @param {HTMLElement} s */
  function focusIn(s) {
    const h = /** @type {HTMLElement | null} */ (s.querySelector('h1,h2,[data-screen-focus]'));
    const t = h ?? s;
    if (!t.hasAttribute('tabindex')) t.tabIndex = -1;
    t.focus({ preventScroll: true });
  }
  /** @param {HTMLElement} el @param {Keyframe[]} frames */
  const slide = (el, frames) => still() ? Promise.resolve()
    : el.animate(frames, { duration: 340, easing: 'cubic-bezier(.2,.8,.2,1)' }).finished.catch(() => {});

  /** Takes `el` out of the flow (class `cls`) and keeps its content where it was on screen across `change` (a scroll).
   * @param {HTMLElement} el @param {string} cls @param {() => void} change */
  function lift(el, cls, change) {
    const probe = el.firstElementChild ?? el, y0 = probe.getBoundingClientRect().top;
    el.classList.add(cls);
    el.style.top = '0px';
    change();
    el.style.top = `${y0 - probe.getBoundingClientRect().top}px`;
  }

  /** @param {string | HTMLElement} target @param {HTMLElement | null} [from] */
  function push(target, from = null) {
    const s = typeof target === 'string' ? /** @type {HTMLElement | null} */ (host.querySelector(target)) : target;
    if (!s || s === top() || stack.some(x => x.screen === s)) return;
    const under = top();
    stack[stack.length - 1].y = scrollY;
    stack.push({ screen: s, from, y: 0 });
    try { history.pushState({ ...(history.state || {}), uiScreens: stack.length - 1 }, ''); } catch { /* none */ }
    // the new screen slides in over the old one, which leaves the flow and stays where it was on screen
    s.classList.add('is-top');
    under.classList.remove('is-top');
    const show = () => { s.hidden = false; scrollTo(0, 0); onChange?.(s); };   // (onChange may reset the bar)
    if (still()) { show(); under.hidden = true; focusIn(s); return; }   // (no class changes: nothing to transition)
    s.classList.add('is-entering');
    lift(under, 'is-under', show);
    void slide(s, [{ transform: 'translateX(100%)' }, { transform: 'none' }]).then(() => {
      s.classList.remove('is-entering');
      under.classList.remove('is-under');
      under.style.top = '';
      if (top() !== under) under.hidden = true;
    });
    focusIn(s);
  }
  // one step back, shown (the history entry is already gone: popstate, or the caller went back)
  async function popShown(animate = true) {
    if (stack.length < 2) return;
    const gone = /** @type {{ screen: HTMLElement, from: HTMLElement | null, y: number }} */ (stack.pop());
    const s = top();
    // the leaving screen slides off over the one coming back, which is scrolled back to where it was
    s.classList.add('is-top');
    gone.screen.classList.remove('is-top');
    // (onChange first: it may change the bar above the screens, which would move them)
    const back = () => { s.hidden = false; onChange?.(s); scrollTo(0, stack[stack.length - 1].y); };
    if (animate && !still()) {
      lift(gone.screen, 'is-leaving', back);
      await slide(gone.screen, [{ transform: 'none' }, { transform: 'translateX(100%)' }]);
    } else back();
    gone.screen.hidden = true;
    gone.screen.classList.remove('is-leaving');
    gone.screen.style.transform = ''; gone.screen.style.top = '';
    if (gone.from && s.contains(gone.from)) gone.from.focus({ preventScroll: true }); else focusIn(s);
  }
  let skipAnim = false;
  /** @type {{ screen: HTMLElement, done: () => void } | null}  a base waiting for Back to take the pushed screens off */
  let pending = null;
  /** @param {HTMLElement} s */
  function swapBase(s) {
    const old = stack[0].screen;
    if (s === old) return;
    stack[0] = { screen: s, from: null, y: 0 };
    old.hidden = true;
    old.classList.remove('is-top');
    s.hidden = false;
    s.classList.add('is-top');
    onChange?.(s);
  }
  /** Another screen at the bottom of the stack (a tab page, tab-pages.js); anything pushed over the old one goes first,
   * without sliding, its history entries with it. Resolves once it shows. @param {HTMLElement} s */
  function base(s) {
    if (!s || s.parentElement !== host) return Promise.resolve();
    const d = stack.length - 1;
    if (d > 0 && history.state?.uiScreens === d) {
      return /** @type {Promise<void>} */ (new Promise(resolve => { pending = { screen: s, done: () => resolve(undefined) }; skipAnim = true; history.go(-d); }));
    }
    while (stack.length > 1) void popShown(false);
    swapBase(s);
    return Promise.resolve();
  }
  // animate false: the edge swipe has already moved the screen away
  function pop(animate = true) {
    if (stack.length < 2) return;
    if (history.state?.uiScreens === stack.length - 1) { skipAnim = !animate; history.back(); }
    else void popShown(animate);
  }
  l.on(window, 'popstate', () => {
    const want = typeof history.state?.uiScreens === 'number' ? history.state.uiScreens : 0;
    const anim = !skipAnim;
    skipAnim = false;
    while (stack.length - 1 > want) void popShown(anim && stack.length - 2 === want);
    if (pending && stack.length === 1) { const p = pending; pending = null; swapBase(p.screen); p.done(); }
  });
  l.on(host, 'click', (/** @type {MouseEvent} */ e) => {
    const t = /** @type {Element} */ (e.target);
    const b = /** @type {HTMLElement | null} */ (t.closest('[data-push],.ui-back,[data-pop]'));
    if (!b || !host.contains(b)) return;
    e.preventDefault();
    const to = b.getAttribute('data-push');
    if (to) push(to, b); else pop(true);
  });

  // the edge swipe
  if (edgeBackOn()) {
    /** @type {number | null} */
    let x0 = null;
    let y0 = 0, dx = 0, going = false;
    /** @type {[number, number][]} */
    let hist = [];
    /** @type {HTMLElement | null} */
    let moving = null;
    /** @type {HTMLElement | null} */
    let shade = null;
    l.on(document, 'touchstart', (/** @type {TouchEvent} */ e) => {
      const t = e.touches[0];
      x0 = null;
      const on = /** @type {Node} */ (e.target);
      // the screen's edge: on the screens, or on the page beside them when they are narrower than the window
      if (stack.length < 2 || going || e.touches.length > 1 || t.clientX > EDGE) return;
      if (!host.contains(on) && on !== document.body && on !== document.documentElement) return;
      if (noGesture(e.target) || document.documentElement.classList.contains('ui-menu-open')) return;
      x0 = t.clientX; y0 = t.clientY; dx = 0; hist = [[e.timeStamp, t.clientX]]; moving = null;
    }, { passive: true });
    l.on(document, 'touchmove', (/** @type {TouchEvent} */ e) => {
      if (x0 === null) return;
      const t = e.touches[0], mx = t.clientX - x0, my = t.clientY - y0;
      if (!moving) {
        if (Math.abs(my) > Math.abs(mx) && Math.abs(my) > 8) { x0 = null; return; }   // vertical: let it scroll
        if (mx < 8) return;
        moving = top();
        const under = stack[stack.length - 2].screen;
        under.hidden = false;
        if (!shade) { shade = document.createElement('div'); shade.className = 'ui-swipe-shade'; }
        moving.before(shade);
        host.classList.add('is-swiping');
      }
      if (e.cancelable) e.preventDefault();
      dx = Math.max(0, mx);
      hist.push([e.timeStamp, t.clientX]);
      if (hist.length > 5) hist.shift();
      moving.style.transform = `translateX(${dx}px)`;
      /** @type {HTMLElement} */ (shade).style.opacity = String(1 - dx / innerWidth);
    }, { passive: false });
    const end = async () => {
      if (x0 === null) return;
      x0 = null;
      if (!moving) return;
      const m = moving;
      moving = null;
      const done = swipeGoesBack(dx, velocity(hist), innerWidth);
      going = true;
      host.classList.remove('is-swiping');
      shade?.remove();
      if (done) {
        await slide(m, [{ transform: `translateX(${dx}px)` }, { transform: 'translateX(100%)' }]);
        m.hidden = true;
        m.style.transform = '';
        pop(false);
      } else {
        await slide(m, [{ transform: `translateX(${dx}px)` }, { transform: 'none' }]);
        m.style.transform = '';
        stack[stack.length - 2].screen.hidden = true;
      }
      going = false;
    };
    l.on(document, 'touchend', end, { passive: true });
    l.on(document, 'touchcancel', end, { passive: true });
  }
  top().classList.add('is-top');
  return { push, pop, depth: () => stack.length - 1, base, stop: l.stop };
}
