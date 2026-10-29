// The app's data on this device only, no sign-in (a static app; `node tools/add.mjs cloud` turns it into the cloud app,
// cloud.js): createApp({ config, modules: [localStore(), settings(), update()] }) from app-sync, the same runner the cloud
// app uses, so the screens and the kit's parts take this app as they take the cloud one (items.js, ItemsApp).
//
// IndexedDB layout (app-sync's local store, @core/store): one database, <name>:_ , with a store per collection
//   items      { id, text, updatedAt }   the list
//   settings   (kept for the account options a cloud app has; a static app's options are this device's, in localStorage)
// Nothing leaves the device: clearing the site's data in the browser clears the list.
import { createApp } from '@core/app';
import { createStores } from '@core/store';
import { update } from '@core/update';
import { settings } from '@core/settings';
import * as register from 'app-update/register.js';
import { APP } from './config.js';
import { OPTIONS, SETTINGS_COLL } from './options.js';
import { COLL } from './items.js';
import { localStore } from './local-store.js';

const SPACE = '_';
/** @typedef {import('./items.js').Item} Item */
/** @typedef {import('./items.js').State} State */
/**
 * @typedef {object} Hooks
 * @property {(s: State) => void} onState
 * @property {(items: Item[], changed: Set<string>) => void} onList  the list; changed: the ids whose copy changed since
 *   the last call (none the first time)
 */
/** @typedef {Awaited<ReturnType<typeof start>>} Started */

// start({ canReload }) -> the modules' apis (for the UI kit) and the app's actions. canReload: with a service worker,
// the app's own "nothing open" answer for the update's reload; none: no update module. Nothing shows until follow(hooks).
/** @param {{ canReload?: (() => boolean | Promise<boolean>) | null }} o */
export async function start({ canReload = null }) {
  const modules = [
    localStore({ createStores, prefix: `${APP.name}:`, colls: [COLL, SETTINGS_COLL], scope: SPACE }),
    settings({ options: OPTIONS, collection: SETTINGS_COLL, scope: SPACE }),
    ...(canReload ? [update({ register, app: 'app', sw: 'sw.js', canReload })] : []),
  ];
  const app = createApp({ config: { name: APP.name }, modules });
  await app.ready;
  const sync = /** @type {import('./local-store.js').LocalSync} */ (app.sync);
  const id = () => (crypto.randomUUID?.() || String(Date.now()) + Math.random().toString(36).slice(2)).replace(/-/g, '');
  /** @param {Promise<unknown>} saving */
  const stored = saving => saving.then(() => '', e => (e instanceof Error && e.message) || 'Not saved');
  return {
    // the modules' apis, for the UI kit's parts (update: with a service worker only, else null)
    sync, settings: app.settings, update: app.update || null,
    /** @param {(st: { state: string, count: number, unsent: number }) => void} fn */
    status$: fn => app.status$(fn),
    // from now on: onState with the one screen there is, onList with the list
    /** @param {Hooks} h */
    follow({ onState, onList }) {
      onState({ phase: 'ready', role: 'admin' });
      let first = true;
      sync.watch(SPACE, COLL, (list, { changed }) => {
        onList(/** @type {Item[]} */ (list.filter(x => !x._deleted)), new Set(first ? [] : changed));
        first = false;
      });
    },
    // add and edit resolve to '' once stored, or to the reason it could not be (the device's storage refused it)
    /** @param {string} text @returns {Promise<string>} */
    add: text => stored(sync.save(COLL, SPACE, { id: id(), text, createdAt: Date.now() }, null)),
    /** @param {Item} item @param {string} text @returns {Promise<string>} */
    edit: (item, text) => stored(sync.save(COLL, SPACE, { ...item, text }, item)),
    /** @param {Item} item @param {unknown[]} [_attached] */
    remove: async (item, _attached = []) => { await sync.save(COLL, SPACE, { id: item.id, _deleted: true }, item); },
    /** @param {string} itemId @param {(item: Item | null) => void} cb @returns {() => void} */
    watchItem: (itemId, cb) => sync.watchDoc([COLL, itemId], d => cb(/** @type {Item | null} */ (d))),
  };
}
