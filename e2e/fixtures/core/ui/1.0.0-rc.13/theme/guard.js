// The glass guard: glass costs a repaint per frame on weak phones, so this device shows Solid bars and sheets when it
// has little memory (navigator.deviceMemory ≤ 4; Chromium only, so it can only turn glass down, never prove a phone
// fast) or when a frame probe on the first scroll sees a median frame over 20 ms. The verdict is kept on this device;
// the person's own Solid always wins, and "Glass, even here" (material 'always') overrides a verdict (choice.js).
// Reduce transparency, more contrast and no backdrop-filter are glass.css's (CSS, nothing kept).

const KEY = 'core-glass-guard';
export const MEMORY_FLOOR = 4;
export const SLOW_FRAME_MS = 20;
// frames the probe times on the first scroll (about half a second at 60 Hz)
export const PROBE_FRAMES = 30;

/** @typedef {{ solid: boolean, why: '' | 'memory' | 'frames' }} Verdict */

/** @param {number[]} xs @returns {number} */
export function median(xs) {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b), m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/**
 * @param {{ memory?: number | undefined, frames?: number[] }} seen  deviceMemory (GB), frame gaps (ms) from the probe
 * @returns {Verdict | null}  null: nothing to go on yet (no memory figure under the floor, no frames)
 */
export function verdict({ memory, frames }) {
  if (typeof memory === 'number' && memory > 0 && memory <= MEMORY_FLOOR) return { solid: true, why: 'memory' };
  if (!frames || frames.length < PROBE_FRAMES / 2) return null;
  return median(frames) > SLOW_FRAME_MS ? { solid: true, why: 'frames' } : { solid: false, why: '' };
}

/** @returns {Verdict | null}  what this device found before */
export function kept() {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (v && typeof v.solid === 'boolean') return { solid: v.solid, why: v.why === 'memory' || v.why === 'frames' ? v.why : '' };
  } catch { /* no storage: nothing kept */ }
  return null;
}

/** @param {Verdict | null} v  null forgets (the gallery's re-check) */
export function keep(v) {
  try { if (v) localStorage.setItem(KEY, JSON.stringify(v)); else localStorage.removeItem(KEY); } catch { /* this page only */ }
}

/** @returns {boolean}  the guard turned glass down on this device */
export const guardSolid = () => kept()?.solid === true;

/**
 * Runs the guard once per device: the memory check at once; else the frame probe on the first scroll, timing
 * PROBE_FRAMES animation frames while the page is visible. Nothing to do when a verdict is kept.
 * @param {(v: Verdict) => void} found  called when a new verdict is kept (choice.js shows the glass again)
 * @returns {() => void} stop
 */
export function startGuard(found) {
  if (kept() || typeof window === 'undefined') return () => {};
  const memory = /** @type {any} */ (navigator).deviceMemory;
  const now = verdict({ memory });
  if (now) { keep(now); found(now); return () => {}; }
  let frames = /** @type {number[]} */ ([]), last = 0, raf = 0, done = false;
  const tick = (/** @type {number} */ t) => {
    if (document.hidden) { frames = []; last = 0; }   // (a hidden tab's frames stall: start over when it's back)
    else if (last) frames.push(t - last);
    last = t;
    if (frames.length >= PROBE_FRAMES) {
      done = true;
      const v = verdict({ memory, frames });
      if (v) { keep(v); found(v); }
      return;
    }
    raf = requestAnimationFrame(tick);
  };
  const onScroll = () => { removeEventListener('scroll', onScroll, true); if (!done) raf = requestAnimationFrame(tick); };
  addEventListener('scroll', onScroll, { capture: true, passive: true });
  return () => { done = true; cancelAnimationFrame(raf); removeEventListener('scroll', onScroll, true); };
}
