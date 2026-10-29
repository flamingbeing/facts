// Collapsing large title: the top bar (.ui-bar) shows the screen's name small once the big title (.ui-large-title)
// has scrolled under it; scrolled back, the bar clears again. The bar gets is-collapsed; the CSS does the rest.

/**
 * @param {HTMLElement} bar  the top bar
 * @param {HTMLElement | null} [title]  the screen's large title (default: the first one showing)
 * @returns {{ watch: (t: HTMLElement | null) => void, stop: () => void }}  watch: aim it at a new screen's title
 */
export function largeTitle(bar, title) {
  /** @type {IntersectionObserver | null} */
  let io = null;
  /** @param {HTMLElement | null} t */
  function watch(t) {
    if (io) io.disconnect();
    io = null;
    // a new screen starts open, without the collapse animation
    bar.classList.add('ui-bar-instant');
    bar.classList.remove('is-collapsed');
    requestAnimationFrame(() => requestAnimationFrame(() => bar.classList.remove('ui-bar-instant')));
    if (!t) return;
    if (typeof IntersectionObserver !== 'function') { bar.classList.add('is-collapsed'); return; }
    // collapse when the title's words reach the bar: a band look pads the title below its words, so leave that out
    const below = parseFloat(getComputedStyle(t).paddingBottom) || 0;
    io = new IntersectionObserver(e => bar.classList.toggle('is-collapsed', !e[e.length - 1].isIntersecting),
      { rootMargin: `-${Math.round(bar.offsetHeight + below)}px 0px 0px 0px`, threshold: 0 });
    io.observe(t);
  }
  watch(title ?? [.../** @type {NodeListOf<HTMLElement>} */ (document.querySelectorAll('.ui-large-title'))].find(t => t.offsetParent !== null) ?? null);
  return { watch, stop: () => { io?.disconnect(); io = null; bar.classList.remove('is-collapsed'); } };
}
