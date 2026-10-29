// @core/settings: settings(options) -> a module for createApp({ config, modules }) (app-sync's runner), needs sync.
// The app names every option it allows; nothing else can be saved. Each option is kept on this device or on the
// account, and a profile can give some of them other defaults.
//
// settings({ options, profiles, collection, scope, win })
//   options     { key: { scope: 'device' | 'account', default, clean, portable } }, see schema.js. A new option is off.
//   profiles    { id: { label, defaults: { key: value } } } (optional)
//   collection  the sync collection of the account record (default 'settings'; the app lists it in sync's colls and its
//               rules): one record per person, its id the account's uid, one field per account option, plus `profile`
//   scope       the sync scope (a string, or (user) => string; default '_', the starter's one group)
//
// -> api
//   get(key)            the value in force: saved, else the active profile's default, else the option's default
//   set(key, value)     save it (null or undefined: forget the saved one). A device value is kept at once on this device;
//                       an account value goes through sync.save (works offline; needs a signed-in account). Throws on
//                       a key the app did not list or a value its clean refuses.
//   watch(key | null, fn) -> off: fn(value, key) when the value in force changes (here, on another device, or by a
//                       profile); key null: any option
//   activeProfile()     the active profile's id (null: none)
//   profile(id)         picks one (null: none) and clears the saved values of every
//                       option a profile governs, so this device and account follow the profile
//   isCustom()          true when a governed option was then set by hand to something else than the profile gives
//   profiles()          [{ id, label }]
//   exportFile()        the settings file text (account options only, never what stays on a device)
//   importFile(text)    -> { changed: [keys], dropped: [keys] }; a bad file throws a plain sentence, nothing is applied
//   follow()            -> stop: listens to the account record on the server (other devices' changes arrive). Call it
//                       once the app is allowed to listen (when its role is known, where it watches its own lists)
// Sign-out keeps the device values and the copy of the account record (the same account carries on); a switch to
// another account or forget() wipes both, like sync's device copy.
import { compile, savedValue, valueOf, isCustom, same } from './schema.js';
import { writeFile, readFile } from './file.js';

/** @typedef {import('./types').SettingsOptions} SettingsOptions */
/** @typedef {import('./types').SettingsApi} SettingsApi */

/** @param {string} msg */
const fail = msg => new Error('settings: ' + msg);

/** @param {SettingsOptions} options @returns {{ name: 'settings', needs: string[], start: (ctx: any, deps: any) => Promise<SettingsApi>, stop: () => void }} */
export function settings(options) {
  const cfg = compile(options);
  const collection = options.collection ?? 'settings';
  const scopeOf = typeof options.scope === 'function' ? options.scope : () => /** @type {string} */ (options.scope ?? '_');
  /** @type {() => void} */
  let halt = () => {};

  return {
    name: 'settings', needs: ['sync'],
    async start(ctx, { sync }) {
      const store = ctx.storage('settings');
      /** @type {Record<string, unknown>} */
      let device = {};
      /** @type {Record<string, any> | null} */
      let rec = null;   // this account's record as last heard (or kept)
      /** @type {Map<string, Set<(v: unknown, key: string) => void>>} */
      const watchers = new Map();
      let stopped = false;
      let gen = 0;   // bumped when the stored copies are wiped, so a late failed save cannot bring them back

      const uid = () => /** @type {string | null} */ (ctx.user()?.uid ?? null);
      const spec = (/** @type {string} */ key) => {
        const s = cfg.specs.get(key);
        if (!s) throw fail(`${JSON.stringify(key)} is not an option`);
        return s;
      };
      const profileId = () => (rec && typeof rec.profile === 'string' && cfg.profiles.has(rec.profile) ? rec.profile : null);
      const savedOf = (/** @type {string} */ key) => {
        const s = /** @type {import('./schema.js').Spec} */ (cfg.specs.get(key));
        return savedValue(s, s.scope === 'device' ? device[key] : rec?.[key]);
      };
      const all = () => Object.fromEntries([...cfg.specs.keys()].map(k => [k, valueOf(cfg, k, savedOf(k), profileId())]));
      let shown = all();
      // tell the watchers about every value in force that is not what they last heard
      const notify = () => {
        const now = all();
        for (const [key, v] of Object.entries(now)) {
          if (same(v, shown[key])) continue;
          shown[key] = v;
          for (const fn of [...(watchers.get(key) || []), ...(watchers.get('') || [])]) {
            try { fn(v, key); } catch (e) { ctx.report({ event: 'settings-watch', why: /** @type {Error} */ (e)?.message }); }
          }
        }
      };

      const loadDevice = () => {
        const d = store.get('device');
        device = {};
        if (d && d.v === 1 && d.values && typeof d.values === 'object') {
          for (const s of cfg.specs.values()) if (s.scope === 'device') { const v = savedValue(s, d.values[s.key]); if (v !== undefined) device[s.key] = v; }
        }
      };
      const keepDevice = () => { if (Object.keys(device).length) store.set('device', { v: 1, values: device }); else store.remove('device'); };
      const loadRec = () => {
        const a = store.get('account');
        rec = a && a.uid && a.uid === uid() && a.rec && typeof a.rec === 'object' ? a.rec : null;
      };
      const keepRec = () => { const id = uid(); if (id && rec) store.set('account', { uid: id, rec }); else store.remove('account'); };
      const wipe = () => { gen++; store.remove('device'); store.remove('account'); device = {}; rec = null; notify(); };

      loadDevice(); loadRec();
      shown = all();

      // the account record as the app saves it: only its own fields (the server's stay the server's)
      /** @param {Record<string, unknown>} patch  account option keys and `profile`; null forgets one */
      const commit = async patch => {
        const id = uid();
        if (!id) throw fail('sign in first (account options belong to an account)');
        const before = rec;
        /** @type {Record<string, any>} */
        const next = { id, ...Object.fromEntries(Object.entries(before || {}).filter(([k, v]) => v !== null && (k === 'profile' || cfg.specs.get(k)?.scope === 'account'))), ...patch };
        for (const k of Object.keys(next)) if (next[k] === null && k !== 'id' && !(k in patch)) delete next[k];
        rec = next; keepRec(); notify();
        const mine = gen;
        try {
          await sync.save(collection, scopeOf(ctx.user()), next, sync.copyOf(collection, id) || before);
        } catch (e) { if (gen === mine && rec === next) { rec = before; keepRec(); notify(); } throw e; }
      };

      // a change to some options and/or the profile, in one account write: `account` keys already cleaned
      /** @param {Record<string, unknown>} values  key -> cleaned value, or null to forget
       * @param {{ profile?: string | null }} [more] */
      const apply = async (values, more = {}) => {
        /** @type {Record<string, unknown>} */
        const patch = {};
        let touchedDevice = false;
        for (const [key, v] of Object.entries(values)) {
          if (spec(key).scope === 'device') {
            if (v === null) delete device[key]; else device[key] = v;
            touchedDevice = true;
          } else patch[key] = v;
        }
        if ('profile' in more) patch.profile = more.profile;
        if (Object.keys(patch).length) {
          if (touchedDevice) keepDevice();
          await commit(patch);   // (notifies itself; a throw undoes the account part only)
        } else if (touchedDevice) { keepDevice(); notify(); }
      };

      /** @type {SettingsApi} */
      const api = {
        get: key => { spec(key); return shown[key]; },
        async set(key, value) {
          const s = spec(key);
          if (value === null || value === undefined) return apply({ [key]: null });
          const c = s.clean(value);
          if (c === undefined) throw fail(`${key} refuses that value`);
          return apply({ [key]: c });
        },
        watch(key, fn) {
          if (key !== null) spec(key);
          const k = key ?? '';
          if (!watchers.has(k)) watchers.set(k, new Set());
          /** @type {Set<any>} */ (watchers.get(k)).add(fn);
          return () => { watchers.get(k)?.delete(fn); };
        },
        activeProfile: profileId,
        async profile(id) {
          if (id !== null && !cfg.profiles.has(id)) throw fail(`${JSON.stringify(id)} is not a profile`);
          return apply(Object.fromEntries([...cfg.governed].map(k => [k, null])), { profile: id });
        },
        isCustom: () => isCustom(cfg, profileId(), savedOf),
        profiles: () => [...cfg.profiles.values()].map(({ id, label }) => ({ id, label })),
        exportFile: () => JSON.stringify(writeFile(cfg, Object.fromEntries([...cfg.specs.keys()].map(k => [k, savedOf(k)])), profileId()), null, 2),
        async importFile(text) {
          const f = readFile(cfg, text);
          /** @type {Record<string, unknown>} */
          const values = {};
          for (const [k, v] of Object.entries(f.settings)) values[k] = v;
          const before = { ...shown };
          const profileChanges = f.profile !== null && f.profile !== profileId();
          // choosing the file's profile clears what the old one governed, then the file's own values go on top
          const clear = profileChanges ? Object.fromEntries([...cfg.governed].filter(k => spec(k).scope === 'account').map(k => [k, null])) : {};
          await apply({ ...clear, ...values }, profileChanges ? { profile: f.profile } : {});
          const changed = [...cfg.specs.keys()].filter(k => !same(before[k], shown[k]));
          return { changed, dropped: f.dropped };
        },
        follow() {
          const id = uid();
          if (!id) throw fail('sign in first');
          const off = sync.watch(scopeOf(ctx.user()), collection, (/** @type {any[]} */ list) => {
            if (stopped || uid() !== id) return;
            const mine = list.find(x => x && x.id === id && !x._deleted);
            rec = mine ? { ...mine } : null;
            keepRec(); notify();
          });
          return typeof off === 'function' ? off : () => {};
        },
      };

      const offs = [
        ctx.on('signin', () => { loadRec(); notify(); }),
        ctx.on('switch', wipe),
        ctx.on('forget', wipe),
      ];
      halt = () => { stopped = true; for (const off of offs) off(); watchers.clear(); };
      return api;
    },
    stop() { halt(); },
  };
}
