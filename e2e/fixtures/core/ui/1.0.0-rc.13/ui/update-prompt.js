// The update prompt: the version line (#version), "Check for updates" (#check-update) and its answer (#update-msg).
// A new version installs in the background and its reload waits while something is open; once a field is left or a
// sheet closes, the owed reload is tried again. Without the update module (no service worker) the version reads "dev".
import { el, button } from './dom.js';

/**
 * @param {HTMLElement} host  the version line and the answer are added here
 * @param {{ update: import('./types').UpdateApi | null, idPrefix?: string }} o
 *   idPrefix: put before each of the part's ids (two on one page, or ids the app already uses)
 * @returns {() => void} stop: stops the retries and removes the prompt
 */
export function updatePrompt(host, { update, idPrefix = '' }) {
  const version = el('span', { id: `${idPrefix}version` }, '…');
  const answer = el('p', { id: `${idPrefix}update-msg`, class: 'ui-small small', role: 'status' });
  const check = button('Check for updates', async () => {
    if (!update) return;
    answer.textContent = 'Checking…';
    answer.textContent = await update.checkNow() ? 'Updated.' : 'This is the newest version (or the update waits until nothing is open).';
  }, { id: `${idPrefix}check-update` });
  const line = el('p', { class: 'ui-small small' }, 'Version ', version, ' ', check);
  host.append(line, answer);
  const remove = () => { line.remove(); answer.remove(); };
  if (!update) {
    version.textContent = 'dev';
    check.hidden = true;
    return remove;
  }
  update.versionLabel().then(v => { version.textContent = v || 'not installed yet'; }, () => {});
  const retry = () => setTimeout(() => update.retryUpdate(), 0);
  document.addEventListener('focusout', retry);
  document.addEventListener('close', retry, true);   // a dialog closing ('close' doesn't bubble, so on the way down)
  return () => {
    document.removeEventListener('focusout', retry);
    document.removeEventListener('close', retry, true);
    remove();
  };
}
