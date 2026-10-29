/** @param {string} text */
export function show(text) {
  const out = document.querySelector('#out');
  if (out) out.textContent = text;
}
