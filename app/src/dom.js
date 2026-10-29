// Page lookups shared by the shell and the screens.

/** @param {string} id @returns {HTMLElement} */
export const $ = id => { const el = document.getElementById(id); if (!el) throw new Error(`#${id} is missing`); return el; };
/** @param {string} id */
export const input = id => /** @type {HTMLInputElement} */ ($(id));
/** @param {string} id */
export const dialog = id => /** @type {HTMLDialogElement} */ ($(id));

/** @typedef {import('./state.js').State} State */
/** @typedef {{ show: (s: State) => void, hide: () => void }} Screen */

/**
 * A screen that is one section of the page (index.html), shown and hidden with it.
 * @param {string} id  the section's id
 * @param {(s: State) => void} [fill]  brings the section up to date before it shows
 * @returns {Screen}
 */
export function sectionScreen(id, fill = () => {}) {
  const section = $(id);
  return {
    show(s) { fill(s); section.hidden = false; },
    hide() { section.hidden = true; },
  };
}
