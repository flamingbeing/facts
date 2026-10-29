// Adaptive shell: one page that is a phone, a tablet or a laptop layout by its width (Material 3 window size classes).
//   < 600 px   phone    tab bar + one pane; opening a row pushes the detail as a screen (Back pops it)
//   600-839    tablet   side bar + list and detail side by side
//   >= 840     laptop   side bar + list + detail; sheets become centred dialogs, or a side panel (data-wide="panel")
// Markup (ui/shell/shell.css): .ui-shell > nav.ui-sidebar, main.ui-screens.ui-panes > section.ui-pane-list (with a
// .ui-list[data-select]) + section.ui-pane-detail.ui-screen, and nav.ui-tabbar. The root and <html> carry
// data-size="phone|tablet|laptop" and the root sends "ui-size" (detail.size) when it changes.
//   open a row   click, Enter, or the hold menu's "open" (a "ui-menu" event with detail.action "open"); the row gets
//                aria-current and sends "ui-open" (detail.row, detail.size); wide: the detail pane shows it; phone: the
//                detail screen is pushed. The detail pane is optional: without one, "ui-open" is all that happens
//   no row open  the detail pane carries data-empty (its .ui-detail-actions hide) and shows its first words; a deleted
//                open row empties it again
//   many ticked  "ui-select" with 2+ rows swaps .ui-detail-one for .ui-detail-multi ([data-multi-count], [data-multi-names])
//   search       [data-shell-search] fields (the side bar's and the phone's) filter the rows and mirror each other;
//                Ctrl/Cmd+K focuses the visible one; Esc clears it, then leaves it
//   Esc          on a phone's pushed detail, goes back (select mode, menus and dialogs keep their own Esc)
//   side bar     a .ui-bar-menu button (in the bar's [data-bar-lead]) opens the side bar as a drawer on a phone
//                (.ui-shell.is-drawer-open); a side link, the shade, Esc or growing past phone width closes it
// Pointer: right-click is the hold menu; Shift-click takes a range and Ctrl/Cmd-click adds a row (select-mode.js).
import { listeners } from '../gesture.js';

export const TABLET_MIN = 600;
export const LAPTOP_MIN = 840;

/** The window size class for a width in px (pure). @param {number} w */
export const sizeClass = w => w < TABLET_MIN ? 'phone' : w < LAPTOP_MIN ? 'tablet' : 'laptop';

/** Whether a row's text matches a search: every word, any case (pure). @param {string} text @param {string} query */
export function matchesSearch(text, query) {
  const t = text.toLowerCase();
  return query.toLowerCase().split(/\s+/).filter(Boolean).every(w => t.includes(w));
}

/** @param {HTMLElement} row @param {HTMLElement} detail */
function defaultRender(row, detail) {
  detail.querySelectorAll('[data-detail-title]').forEach(el => { el.textContent = row.dataset.name ?? ''; });
  detail.querySelectorAll('[data-detail-sub]').forEach(el => { el.textContent = row.querySelector('.ui-row-sub')?.textContent ?? ''; });
}

/**
 * @param {HTMLElement} shell  .ui-shell
 * @param {{ screens?: { push: (t: string | HTMLElement, from?: HTMLElement | null) => void, pop: (a?: boolean) => void, depth: () => number } | null,
 *   render?: (row: HTMLElement, detail: HTMLElement) => void }} [opts]  screens: the page's screen stack (startGestures().screens)
 * @returns {{ open: (row: HTMLElement) => void, current: () => HTMLElement | null, size: () => string, stop: () => void }}
 */
export function adaptiveShell(shell, { screens = null, render = defaultRender } = {}) {
  const l = listeners();
  const html = document.documentElement;
  const list = /** @type {HTMLElement} */ (shell.querySelector('.ui-list'));
  // (no .ui-pane-detail: a list-only shell; opening a row marks it and sends "ui-open", the app shows it its own way)
  const detail = /** @type {HTMLElement | null} */ (shell.querySelector('.ui-pane-detail'));
  const one = /** @type {HTMLElement | null} */ (detail?.querySelector('.ui-detail-one') ?? null);
  const multi = /** @type {HTMLElement | null} */ (detail?.querySelector('.ui-detail-multi') ?? null);
  const searches = /** @type {HTMLInputElement[]} */ ([...shell.querySelectorAll('[data-shell-search]')]);
  const empty = /** @type {HTMLElement | null} */ (shell.querySelector('[data-shell-empty]'));
  const rows = () => /** @type {HTMLElement[]} */ ([...list.querySelectorAll('.ui-row')]);
  const editing = () => list.classList.contains('is-editing');
  let size = sizeClass(innerWidth);

  // size class: from the media queries, so a rotated or resized window follows
  const queries = [matchMedia(`(min-width: ${TABLET_MIN}px)`), matchMedia(`(min-width: ${LAPTOP_MIN}px)`)];
  function applySize() {
    size = sizeClass(innerWidth);
    shell.dataset.size = size;
    html.dataset.size = size;
    shell.dispatchEvent(new CustomEvent('ui-size', { bubbles: true, detail: { size } }));
  }
  for (const q of queries) l.on(q, 'change', applySize);
  applySize();

  /** @type {HTMLElement | null} */
  let current = null;
  // the detail's words before any row opens ("Pick a plant"), put back when it empties
  const blank = [...(detail?.querySelectorAll('[data-detail-title], [data-detail-sub]') ?? [])].map(el => /** @type {[Element, string]} */ ([el, el.textContent ?? '']));
  detail?.toggleAttribute('data-empty', true);
  /** @param {HTMLElement} row */
  function open(row) {
    for (const r of rows()) r.removeAttribute('aria-current');
    row.setAttribute('aria-current', 'true');
    current = row;
    row.dispatchEvent(new CustomEvent('ui-open', { bubbles: true, detail: { row, size } }));
    if (!detail) return;
    detail.toggleAttribute('data-empty', false);
    render(row, detail);
    if (size === 'phone') screens?.push(detail, row);
  }
  const gone = new MutationObserver(() => {
    if (!current || list.contains(current)) return;
    current = null;
    for (const [el, text] of blank) el.textContent = text;
    detail?.toggleAttribute('data-empty', true);
  });
  gone.observe(list, { childList: true });

  l.on(list, 'click', (/** @type {MouseEvent} */ e) => {
    if (e.defaultPrevented || editing()) return;
    const row = /** @type {HTMLElement | null} */ (/** @type {Element} */ (e.target).closest('.ui-row'));
    if (row) open(row);
  });
  l.on(list, 'keydown', (/** @type {KeyboardEvent} */ e) => {
    if (editing()) return;
    const row = /** @type {HTMLElement | null} */ (/** @type {Element} */ (e.target).closest('.ui-row'));
    if (!row) return;
    if (e.key === 'Enter') { e.preventDefault(); open(row); return; }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      const shown = rows().filter(r => !r.hidden), next = shown[shown.indexOf(row) + (e.key === 'ArrowDown' ? 1 : -1)];
      if (next) { e.preventDefault(); next.focus(); }
    }
  });
  l.on(list, 'ui-menu', (/** @type {CustomEvent} */ e) => { if (e.detail?.action === 'open') open(/** @type {HTMLElement} */ (e.target)); });

  // several ticked: the detail pane says what they share instead of showing one
  l.on(list, 'ui-select', (/** @type {CustomEvent} */ e) => {
    const { count, rows: ticked } = e.detail, many = count > 1;
    if (one) one.hidden = many;
    if (multi) {
      multi.hidden = !many;
      multi.querySelectorAll('[data-multi-count]').forEach(el => { el.textContent = `${count} selected`; });
      multi.querySelectorAll('[data-multi-names]').forEach(el => { el.textContent = ticked.map((/** @type {HTMLElement} */ r) => r.dataset.name).join(', '); });
    }
  });

  // search
  function filter(/** @type {string} */ q) {
    let shown = 0;
    for (const r of rows()) { r.hidden = !matchesSearch(r.textContent || '', q); if (!r.hidden) shown++; }
    if (empty) empty.hidden = shown > 0;
    list.hidden = shown === 0;
    list.dispatchEvent(new CustomEvent('ui-search', { bubbles: true, detail: { query: q, shown } }));
  }
  for (const s of searches) l.on(s, 'input', () => { for (const o of searches) if (o !== s) o.value = s.value; filter(s.value); });
  const visibleSearch = () => searches.find(s => s.getClientRects().length > 0) ?? null;

  // the phone's drawer: the side bar over the page
  const side = /** @type {HTMLElement | null} */ (shell.querySelector('.ui-sidebar'));
  const menus = /** @type {HTMLElement[]} */ ([...shell.querySelectorAll('.ui-bar-menu')]);
  const drawerOpen = () => shell.classList.contains('is-drawer-open');
  /** @param {boolean} on */
  function drawer(on) {
    if (on === drawerOpen() || !side) return;
    shell.classList.toggle('is-drawer-open', on);
    for (const m of menus) m.setAttribute('aria-expanded', String(on));
    if (on) /** @type {HTMLElement | null} */ (side.querySelector('a, button, input'))?.focus();
    else if (side.contains(document.activeElement)) menus[0]?.focus();
  }
  for (const m of menus) { m.setAttribute('aria-expanded', 'false'); l.on(m, 'click', () => drawer(!drawerOpen())); }
  if (side) l.on(side, 'click', (/** @type {MouseEvent} */ e) => { if (/** @type {Element} */ (e.target).closest('a, .ui-side-link')) drawer(false); });
  l.on(shell, 'click', (/** @type {MouseEvent} */ e) => { if (e.target === shell && drawerOpen()) drawer(false); });   // the shade
  l.on(shell, 'ui-size', () => { if (size !== 'phone') drawer(false); });

  l.on(document, 'keydown', (/** @type {KeyboardEvent} */ e) => {
    const t = /** @type {Element} */ (e.target);
    if (e.key === 'Escape' && drawerOpen()) { drawer(false); return; }
    if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 'k') {
      const f = visibleSearch();
      if (!f || document.querySelector('dialog[open]')) return;
      e.preventDefault();
      f.focus();
      f.select();
    } else if (e.key === 'Escape') {
      if (t instanceof HTMLInputElement && searches.includes(t)) {
        if (t.value) { t.value = ''; t.dispatchEvent(new Event('input')); } else t.blur();
      } else if (size === 'phone' && screens && screens.depth() > 0 && !editing()
        && !document.querySelector('dialog[open]') && !html.classList.contains('ui-menu-open')) screens.pop();
    }
  });

  return { open, current: () => current, size: () => size, stop() { gone.disconnect(); l.stop(); } };
}
