// What every gesture part shares: how long a hold is, how far a finger may wander, which places never start a
// gesture, the device's Still choice and a light haptic tap. Not exported from @core/ui except still() and haptic().

/** a hold: this long (ms) without moving more than SLOP (px) */
export const HOLD_MS = 500;
export const SLOP = 10;

/**
 * Less motion: the device's Reduce Motion, or Still in the theme switch (data-motion="still" on <html>). Read each
 * time, as either can change while the page is open.
 * @returns {boolean}
 */
export function still() {
  if (typeof document !== 'undefined' && document.documentElement.dataset.motion === 'still') return true;
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Places a gesture never starts from: fields, dialogs (outside the sheet part's own handling), drag handles, things
 * that scroll sideways, and anything marked data-no-gesture.
 * @param {EventTarget | null} target
 * @param {{ inDialog?: boolean }} [opts]  inDialog: the caller is a dialog's own part, so dialogs don't count
 */
export function noGesture(target, { inDialog = false } = {}) {
  const t = /** @type {Element | null} */ (target instanceof Element ? target : null);
  if (!t) return true;
  if (t.closest(`input,textarea,select,[contenteditable],[data-no-gesture],[data-drag-handle],.ui-scroll-x${inDialog ? '' : ',dialog'}`)) return true;
  // anything between the target and the page that scrolls sideways keeps the finger
  for (let n = t.parentElement; n && n !== document.body; n = n.parentElement) {
    if (n.scrollWidth > n.clientWidth + 1) {
      const o = getComputedStyle(n).overflowX;
      if (o === 'auto' || o === 'scroll') return true;
    }
  }
  return false;
}

/** @type {HTMLLabelElement | null} */
let tickLabel = null;
/**
 * A light tap: navigator.vibrate where there is one (Android); on iPhone (iOS 18 and later) toggling a hidden
 * <input switch> through its label gives the system's own haptic, the only one a web page can reach there.
 */
export function haptic() {
  if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
    try { navigator.vibrate(10); } catch { /* not allowed now (no user gesture yet) */ }
    return;
  }
  if (typeof document === 'undefined') return;
  if (!tickLabel) {
    tickLabel = document.createElement('label');
    tickLabel.setAttribute('aria-hidden', 'true');
    tickLabel.className = 'ui-haptic';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.setAttribute('switch', '');
    input.tabIndex = -1;
    tickLabel.append(input);
    document.body.append(tickLabel);
  }
  tickLabel.click();
}

/**
 * Adds listeners and gives back one function that removes them all.
 * @returns {{ on: (t: EventTarget, type: string, fn: (e: any) => void, opts?: AddEventListenerOptions | boolean) => void, stop: () => void }}
 */
export function listeners() {
  /** @type {(() => void)[]} */
  const offs = [];
  return {
    on(t, type, fn, opts) { t.addEventListener(type, fn, opts); offs.push(() => t.removeEventListener(type, fn, opts)); },
    stop() { while (offs.length) /** @type {() => void} */ (offs.pop())(); },
  };
}

/**
 * Velocity (px per ms) over the last few samples [time, position].
 * @param {[number, number][]} samples
 */
export function velocity(samples) {
  if (samples.length < 2) return 0;
  const a = samples[0], b = samples[samples.length - 1];
  return (b[1] - a[1]) / Math.max(1, b[0] - a[0]);
}
