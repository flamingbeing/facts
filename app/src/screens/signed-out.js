// The signed-out screen (#signed-out): the kit's sign-in sheet, with "Forget this device".
import { signInSheet } from '@core/ui';
import { $, sectionScreen } from '../dom.js';

/**
 * @param {import('../cloud.js').Started} app
 * @param {{ onForget: (ok: boolean) => void }} o  told whether this device was forgotten
 */
export function signedOutScreen(app, { onForget }) {
  signInSheet($('sign-in-sheet'), { auth: app.auth, onForget });
  return sectionScreen('signed-out');
}
