// This device's list, kept in IndexedDB (app-sync's local store, @core/store; in memory where there is none): a
// module named sync for createApp, so @core/settings and the kit's parts (conflict sheet, refused list) take it as they
// take the cloud engine. There is no server, so nothing is ever unsent, in conflict or refused. Other tabs of the app
// hear each save (BroadcastChannel).
//
//   localStore({ createStores, prefix, colls, scope }) -> { name: 'sync', needs: [], start(ctx) -> api, stop }
//   api: save(coll, scope, rec, base), watch(scope, coll, cb(list, { changed })) -> off, watchDoc(path, cb) -> off,
//        copyOf(coll, id), kept, status$, conflicts, describe, resolve, queue (the kit's SyncApi, always empty)
//   kept: false when the browser refused IndexedDB (a private window; app-sync's store then keeps to memory): the
//        device holds the only copy, so the app says the list goes when the page closes
// createStores is passed in (the app gives @core/store's; the unit tests the npm copy's, which keeps to memory in Node).

/** @typedef {{ id: string, _deleted?: boolean, [field: string]: any }} Doc  a record (updatedAt: when it was saved here) */
/** @typedef {(list: Doc[], meta: { changed: string[] }) => void} Watcher */
/** @typedef {{ coll: string, put: Doc[], del: string[] }} Change */
/** @typedef {Awaited<ReturnType<ReturnType<typeof localStore>['start']>>} LocalSync  the module's api (app.sync) */

/**
 * @param {{ createStores: typeof import('@core/store').createStores, prefix: string, colls: string[], scope?: string }} o
 */
export function localStore({ createStores, prefix, colls, scope: only = '_' }) {
  /** @type {() => void} */
  let halt = () => {};
  return {
    name: 'sync', needs: /** @type {string[]} */ ([]),
    /** @param {any} ctx */
    async start(ctx) {
      const { openStore } = createStores({ prefix, colls, metaOnly: [] });
      const store = await openStore(only);
      const kept = store.kind !== 'memory';
      if (!kept) ctx.report({ event: 'local-memory', why: 'IndexedDB refused: the list lasts this page only' });
      /** @type {Map<string, Map<string, Doc>>} */
      const data = new Map();
      for (const coll of colls) data.set(coll, new Map((await store.load(coll)).docs.map(d => [d.id, d])));
      /** @type {Map<string, Set<Watcher>>} */
      const watchers = new Map();
      /** @type {Set<(st: { state: string, count: number }) => void>} */
      const statusSubs = new Set();
      const known = (/** @type {string} */ coll) => {
        const m = data.get(coll);
        if (!m) throw new Error(`${coll} is not one of this app's collections (${colls.join(', ')})`);
        return m;
      };
      const listOf = (/** @type {string} */ coll) => [...known(coll).values()].map(d => ({ ...d }));
      // the change put into this tab's copy, then told to the watchers
      const apply = (/** @type {Change} */ { coll, put, del }) => {
        const m = known(coll);
        for (const d of put) m.set(d.id, d);
        for (const id of del) m.delete(id);
        const changed = [...put.map(d => d.id), ...del];
        for (const fn of [...(watchers.get(coll) || [])]) {
          try { fn(listOf(coll), { changed }); } catch (e) { ctx.report({ event: 'local-watch', why: /** @type {Error} */ (e)?.message }); }
        }
      };
      const channel = typeof BroadcastChannel === 'function' ? new BroadcastChannel(`${prefix}${only}`) : null;
      if (channel) channel.onmessage = e => { if (data.has(e.data?.coll)) apply(e.data); };
      ctx.status.set({ state: 'synced', count: 0, unsent: 0 });

      const checkScope = (/** @type {string} */ s) => { if (s !== only) throw new Error(`no scope ${s} on this device (only ${only})`); };
      const api = {
        // stored when it resolves; a record with _deleted takes the item out (base: unused, there is no one to clash with)
        /** @param {string} coll @param {string} s @param {Doc} rec @param {Doc | null} [_base] */
        async save(coll, s, rec, _base) {
          checkScope(s); known(coll);
          if (!rec?.id) throw new Error('save needs a record with an id');
          /** @type {Change} */
          const change = rec._deleted ? { coll, put: [], del: [rec.id] }
            : { coll, put: [JSON.parse(JSON.stringify({ ...rec, updatedAt: Date.now() }))], del: [] };
          await store.write(coll, { put: change.put, del: change.del });
          apply(change);
          channel?.postMessage(change);
          return rec.id;
        },
        /** @param {string} s @param {string} coll @param {Watcher} cb */
        watch(s, coll, cb) {
          checkScope(s); known(coll);
          if (!watchers.has(coll)) watchers.set(coll, new Set());
          /** @type {Set<Watcher>} */ (watchers.get(coll)).add(cb);
          cb(listOf(coll), { changed: [] });
          return () => { watchers.get(coll)?.delete(cb); };
        },
        // one record: path [..., coll, id] (the cloud's Firestore path works too); cb(null) once it is gone
        /** @param {string[]} path @param {(doc: Doc | null) => void} cb */
        watchDoc(path, cb) {
          const [coll, id] = path.slice(-2);
          const off = api.watch(only, coll, (list, { changed }) => {
            if (changed.length && !changed.includes(id)) return;
            cb(list.find(d => d.id === id) ?? null);
          });
          return off;
        },
        /** @param {string} coll @param {string} id */
        copyOf: (coll, id) => { const d = known(coll).get(id); return d ? { ...d } : null; },
        kept,
        // the kit's SyncApi: always saved, never a conflict or a refused save
        /** @param {(st: { state: string, count: number }) => void} cb */
        status$(cb) { statusSubs.add(cb); cb({ state: 'synced', count: 0 }); return () => { statusSubs.delete(cb); }; },
        conflicts: () => /** @type {{ key: string }[]} */ ([]),
        describe: (/** @type {string} */ _key) => null,
        resolve: async (/** @type {string} */ _key, /** @type {unknown} */ _choice) => null,
        queue: {
          refused: (/** @type {string} */ _kind) => [],
          retry: async (/** @type {string} */ _key) => null,
          discard: async (/** @type {string} */ _key) => null,
          onChange: (/** @type {() => void} */ _cb) => () => {},
        },
      };
      halt = () => { channel?.close(); watchers.clear(); statusSubs.clear(); store.close(); };
      return api;
    },
    stop() { halt(); },
  };
}
