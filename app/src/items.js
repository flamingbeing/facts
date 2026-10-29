// The list's shared bits, the same whichever data side the app has (cloud.js: sign-in and sync; a static app's
// local.js: this device only): the collection, an item's text, the refused-save line and the shapes the screens use.
export const COLL = 'items';
/** @param {unknown} record  an item, or a refused save's record -> its text (the list, its sheets and search) */
export const itemText = record => String(/** @type {{ text?: unknown } | null} */ (record)?.text ?? '');
/** what the page says when the server refused a save at once (its copy waits in the refused list) */
export const REFUSED = 'The server refused that. A copy is kept in the refused list.';

/** @typedef {{ id: string, text: string, updatedAt?: unknown, _deleted?: boolean } & Record<string, unknown>} Item */
/** @typedef {{ uid: string, email: string, name: string }} User */
/** @typedef {'not-set-up' | 'signed-out' | 'no-access' | 'ready'} Phase */
/** @typedef {{ phase: Phase, user?: User, role?: string }} State */

/**
 * What the screens use of the app (cloud.js start(); local.js in a static app). A slot or screen that needs more
 * (the files recipe) takes cloud.js's Started.
 * @typedef {object} ItemsApp
 * @property {import('app-ui/ui/types').SyncApi} sync  for the kit's conflict sheet and refused list
 * @property {import('app-ui/settings/types').SettingsApi} settings
 * @property {import('app-ui/ui/types').UpdateApi | null} update  with a service worker only
 * @property {(text: string) => Promise<string>} add  '' when stored or queued, else the reason it was refused
 * @property {(item: Item, text: string) => Promise<string>} edit  the same; item: the copy the edit started from
 * @property {(item: Item, attached?: unknown[]) => Promise<void>} remove
 * @property {(itemId: string, cb: (item: Item | null) => void) => () => void} watchItem  cb(null) once it is gone -> stop()
 */
