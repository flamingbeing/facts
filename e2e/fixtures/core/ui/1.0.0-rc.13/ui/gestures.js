// Starts every gesture part whose markup is on the page, and only those (a page without the markup is not changed):
//   large title     .ui-bar + .ui-large-title               the bar collapses when the title scrolls under it
//   tab bar         nav.ui-tabbar[data-minimise]            shrinks to the current tab while scrolling down
//   hold menu       [data-hold-menu="#template-id"]         touch and hold, right-click, context-menu key, Shift+F10
//   sheets          dialog.ui-sheet[data-detents]           drag between heights, or down to close
//   pushed screens  .ui-screens > .ui-screen                [data-push] / .ui-back, Back, edge swipe (screens.js); the
//                   bar's .ui-bar-title follows the top screen's large title, the top screen's .ui-back shows in the
//                   bar's leading slot ([data-bar-lead], else the bar's start), and .ui-screens sends "ui-screen" (detail.top)
//   select mode     .ui-list[data-select]                   tick rows, drag down the ticks, bottom action bar
//   tab pages       nav.ui-tabbar [data-tab-page="#id"]     each tab shows one of the .ui-screens as the page under any
//                                                           pushed ones; a sideways swipe moves between them on a phone
// Styles: ui/gestures.css, loaded with <link> after ui.css.
import { largeTitle } from './large-title.js';
import { shrinkingTabBar } from './tab-bar.js';
import { holdMenus } from './hold-menu.js';
import { detentSheet } from './detent-sheet.js';
import { screenStack } from './screens.js';
import { selectMode } from './select-mode.js';
import { tabPages } from './tab-pages.js';

/**
 * @param {ParentNode} [root]
 * @returns {{ title: ReturnType<typeof largeTitle> | null, menus: ReturnType<typeof holdMenus> | null,
 *   sheets: Map<string, ReturnType<typeof detentSheet>>, screens: ReturnType<typeof screenStack> | null,
 *   selects: Map<string, ReturnType<typeof selectMode>>, tabs: ReturnType<typeof tabPages> | null, stop: () => void }}
 */
export function startGestures(root = document) {
  /** @type {(() => void)[]} */
  const stops = [];
  // iOS shows :active press states only when the page listens for touches
  const noop = () => {};
  document.addEventListener('touchstart', noop, { passive: true });
  stops.push(() => document.removeEventListener('touchstart', noop));

  const bar = /** @type {HTMLElement | null} */ (root.querySelector('.ui-bar'));
  const title = bar && root.querySelector('.ui-large-title') ? largeTitle(bar) : null;
  if (title) stops.push(title.stop);
  const shrink = /** @type {HTMLElement | null} */ (root.querySelector('nav.ui-tabbar[data-minimise]'));
  if (shrink) stops.push(shrinkingTabBar(shrink));
  const menus = root.querySelector('[data-hold-menu]') ? holdMenus(root) : null;
  if (menus) stops.push(menus.stop);
  const sheets = new Map();
  for (const d of /** @type {NodeListOf<HTMLDialogElement>} */ (root.querySelectorAll('dialog.ui-sheet[data-detents]'))) {
    const s = detentSheet(d);
    sheets.set(d.id, s);
    stops.push(s.stop);
  }
  const host = /** @type {HTMLElement | null} */ (root.querySelector('.ui-screens'));
  // Back sits in the bar, where a phone puts it, instead of below an empty bar: one button standing in for the top
  // screen's own .ui-back (hidden by .has-bar-back), with its words
  const back = bar && host ? barBack(bar, host, () => screens?.pop()) : null;
  const screens = host ? screenStack(host, {
    onChange: top => {
      const big = /** @type {HTMLElement | null} */ (top.querySelector('.ui-large-title'));
      const small = bar?.querySelector('.ui-bar-title');
      if (small && big) small.textContent = big.textContent;
      if (back) {
        const own = top.querySelector(':scope > .ui-back');
        back.hidden = !own || (screens?.depth() ?? 1) < 1;
        back.textContent = own?.textContent ?? '';
      }
      title?.watch(big);
      host.dispatchEvent(new CustomEvent('ui-screen', { bubbles: true, detail: { top } }));
    },
  }) : null;
  if (screens) stops.push(screens.stop);
  if (back) stops.push(() => { back.remove(); host?.classList.remove('has-bar-back'); });
  const tabBar = /** @type {HTMLElement | null} */ (root.querySelector('nav.ui-tabbar'));
  const tabs = tabBar && host && screens && tabBar.querySelector('[data-tab-page]') ? tabPages(tabBar, { screens, host, root }) : null;
  if (tabs) stops.push(tabs.stop);
  const selects = new Map();
  for (const list of /** @type {NodeListOf<HTMLElement>} */ (root.querySelectorAll('.ui-list[data-select]'))) {
    const s = selectMode(list);
    selects.set(list.id, s);
    stops.push(s.stop);
  }
  return { title, menus, sheets, screens, selects, tabs, stop: () => { while (stops.length) /** @type {() => void} */ (stops.pop())(); } };
}

/** The bar's Back button (hidden until a screen is pushed). @param {HTMLElement} bar @param {HTMLElement} host
 * @param {() => void} pop */
function barBack(bar, host, pop) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'ui-back ui-bar-back';
  b.hidden = true;
  b.addEventListener('click', pop);
  const lead = bar.querySelector('[data-bar-lead]');
  if (lead) lead.prepend(b); else bar.prepend(b);
  host.classList.add('has-bar-back');
  return b;
}
