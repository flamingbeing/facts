// Element builders shared by the kit's parts (not exported from @core/ui), and plural (exported, for the page's own words).

/**
 * @template {keyof HTMLElementTagNameMap} K
 * @param {K} tag
 * @param {Record<string, string>} [attrs]
 * @param {...(Node | string)} children
 * @returns {HTMLElementTagNameMap[K]}
 */
export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, value);
  node.append(...children);
  return node;
}

/** @param {string} label @param {() => unknown} onClick @param {Record<string, string>} [attrs] */
export function button(label, onClick, attrs = {}) {
  const b = el('button', { type: 'button', ...attrs }, label);
  b.addEventListener('click', () => { void onClick(); });
  return b;
}

/** @param {number} n @param {string} one */
export const plural = (n, one) => `${n} ${one}${n === 1 ? '' : 's'}`;
