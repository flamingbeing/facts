// The page's wiring: the shell and Settings page (shell.js), the kit's sync chip, the account block, and the screen
// switch. Align (screens/align.js) is the first tab and the screen of the "ready" phase; the sign-in, no-access and
// not-set-up screens show in its place (they sit in its page, index.html).
import { syncChip, plural, loadState, conflictSheet, refusedList } from '@core/ui';
import { start, usingEmulator, emulatorSignIn, lastSignedIn } from './cloud.js';
import { $ } from './dom.js';
import { VERDICTS } from './cards.js';
import { screenSwitch } from './screen-switch.js';
import { signedOutScreen } from './screens/signed-out.js';
import { noAccessScreen } from './screens/no-access.js';
import { notSetUpScreen } from './screens/not-set-up.js';
import { alignScreen } from './screens/align.js';
import { testScreen } from './screens/test.js';
import { addScreen } from './screens/add.js';
import { startShell, settingsPage } from './shell.js';

const typing = () => document.activeElement?.tagName === 'INPUT' && !!(/** @type {HTMLInputElement} */ (document.activeElement).value);
const sheetOpen = () => !!document.querySelector('dialog[open]');

// app-update (the update module): a new version installs in the background; the reload waits while someone types, a
// sheet is open or saves are unsent. (Off in the emulator tests unless ?sw is given.)
const withSW = 'serviceWorker' in navigator && (!usingEmulator || new URLSearchParams(location.search).has('sw'));

window.starter = { ready: false, signInAs: emulatorSignIn, files: () => app?.files, members: () => app?.members };   // for the tests
startShell();   // the tabs and menu work while the app starts
// this device was signed in last time: show Align's frame (skeleton cards) now, not a blank page or the sign-in screen
// while the sign-in is restored (cloud.js says signed out only once it has settled, and then the sign-in screen replaces it)
if (lastSignedIn()) {
  $('align-view').hidden = false;
  loadState($('align-state'), { rows: 3 }).loading();
}
const app = await start({ canReload: withSW ? () => !typing() && !sheetOpen() : null });
settingsPage(app);

if (!app) notSetUpScreen().show({ phase: 'not-set-up' });
else {
  // the chip and the tests' status read the whole app (sync and files), not the sync module alone: "Saved" only when
  // nothing is unsent anywhere, the same count sign-out reports. (The files module says 'saving'; the chip's word is 'pending'.)
  /** @param {(st: { state: string, count: number }) => void} fn */
  const chipStatus$ = fn => app.status$(st => {
    const state = st.state === 'saving' ? 'pending' : st.state;
    fn(state === 'synced' && st.unsent > 0 ? { state: 'pending', count: st.unsent } : { state, count: st.count });
  });
  syncChip($('sync-chip'), { sync: /** @type {any} */ ({ status$: chipStatus$ }) });   // (the chip reads only status$)
  chipStatus$(st => { window.starter.status = st.state; });
  const align = alignScreen(app);
  const test = testScreen(/** @type {any} */ (app));   // the quiz tab: shown once signed in with access (onState)
  const add = addScreen(/** @type {any} */ (app));   // the owner's tab: shown once the role says so (onState)
  // an answer that met a change from another device waits for a choice; one the server refused is kept: both show on Align
  /** @param {any} v */
  const verdictText = v => String(v?.text || v?.fact || '');
  conflictSheet($('conflict-sheet'), { sync: app.sync, text: verdictText });
  refusedList($('refused-list'), { sync: app.sync, kind: VERDICTS, text: verdictText });
  const show = screenSwitch({
    'signed-out': signedOutScreen(app, { onForget: ok => { if (ok) $('sign-out-msg').textContent = ''; } }),
    'no-access': noAccessScreen(),
    'not-set-up': notSetUpScreen(),
    ready: align,
  });
  $('sign-out').addEventListener('click', async () => {
    const unsent = await app.signOut();
    $('sign-out-msg').textContent = unsent
      ? `Signed out. ${plural(unsent, 'unsent change')} kept on this device; they send when you sign in again.`
      : 'Signed out. Your answers are kept on this device for your next sign-in.';
  });
  app.follow({
    onState(s) {
      $('who').textContent = s.user ? s.user.email : '';
      $('sign-out').hidden = !s.user;
      if (s.user) $('sign-out-msg').textContent = '';
      add.owner(s.role === 'admin');
      test.state(s);
      show(s);
    },
    onVerdicts(v) { align.verdicts(v); test.verdicts(v); window.starter.ready = true; },
    onRecall(r) { test.recall(r); },
  });
}
