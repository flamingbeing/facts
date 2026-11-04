// The signed-out screen (#signed-out): the kit's full-screen sign-in, with "Forget this device".
import { signInScreen } from '@core/ui';
import { $, sectionScreen } from '../dom.js';
import { APP } from '../config.js';

/**
 * @param {import('../cloud.js').Started} app
 * @param {{ onForget: (ok: boolean) => void }} o  told whether this device was forgotten
 */
export function signedOutScreen(app, { onForget }) {
  signInScreen($('signed-out'), {
    name: APP.title, tagline: 'Your cards, in one place.', icon: 'icons/icon.svg', accent: '#558ac0', auth: app.auth, onForget,
  });
  return sectionScreen('signed-out');
}
