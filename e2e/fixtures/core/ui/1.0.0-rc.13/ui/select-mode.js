// Select mode: .ui-list[data-select] with .ui-row rows. [data-edit-for="#list"] buttons switch it on and off (Select /
// Done); a "ui-edit" event on the list switches it on from code (a hold menu's Select, detail.row ticks that row).
// While on, the list is a multi-select listbox: a tap ticks a row (no navigation), Space ticks the focused one, Esc
// leaves, Shift-click ticks the range from the last row clicked and Ctrl/Cmd-click adds one (also outside select mode:
// they start it from the open row, aria-current), and a finger that starts on the ticks and moves up or down sets the whole range from where it started to
// where it is now, against the ticks as they were when it started (no flicker going back over rows); the page scrolls
// near the screen's edges. [data-select-toolbar="#list"] (the bottom action bar) replaces the tab bar; its
// [data-needs="2-4"] buttons follow the count; [data-select-count="#list"] says how many (a live region);
// [data-select-all="#list"] ticks all or none. The list sends "ui-select" events (detail.count, detail.rows).
import { haptic, listeners } from './gesture.js';

/** where the ticks are: a finger starting this far (px) from the list's left edge drags the range */
export const TICKS = 56;

/**
 * The ticks after a drag from row `from` to row `to` (pure): rows in between take `setTo`, the rest go back to `snap`.
 * @param {boolean[]} snap  the ticks when the drag started @param {number} from @param {number} to @param {boolean} setTo
 */
export function dragRange(snap, from, to, setTo) {
  const lo = Math.min(from, to), hi = Math.max(from, to);
  return snap.map((was, i) => i >= lo && i <= hi ? setTo : was);
}

/** "2-4" -> [2, 4]; "1" -> [1, 99] */
export function needs(/** @type {string} */ spec) {
  const [lo, hi] = spec.split('-');
  return [Number(lo) || 0, hi === undefined ? 99 : Number(hi)];
}

/**
 * @param {HTMLElement} list  .ui-list[data-select] (needs an id)
 * @param {{ tabBar?: HTMLElement | null }} [opts]  the tab bar the action bar replaces (default nav.ui-tabbar)
 * @returns {{ setEditing: (on: boolean) => void, selected: () => HTMLElement[], stop: () => void }}
 */
export function selectMode(list, { tabBar = /** @type {HTMLElement | null} */ (document.querySelector('.ui-tabbar')) } = {}) {
  const l = listeners();
  const sel = `#${CSS.escape(list.id)}`;
  const q = (/** @type {string} */ attr) => /** @type {HTMLElement[]} */ ([...document.querySelectorAll(`[${attr}="${sel}"]`)]);
  const toggles = /** @type {HTMLButtonElement[]} */ (q('data-edit-for'));
  const bar = q('data-select-toolbar')[0] ?? null;
  const counts = q('data-select-count');
  const alls = q('data-select-all');
  for (const c of counts) { c.setAttribute('role', 'status'); c.setAttribute('aria-live', 'polite'); }
  const rows = () => /** @type {HTMLElement[]} */ ([...list.querySelectorAll('.ui-row')]);
  const on = () => list.classList.contains('is-editing');
  const isTicked = (/** @type {HTMLElement} */ r) => r.getAttribute('aria-selected') === 'true';
  const selected = () => rows().filter(isTicked);
  /** @param {HTMLElement} r @param {boolean} v */
  const tick = (r, v) => r.setAttribute('aria-selected', String(v));
  if (!list.getAttribute('role')) list.setAttribute('role', 'list');
  const plainRole = list.getAttribute('role') || 'list';
  const label = list.getAttribute('aria-label');

  function paint() {
    const n = selected().length, total = rows().length;
    for (const c of counts) c.textContent = n ? `${n} selected` : 'Select items';
    if (bar) bar.querySelectorAll('[data-needs]').forEach(b => {
      const [lo, hi] = needs(b.getAttribute('data-needs') || '1');
      /** @type {HTMLButtonElement} */ (b).disabled = n < lo || n > hi;
    });
    for (const b of alls) b.textContent = n === total && total ? 'Deselect all' : 'Select all';
    list.dispatchEvent(new CustomEvent('ui-select', { bubbles: true, detail: { count: n, rows: selected() } }));
  }
  /** @param {boolean} v */
  function setEditing(v) {
    if (v === on()) return;
    list.classList.toggle('is-editing', v);
    list.setAttribute('role', v ? 'listbox' : plainRole);
    if (v) { list.setAttribute('aria-multiselectable', 'true'); if (!label) list.setAttribute('aria-label', 'Select items'); }
    else { list.removeAttribute('aria-multiselectable'); if (!label) list.removeAttribute('aria-label'); }
    for (const r of rows()) {
      if (v) { r.dataset.role = r.getAttribute('role') || ''; r.setAttribute('role', 'option'); tick(r, false); }
      else { if (r.dataset.role) r.setAttribute('role', r.dataset.role); else r.removeAttribute('role'); delete r.dataset.role; r.removeAttribute('aria-selected'); }
    }
    for (const b of toggles) { b.textContent = v ? 'Done' : b.dataset.label || 'Select'; b.setAttribute('aria-pressed', String(v)); }
    for (const b of alls) b.hidden = !v;
    if (bar) bar.hidden = !v;
    if (tabBar) tabBar.hidden = v;
    paint();
  }

  for (const b of toggles) {
    if (!b.dataset.label) b.dataset.label = (b.textContent || '').trim();
    b.setAttribute('aria-pressed', 'false');
    l.on(b, 'click', () => setEditing(!on()));
  }
  for (const b of alls) {
    b.hidden = true;
    l.on(b, 'click', () => { const all = selected().length < rows().length; rows().forEach(r => tick(r, all)); paint(); });
  }
  l.on(list, 'ui-edit', (/** @type {CustomEvent} */ e) => {
    setEditing(true);
    if (e.detail?.row) { tick(e.detail.row, true); paint(); }
  });
  let dragged = false;
  /** the row a Shift-click ranges from: the last one ticked or clicked */
  /** @type {HTMLElement | null} */
  let anchor = null;
  /** ticks every shown row between two rows, and nothing else @param {HTMLElement} a @param {HTMLElement} b */
  function tickRange(a, b) {
    const shown = rows().filter(r => !r.hidden), i = shown.indexOf(a), j = shown.indexOf(b);
    const lo = Math.min(i < 0 ? j : i, j), hi = Math.max(i < 0 ? j : i, j);
    rows().forEach(r => tick(r, false));
    shown.slice(lo, hi + 1).forEach(r => tick(r, true));
  }
  l.on(list, 'click', (/** @type {MouseEvent} */ e) => {
    const r = /** @type {HTMLElement | null} */ (/** @type {Element} */ (e.target).closest('.ui-row'));
    const mod = e.shiftKey || e.ctrlKey || e.metaKey;
    if (!r || (!on() && !mod)) return;
    e.preventDefault();
    e.stopPropagation();
    if (dragged) { dragged = false; return; }
    if (!on()) {   // a pointer user: Ctrl/Cmd-click or Shift-click starts select mode from the open row (aria-current)
      const open = /** @type {HTMLElement | null} */ (list.querySelector('.ui-row[aria-current="true"]'));
      setEditing(true);
      if (e.shiftKey) tickRange(open ?? r, r);
      else { if (open) tick(open, true); tick(r, true); }
    } else if (e.shiftKey) tickRange(anchor && !anchor.hidden ? anchor : selected()[0] ?? r, r);
    else tick(r, !isTicked(r));
    anchor = r;
    haptic();
    paint();
  }, true);
  l.on(list, 'keydown', (/** @type {KeyboardEvent} */ e) => {
    if (!on()) return;
    const r = /** @type {HTMLElement | null} */ (/** @type {Element} */ (e.target).closest('.ui-row'));
    if (e.key === ' ' && r) { e.preventDefault(); r.click(); }
    else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      const all = rows(), i = r ? all.indexOf(r) : -1, next = all[i + (e.key === 'ArrowDown' ? 1 : -1)];
      if (next) { e.preventDefault(); next.focus(); }
    }
  });
  l.on(document, 'keydown', (/** @type {KeyboardEvent} */ e) => {
    if (e.key === 'Escape' && on() && !document.querySelector('dialog[open]') && !document.documentElement.classList.contains('ui-menu-open')) {
      setEditing(false);
      (toggles.find(t => t.getClientRects().length) ?? toggles[0])?.focus();
    }
  });

  // drag down the ticks
  let from = -1, setTo = true, lastY = 0, scroller = 0;
  /** @type {boolean[]} */
  let snap = [];
  l.on(list, 'touchstart', (/** @type {TouchEvent} */ e) => {
    if (!on() || e.touches.length > 1) return;
    const t = e.touches[0], r = /** @type {HTMLElement | null} */ (/** @type {Element} */ (e.target).closest('.ui-row'));
    if (!r || t.clientX - list.getBoundingClientRect().left > TICKS) return;
    const all = rows();
    from = all.indexOf(r); dragged = false; lastY = t.clientY;
    snap = all.map(isTicked);
    setTo = !snap[from];
  }, { passive: true });
  /** @param {number} y */
  function applyAt(y) {
    const hit = document.elementFromPoint(list.getBoundingClientRect().left + TICKS / 2, y);
    const r = /** @type {HTMLElement | null} */ (hit && hit.closest('.ui-row'));
    if (!r || !list.contains(r)) return;
    const all = rows(), want = dragRange(snap, from, all.indexOf(r), setTo);
    let changed = false;
    all.forEach((x, i) => { if (isTicked(x) !== want[i]) { tick(x, want[i]); changed = true; } });
    if (changed) { haptic(); paint(); }
  }
  l.on(list, 'touchmove', (/** @type {TouchEvent} */ e) => {
    if (from < 0) return;
    const t = e.touches[0];
    if (!dragged && Math.abs(t.clientY - lastY) < 6) return;
    dragged = true; lastY = t.clientY;
    if (e.cancelable) e.preventDefault();
    applyAt(t.clientY);
    cancelAnimationFrame(scroller);
    const barH = bar ? bar.getBoundingClientRect().height : 0, edge = 80;
    const sp = t.clientY < edge ? -8 : t.clientY > innerHeight - edge - barH ? 8 : 0;
    if (sp) (function step() { scrollBy(0, sp); applyAt(lastY); scroller = requestAnimationFrame(step); })();
  }, { passive: false });
  const stopDrag = () => { from = -1; cancelAnimationFrame(scroller); };
  l.on(list, 'touchend', stopDrag);
  l.on(list, 'touchcancel', stopDrag);
  // a drag that ended with no click after it (the touchmove was cancelled) must not eat the next tap
  l.on(list, 'touchstart', () => { if (from < 0) dragged = false; }, { passive: true, capture: true });

  return { setEditing, selected, stop() { stopDrag(); setEditing(false); l.stop(); } };
}
