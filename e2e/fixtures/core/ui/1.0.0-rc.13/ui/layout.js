// Layout parts that need a little script (ui/layout.css has the rest): toolbars (one Tab stop, arrow keys, Home, End
// move between the buttons: the ARIA toolbar pattern), steppers (− and + step the number field, kept in its min/max
// and step; the field keeps typing and its own arrow keys) and clearable segmented controls (a second tap on the picked
// segment clears it). Each starts only where its markup is; startLayout() starts them all under a root.
// Grid, stack and split are CSS only.

/**
 * The value one step away, kept in [min, max] and rounded to the step's decimals (0.1 + 0.2 is 0.3, not 0.30000000004).
 * An empty field starts at `start` (when given) rather than stepping from it.
 * @param {string} value  the field's text @param {number} dir  +1 or -1
 * @param {{ step?: number, min?: number, max?: number, start?: number }} [o]
 * @returns {string}
 */
export function stepValue(value, dir, { step = 1, min = -Infinity, max = Infinity, start } = {}) {
  const places = (String(step).split('.')[1] || '').length;
  const n = parseFloat(value);
  let next = Number.isFinite(n) ? n + dir * step : (start ?? (dir > 0 ? Math.max(0, min) : Math.min(0, max)));
  next = Math.min(max, Math.max(min, next));
  return next.toFixed(places);
}

/** @param {string | undefined} s */
const num = s => (s == null || s === '' || !Number.isFinite(Number(s)) ? undefined : Number(s));

/** @param {HTMLElement} box  a .ui-stepper with [data-step] buttons and one input @returns {() => void} stop */
export function stepper(box) {
  const field = /** @type {HTMLInputElement | null} */ (box.querySelector('input'));
  if (!field) return () => {};
  // the field is the one Tab stop; the buttons are for fingers and pointers (the field's arrow keys do the same)
  for (const b of box.querySelectorAll('[data-step]')) b.setAttribute('tabindex', '-1');
  /** @param {MouseEvent} e */
  function click(e) {
    const b = /** @type {HTMLElement | null} */ (/** @type {Element} */ (e.target).closest('[data-step]'));
    if (!b || !field || field.disabled || field.readOnly) return;
    field.value = stepValue(field.value, Number(b.dataset.step) < 0 ? -1 : 1, {
      step: num(field.step) ?? 1, min: num(field.min), max: num(field.max), start: num(box.dataset.start) });
    field.dispatchEvent(new Event('input', { bubbles: true }));
    field.dispatchEvent(new Event('change', { bubbles: true }));
  }
  box.addEventListener('click', click);
  return () => box.removeEventListener('click', click);
}

/** @param {HTMLElement} bar  a [role=toolbar] @returns {() => void} stop */
export function toolbar(bar) {
  const items = () => /** @type {HTMLElement[]} */ ([...bar.querySelectorAll('button, a[href], input, select')])
    .filter(el => !(/** @type {HTMLButtonElement} */ (el).disabled) && !el.hidden && el.offsetParent !== null);
  /** @param {HTMLElement | undefined} on */
  const rove = on => { for (const el of items()) el.tabIndex = el === on ? 0 : -1; };
  rove(items()[0]);
  /** @param {KeyboardEvent} e */
  function key(e) {
    const list = items(), at = list.indexOf(/** @type {HTMLElement} */ (document.activeElement));
    if (at < 0 || /** @type {Element} */ (e.target).matches('input:not([type=button]), select')) return;
    const vertical = bar.getAttribute('aria-orientation') === 'vertical';
    const next = { Home: 0, End: list.length - 1,
      [vertical ? 'ArrowDown' : 'ArrowRight']: (at + 1) % list.length,
      [vertical ? 'ArrowUp' : 'ArrowLeft']: (at - 1 + list.length) % list.length }[e.key];
    if (next == null) return;
    e.preventDefault();
    rove(list[next]);
    list[next].focus();
  }
  /** @param {FocusEvent} e */
  const focus = e => { if (items().includes(/** @type {HTMLElement} */ (e.target))) rove(/** @type {HTMLElement} */ (e.target)); };
  bar.addEventListener('keydown', key);
  bar.addEventListener('focusin', focus);
  return () => { bar.removeEventListener('keydown', key); bar.removeEventListener('focusin', focus); };
}

/** @param {HTMLElement} group  a .ui-segmented[data-clearable] @returns {() => void} stop */
export function clearableSegments(group) {
  /** @type {HTMLInputElement | null} */
  let was = null;
  // which radio was picked before this press (by the time of the click the browser has already picked the new one)
  const down = () => { was = group.querySelector('input:checked'); };
  /** @param {MouseEvent} e */
  function click(e) {
    const r = /** @type {HTMLInputElement} */ (e.target);
    if (r.type !== 'radio' || r !== was || !e.detail) return;   // e.detail 0: a keyboard pick, never a clear
    r.checked = false;
    was = null;
    r.dispatchEvent(new Event('change', { bubbles: true }));
  }
  group.addEventListener('pointerdown', down);
  group.addEventListener('click', click);
  return () => { group.removeEventListener('pointerdown', down); group.removeEventListener('click', click); };
}

/**
 * Starts every layout part under root (steppers, toolbars, clearable segmented controls).
 * @param {ParentNode} [root]
 * @returns {{ stop: () => void }}
 */
export function startLayout(root = document) {
  const stops = [
    ...[.../** @type {NodeListOf<HTMLElement>} */ (root.querySelectorAll('.ui-stepper'))].map(stepper),
    ...[.../** @type {NodeListOf<HTMLElement>} */ (root.querySelectorAll('[role="toolbar"]'))].map(toolbar),
    ...[.../** @type {NodeListOf<HTMLElement>} */ (root.querySelectorAll('.ui-segmented[data-clearable]'))].map(clearableSegments),
  ];
  return { stop: () => stops.forEach(s => s()) };
}
