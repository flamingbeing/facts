// The undo toast: "Deleted 'x'" with an Undo button, for an action that can be put back (no "Are you sure?").
// One at a time: a new one replaces the one showing, whose Undo is gone (its action stays done).
import { LABELS } from './labels.js';

/**
 * @param {{ show: (message: string, o?: { ms?: number, action?: { label: string, run: () => void } }) => () => void }} toasts
 *   the page's toaster
 * @param {{ ms?: number, labels?: Record<string, string> }} [o]  ms: how long Undo stays (default 6000)
 * @returns {{ show: (message: string, undo: () => unknown) => void, stop: () => void }}
 *   show: the message and what Undo runs; stop: removes the toast showing
 */
export function undoToast(toasts, { ms = 6000, labels = {} } = {}) {
  const words = { ...LABELS, ...labels };
  /** @type {(() => void) | null} */
  let dismissShowing = null;
  const stop = () => { dismissShowing?.(); dismissShowing = null; };
  return {
    show(message, undo) {
      stop();
      dismissShowing = toasts.show(message, { ms, action: { label: words.undo, run: () => { void undo(); } } });
    },
    stop,
  };
}
