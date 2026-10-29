// The page's shell (index.html: .ui-shell, the kit's bar, tab bar, side bar and drawer) and the Settings page: the kit's
// settingsScreen with the device's look and its About rows. A new app adds
// its pages as .ui-tab-page sections with a tab and a side link each, and keeps the rest.
import { startGestures, adaptiveShell, settingsScreen } from '@core/ui';
import { themeSwitch } from '@core/theme';
import { APP } from './config.js';
import { $ } from './dom.js';

// The shell starts first, as soon as the page's scripts have run, so the tabs and the menu work while the app is still
// starting; the Settings page follows (settingsPage) once the app and its options are there.
export function startShell() {
  const kit = startGestures();
  const shell = adaptiveShell(/** @type {HTMLElement} */ (document.querySelector('.ui-shell')), { screens: kit.screens });
  Object.assign(window, { kit, shell });   // for the tests
}

/** @param {{ settings: import('app-ui/settings/types').SettingsApi, update: import('app-ui/ui/types').UpdateApi | null } | null} app  null: not set up, so no Settings page */
export function settingsPage(app) {
  if (!app) {
    for (const id of ['tab-settings', 'side-settings']) $(id).hidden = true;
    return;
  }
  const { settings } = app;
  settingsScreen($('settings-host'), {
    settings,
    sections: [{ title: 'This device', mount: host => { themeSwitch(host); } }],
    about: { name: APP.title || APP.name, update: app.update },
  });
}
