// Share out: some text (one item, or a list as plain text) through the system share sheet, or the clipboard where
// there is none. The page hands in its toaster to say what happened; the words are overridable like every part's.
import { LABELS } from './labels.js';

/**
 * @typedef {{ show: (message: string) => unknown }} Notes  the page's toaster
 * @typedef {{ toasts?: Notes, labels?: Record<string, string> }} ShareOptions
 */

/**
 * @param {string} text @param {ShareOptions & { what?: string }} [o]  what: the word shown after copying
 * @returns {Promise<boolean>} whether it was copied
 */
export async function copyText(text, { toasts, labels = {}, what } = {}) {
  const words = { ...LABELS, ...labels };
  try {
    await navigator.clipboard.writeText(text);
    toasts?.show(what ?? words.copied);
    return true;
  } catch {
    toasts?.show(words.copyFailed);
    return false;
  }
}

/**
 * The share sheet (messages, notes apps); the clipboard where there isn't one. A closed sheet is not an error.
 * @param {string} text @param {ShareOptions & { title?: string }} [o]
 * @returns {Promise<'shared' | 'copied' | 'cancelled' | 'failed'>}
 */
export async function shareText(text, { title = '', toasts, labels = {} } = {}) {
  if (typeof navigator.share === 'function') {
    try { await navigator.share({ title, text }); return 'shared'; }
    catch (err) { if (err instanceof Error && err.name === 'AbortError') return 'cancelled'; }
  }
  const words = { ...LABELS, ...labels };
  return await copyText(text, { toasts, labels, what: words.copiedPaste }) ? 'copied' : 'failed';
}
