// The default word for each sync state (the sync chip's) and for the modals and toasts. An app overrides any of them with the part's `labels`.
/** @type {Readonly<Record<string, string>>} */
export const LABELS = Object.freeze({
  synced: 'Saved',
  pending: 'Sending…',
  offline: 'Offline, kept on this device',
  attention: 'Needs you',
  unknown: 'Connecting…',
  'at-risk': 'Not saved on this device yet',
  // the modals' and toasts' words (modal.js, toast.js), overridable the same way
  ok: 'OK',
  cancel: 'Cancel',
  dismiss: 'Dismiss',
  // the reference parts' words (undo-toast.js, load-state.js, about-sheet.js)
  undo: 'Undo',
  loading: 'Loading…',
  retry: 'Try again',
  close: 'Close',
  getNewest: 'Get the newest version',
  checking: 'Checking…',
  updated: 'Updated.',
  checkFailed: 'Could not check. Try again when online.',
  newest: 'This is the newest version (or the update waits until nothing is open).',
  notInstalled: 'not installed yet',
  licences: 'Open-source code in this app',
  // share out (share.js)
  copied: 'Copied',
  copiedPaste: 'Copied: paste it where you want it',
  copyFailed: 'Could not copy on this device',
});
