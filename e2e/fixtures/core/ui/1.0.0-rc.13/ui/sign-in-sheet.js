// The sign-in sheet: "Sign in" (#sign-in) with why it didn't work (#sign-in-error), and "Forget this device" (#forget),
// which the auth module refuses while saves are unsent; then "Forget anyway" (#forget-force) loses them on purpose.
// Signing out keeps the device's data, so forget is the only way to clear it here.
import { el, button } from './dom.js';

/** @param {unknown} err  a failed sign-in -> why, in plain words (never the raw error text) */
function whyFailed(err) {
  const code = String(/** @type {{ code?: unknown } | null} */ (err)?.code || '');
  if (/popup-closed-by-user|cancelled-popup-request|user-cancelled/.test(code)) return 'Sign-in was cancelled.';
  if (/network-request-failed|unavailable|deadline-exceeded/.test(code)) return 'No signal, so that didn’t work. Try again when you’re online.';
  if (/unauthorized-domain|operation-not-allowed/.test(code)) return 'Sign-in isn’t switched on for this address yet.';
  return 'Sign-in didn’t work. Try again in a moment.';
}

/** @param {{ reason: string, from?: { email?: string } | null }} r  auth.signIn()'s answer -> '' or why it was refused */
function whyRefused({ reason, from }) {
  const last = from?.email || 'the last account';
  if (reason === 'unsent') return `This phone still has changes from ${last} that haven’t been sent. Sign in as that account to send them, or forget this device.`;
  if (reason === 'wipe') return `This phone couldn’t clear ${last}’s copy, so it stays. Try again.`;
  return '';
}

/** @param {{ ok: boolean, reason: string, failed?: string[] }} r  auth.forget()'s answer, in words */
function forgetWords({ ok, reason, failed = [] }) {
  if (ok && failed.length) return `Signed out, but some of this app's data could not be cleared (${failed.join(', ')}). Close every tab of this app and forget again.`;
  if (ok) return 'Forgotten: this device holds nothing of this app now.';
  return reason === 'unsent' ? 'Some changes on this device are not sent yet. Sign in to send them, or forget anyway and lose them.' : 'Forget didn’t work. Try again.';
}

/**
 * @param {HTMLElement} host  the sheet's parts are added here
 * @param {{ auth: import('./types').AuthApi, label?: string, onForget?: (ok: boolean) => void, idPrefix?: string }} o
 *   idPrefix: put before each of the part's ids (two on one page, or ids the app already uses)
 *   label: the sign-in button's words; onForget: told whether this device was forgotten
 * @returns {() => void} stop: unsubscribes and removes the parts
 */
export function signInSheet(host, { auth, label = 'Sign in with Google', onForget = () => {}, idPrefix = '' }) {
  const error = el('p', { id: `${idPrefix}sign-in-error`, class: 'ui-error error', role: 'alert' });
  const said = el('p', { id: `${idPrefix}forget-msg`, role: 'status' });
  /** @param {boolean} force */
  const forget = async force => {
    said.textContent = '';
    const r = await auth.forget({ force });
    forceButton.hidden = r.ok || r.reason !== 'unsent';
    said.textContent = forgetWords(r);
    onForget(r.ok);
  };
  const forceButton = button('Forget anyway, losing the unsent changes', () => forget(true), { id: `${idPrefix}forget-force`, class: 'ui-danger danger' });
  forceButton.hidden = true;
  const parts = [
    button(label, async () => {
      error.textContent = '';
      try { error.textContent = whyRefused(await auth.signIn()); } catch (e) { error.textContent = whyFailed(e); }
    }, { id: `${idPrefix}sign-in` }),
    error,
    el('p', { class: 'ui-small small' }, 'Signing out keeps this phone’s copy and unsent changes for the next sign-in. To clear them:'),
    button('Forget this device', () => forget(false), { id: `${idPrefix}forget`, class: 'ui-danger danger' }),
    forceButton,
    said,
  ];
  host.append(...parts);
  const off = auth.onUser(user => {
    if (!user) return;
    said.textContent = '';
    forceButton.hidden = true;
  });
  return () => { off(); for (const p of parts) p.remove(); };
}
