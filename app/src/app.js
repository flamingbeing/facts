// The page's wiring: the shell and Settings page (shell.js), the kit's sync chip, the account block, and the screen
// switch. The sample screens (screens/) show a list with add, edit, delete, conflicts and refused saves; a new app
// replaces them and keeps this wiring, cloud.js and the kit (@core/ui, @core/theme).
import { syncChip, plural, loadState } from '@core/ui';
import { start, usingEmulator, emulatorSignIn, lastSignedIn, keepList, keptList } from './cloud.js';
import { $ } from './dom.js';
import { screenSwitch } from './screen-switch.js';
import { signedOutScreen } from './screens/signed-out.js';
import { noAccessScreen } from './screens/no-access.js';
import { notSetUpScreen } from './screens/not-set-up.js';
import { listScreen } from './screens/list.js';
import { startShell, settingsPage } from './shell.js';

const typing = () => document.activeElement?.tagName === 'INPUT' && !!(/** @type {HTMLInputElement} */ (document.activeElement).value);
const sheetOpen = () => !!document.querySelector('dialog[open]');

// app-update (the update module): a new version installs in the background; the reload waits while someone types, a
// sheet is open or saves are unsent. (Off in the emulator tests unless ?sw is given.)
const withSW = 'serviceWorker' in navigator && (!usingEmulator || new URLSearchParams(location.search).has('sw'));

window.starter = { ready: false, add: text => app?.add(text), signInAs: emulatorSignIn, files: () => app?.files, members: () => app?.members };   // for the tests
startShell();   // the tabs and menu work while the app starts
// this device was signed in last time: show the list's frame (skeleton rows) now, not a blank page or the sign-in screen
// while the sign-in is restored (cloud.js says signed out only once it has settled, and then the sign-in screen replaces it)
if (lastSignedIn()) {
  $('list-view').hidden = false; $('add').hidden = true;
  // the list as it was last drawn, read-only, until the real one arrives (list.js replaces every row)
  const kept = keptList();
  if (kept.length) $('items').replaceChildren(...kept.map(r => {
    const li = document.createElement('li'), b = document.createElement('button');
    b.type = 'button'; b.textContent = r.text; b.disabled = true;
    li.append(b);
    return li;
  }));
  else loadState($('items-state')).loading();
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
  const list = listScreen(app);
  const show = screenSwitch({
    'signed-out': signedOutScreen(app, { onForget: ok => { if (ok) $('sign-out-msg').textContent = ''; } }),
    'no-access': noAccessScreen(),
    'not-set-up': notSetUpScreen(),
    ready: list,
  });
  $('sign-out').addEventListener('click', async () => {
    const unsent = await app.signOut();
    $('sign-out-msg').textContent = unsent
      ? `Signed out. ${plural(unsent, 'unsent change')} kept on this device; they send when you sign in again.`
      : 'Signed out. The list is kept on this device for your next sign-in.';
  });
  app.follow({
    onState(s) {
      $('who').textContent = s.user ? s.user.email : '';
      $('sign-out').hidden = !s.user;
      if (s.user) $('sign-out-msg').textContent = '';
      show(s);
    },
    onList(items, changed) {
      list.draw(items, changed);
      keepList(list.shown());
      window.starter.ready = true;
    },
    onFiles(by) { list.drawFiles(by); },
  });
}
