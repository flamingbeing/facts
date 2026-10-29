// The About sheet: the app's name, its version, "Get the newest version" and the outside code it ships, read from the
// page's import map. Opens as a dialog; resolves when closed.
import { LABELS } from './labels.js';
import { el, button } from './dom.js';

const VERSION = /[@/](\d+\.\d+\.\d+(?:-[\w.]+)?)(?=[/.?+]|$)/;

/**
 * The outside packages an import map lists: its own files (relative targets) left out, a version read from the address.
 * @param {{ imports?: Record<string, string> } | null | undefined} map
 * @param {Record<string, string>} [licences]  licence name by package name, for the ones the app knows
 * @returns {{ name: string, version: string, licence: string }[]}
 */
export function packagesFromImportMap(map, licences = {}) {
  return Object.entries(map?.imports ?? {})
    .filter(([name, target]) => !/^\.|^\/(?!\/)/.test(target) && !name.endsWith('/'))
    .map(([name, target]) => ({ name, version: VERSION.exec(target)?.[1] ?? '', licence: licences[name] ?? '' }));
}

/** The import map the page carries, or null. @returns {{ imports?: Record<string, string> } | null} */
function pageImportMap() {
  const tag = document.querySelector('script[type="importmap"]');
  try { return tag?.textContent ? JSON.parse(tag.textContent) : null; } catch { return null; }
}

let opened = 0;

/**
 * @param {{ name: string, update: import('./types').UpdateApi | null, licences?: Record<string, string>,
 *   importMap?: { imports?: Record<string, string> } | null, labels?: Record<string, string> }} o
 *   name: the app's name; licences: licence by package name; importMap: defaults to the page's own
 * @returns {Promise<void>}  resolves when closed
 */
export function aboutSheet({ name, update, licences = {}, importMap = pageImportMap(), labels = {} }) {
  const words = { ...LABELS, ...labels };
  const back = /** @type {HTMLElement | null} */ (document.activeElement);
  const version = el('span', { class: 'about-version' }, update ? '…' : 'dev');
  const answer = el('p', { class: 'ui-small small', role: 'status' });
  const title = `ui-about-title-${++opened}`;   // (no fixed id: a page may open it twice, or use the name itself)
  const box = /** @type {HTMLDialogElement} */ (el('dialog', { class: 'modal about-sheet', 'aria-labelledby': title },
    el('h2', { id: title }, name),
    el('p', {}, 'Version ', version)));
  if (update) {
    update.versionLabel().then(v => { version.textContent = v || words.notInstalled; }, () => { version.textContent = words.notInstalled; });
    box.append(button(words.getNewest, async () => {
      answer.textContent = words.checking;
      try { answer.textContent = await update.checkNow() ? words.updated : words.newest; }
      catch { answer.textContent = words.checkFailed; }
    }, { class: 'about-update' }), answer);
  }
  const packages = packagesFromImportMap(importMap, licences);
  if (packages.length) {
    box.append(el('h3', {}, words.licences), el('ul', { class: 'about-licences' }, ...packages.map(p =>
      el('li', {}, [p.name, p.version, p.licence].filter(Boolean).join(' · ')))));
  }
  const close = button(words.close, () => box.close(), { class: 'about-close' });
  box.append(el('div', { class: 'ui-inline row' }, close));
  return new Promise(resolve => {
    box.addEventListener('close', () => { box.remove(); back?.focus(); resolve(); });
    document.body.append(box);
    box.showModal();
    close.focus();
  });
}
