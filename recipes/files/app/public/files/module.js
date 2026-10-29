// @core/files: files(options) -> a module for createApp({ config, modules }) (app-sync's runner), needs auth and sync
// (app-sync SHAPES.md row 6). A file's metadata is a sync record in a collection the app names (so it syncs, conflicts
// and counts like any save); its bytes go to the app's own Worker (/api/files/, worker/files.js, an R2 bucket) through
// an upload queue of this module's own.
//
// files({ collection, scope, maxBytes, image, exif, url, fetch, cache, token, now, win })
//   collection  the sync collection of the metadata records (the app lists it in sync's colls and its rules)
//   scope(user) the scope a file goes to when add() names none (default: the account's own uid, a personal file)
//   maxBytes    per-file cap (default 100 MB, the Worker's request limit); bigger files are refused at add()
//   image       { maxDim (2048), thumbDim (320), type ('image/webp'), quality (0.85) }: pictures are stored upright,
//               resized and re-encoded (EXIF and GPS dropped), with a thumbnail (image.js); other files as they are
//   exif        false (default) | true: read the date taken before the re-encode | { place: true }: and the GPS place
//   url         the Worker route (default '/api/files'); fetch, cache, token, now, win: stand-ins for tests
//
// -> api
//   add(file, { scope, extra }) -> { id, record }: at once, offline too. The record { id, name, type, size, w?, h?,
//     thumb?, taken?, place?, state: 'local', ...extra } is saved through sync.save; the bytes (and thumbnail) wait in
//     the device cache (IndexedDB `<name>-files`) and an upload job (ctx.storage: `<name>:files/queue`). Uploads run
//     when online and signed in, retry with back-off, and count as unsent in ctx.status (so sign-out says so, a switch
//     to another account waits, and the update's reload waits). Once sent, the record's state becomes 'stored'.
//   url(id, { scope, thumb }) -> an object URL: from the device cache, else fetched from the Worker and kept.
//     blob(id, { scope, thumb }) -> the Blob. A file not uploaded yet from another device: an error with status 404.
//   remove(idOrRecord, { scope }) -> the record's delete through sync (a tombstone), and the Worker delete queued.
//   jobs() -> the waiting jobs (stuck: refused, with why); retry(id?) tries stuck ones again; discard(id) drops one.
//   kick() -> sends what is due now (the module does this itself on sign-in, coming online and after add).
// Sign-out keeps the cache and the queue (they send at the same account's next sign-in); a switch to another account
// or forget() wipes both, like sync's device copy.
import { createQueue } from './queue.js';
import { deviceCache } from './cache.js';
import { prepareImage } from './image.js';

/** @typedef {import('./types').FilesOptions} FilesOptions */
/** @typedef {import('./types').FilesApi} FilesApi */
/** @typedef {import('./types').FileRecord} FileRecord */
/** @typedef {import('./types').Job} Job */

const SCOPE = /^[A-Za-z0-9_-]{1,128}$/;
// refused for good: waits for retry() or discard(); anything else (offline, 429, 5xx) is tried again later
const REFUSED = [400, 403, 404, 405, 411, 413, 415];

/** @param {string} msg @param {Record<string, unknown>} [more] */
const fail = (msg, more = {}) => Object.assign(new Error('files: ' + msg), more);
const newId = () => (globalThis.crypto?.randomUUID?.() || Date.now().toString(36) + Math.random().toString(36).slice(2)).replace(/-/g, '');

/** @param {FilesOptions} options @returns {{ name: 'files', needs: string[], start: (ctx: any, deps: any) => Promise<FilesApi>, stop: () => void }} */
export function files(options) {
  const { collection, scope: scopeOf = (/** @type {{ uid: string }} */ u) => u.uid, maxBytes = 100_000_000, image = {}, exif = false,
    url: base = '/api/files', now = Date.now } = options || /** @type {FilesOptions} */ ({});
  if (!collection || typeof collection !== 'string') throw new Error('files needs collection');
  const win = options && 'win' in options ? options.win : typeof window !== 'undefined' ? window : null;
  const fetchFn = options.fetch || ((/** @type {RequestInfo} */ a, /** @type {RequestInit} */ b) => globalThis.fetch(a, b));
  /** @type {() => void} */
  let halt = () => {};

  return {
    name: 'files', needs: ['auth', 'sync'],
    async start(ctx, { auth, sync }) {
      const q = createQueue(ctx.storage(), { now });
      const cache = options.cache || deviceCache(ctx.name);
      const token = options.token || (async (/** @type {boolean} */ force) => {
        const u = (await ctx.sdk())?.auth?.currentUser;
        if (!u) throw fail('signed out');
        return u.getIdToken(force);
      });
      /** @type {Map<string, string>} */
      const urls = new Map();
      /** @type {Map<string, Promise<string>>} */
      const making = new Map();   // url() calls on their way, so two at once share one object URL
      /** @type {Map<string, Promise<Blob>>} */
      const fetching = new Map();
      let stopped = false, again = false;
      /** @type {Promise<void> | null} */
      let busy = null;
      let gen = 0;   // wipes so far (see wipe)
      const putting = new Set();   // ids with a PUT on its way
      /** @type {ReturnType<typeof setTimeout> | null} */
      let timer = null;

      const online = () => { try { return win?.navigator?.onLine !== false; } catch { return true; } };
      const me = () => /** @type {{ uid: string } | null} */ (auth.user());
      const sending = () => online() && !!me() && me()?.uid === q.owner();
      const keyOf = (/** @type {string} */ scope, /** @type {string} */ id, thumb = false) => `${scope}/${id}${thumb ? '.thumb' : ''}`;
      const where = (/** @type {string} */ scope, /** @type {string} */ id, thumb = false) => `${base}/${keyOf(scope, id, thumb)}`;
      /** @param {string | undefined} scope */
      const scopeFor = scope => {
        const u = me();
        const s = scope ?? (u ? scopeOf(u) : '');
        if (!SCOPE.test(s)) throw fail(u ? `bad scope ${JSON.stringify(s)}` : 'sign in first');
        return s;
      };

      // the status: every waiting job is unsent; stuck ones need the person
      const tell = () => {
        if (stopped) return;
        const jobs = q.jobs();
        if (!jobs.length) { ctx.status.set(null); return; }
        const stuck = jobs.filter(j => j.stuck).length;
        ctx.status.set({ state: stuck ? 'attention' : sending() ? 'saving' : 'offline', count: stuck || jobs.length, unsent: jobs.length });
      };

      /** @param {string} method @param {string} path @param {Blob} [body] */
      const call = async (method, path, body) => {
        const go = async (/** @type {boolean} */ force) => fetchFn(path, { method, body, headers: {
          Authorization: 'Bearer ' + await token(force), ...(body ? { 'Content-Type': body.type || 'application/octet-stream' } : {}) } });
        const r = await go(false);
        return r.status === 401 ? go(true) : r;   // an old token: once more with a fresh one
      };

      /** @param {Job} job @param {Response} r */
      const refusedOrLater = (job, r) => {
        if (REFUSED.includes(r.status)) { q.stuck(job.id, `refused ${r.status}`); ctx.report({ event: 'files-refused', status: r.status, op: job.op }); }
        else q.later(job.id);
      };

      const stillPut = (/** @type {string} */ id) => q.jobs().some(j => j.id === id && j.op === 'put');
      // a put that has sent every part: the record says so (other devices can fetch it now), then the job is done
      /** @param {Job} job */
      const stored = async job => {
        const cur = /** @type {FileRecord | null} */ (sync.copyOf(collection, job.id)) || job.rec || null;
        if (cur && !cur._deleted && cur.state !== 'stored') await sync.save(collection, job.scope, { ...cur, state: 'stored' }, cur);
        if (stillPut(job.id)) q.done(job.id);
      };

      /** @param {Job} job */
      const one = async job => {
        if (job.op === 'delete') {
          const r = await call('DELETE', where(job.scope, job.id));
          if (r.ok) q.done(job.id); else refusedOrLater(job, r);
          return;
        }
        if (/** @type {FileRecord | null} */ (sync.copyOf(collection, job.id))?._deleted) {   // removed on another device first
          q.done(job.id);
          for (const t of [false, true]) await cache.del(keyOf(job.scope, job.id, t));
          return;
        }
        for (const part of job.parts || []) {
          const blob = await cache.get(keyOf(job.scope, job.id, part === 'thumb'));
          if (!blob) { q.stuck(job.id, 'lost'); return; }   // the browser cleared this site's storage
          putting.add(job.id);   // may reach the Worker from here on, so a remove() now queues a delete
          let r;
          try { r = await call('PUT', where(job.scope, job.id, part === 'thumb'), blob); } finally { putting.delete(job.id); }
          if (!stillPut(job.id)) return;   // removed meanwhile (its delete took the put's place)
          if (!r.ok) { refusedOrLater(job, r); return; }
          q.sent(job.id, part);
        }
        await stored(job);
      };

      const pass = async () => {
        for (const job of q.due()) {
          if (stopped || !sending()) return;
          if (!q.jobs().some(j => j.id === job.id && j.op === job.op)) continue;
          try { await one(job); } catch (e) { q.later(job.id); ctx.report({ event: 'files-retry', op: job.op, why: /** @type {Error} */ (e)?.message }); }
          tell();
        }
      };
      const schedule = () => {
        if (timer) clearTimeout(timer);
        timer = null;
        const at = q.next();
        if (stopped || at == null || !sending()) return;
        timer = setTimeout(() => { void kick(); }, Math.max(0, at - now()) + 50);
      };
      const kick = () => {
        if (stopped) return Promise.resolve();
        if (busy) { again = true; return busy; }
        // `busy` clears in the same tick as the last `again` check, so a kick in between is never lost
        busy = (async () => {
          try { do { again = false; await pass(); } while (again && !stopped); } finally { busy = null; tell(); schedule(); }
        })();
        return busy;
      };

      const revoke = () => { for (const u of urls.values()) URL.revokeObjectURL(u); urls.clear(); };
      // another account, or forget(): this device's files go (a throw refuses the switch; the old data stays)
      // `gen` moves on at each wipe, so a fetch that started before it neither refills the cache nor is shown
      const wipe = async () => { gen++; fetching.clear(); making.clear(); q.clear(); revoke(); await cache.clear(); tell(); };

      const offs = [
        ctx.on('signin', () => { q.wake(); tell(); void kick(); }),
        ctx.on('signout', () => { tell(); schedule(); }),
        ctx.on('switch', wipe),
        ctx.on('forget', wipe),
      ];
      const onOnline = () => { tell(); void kick(); };
      win?.addEventListener?.('online', onOnline);
      win?.addEventListener?.('offline', tell);
      halt = () => {
        stopped = true;
        for (const off of offs) off();
        win?.removeEventListener?.('online', onOnline);
        win?.removeEventListener?.('offline', tell);
        if (timer) clearTimeout(timer);
        revoke();
      };
      tell();   // unsent uploads from last time count before start resolves (the auth module reads them)
      ctx.ready.then(() => kick(), () => {});

      /** @param {string} id @param {{ scope?: string, thumb?: boolean }} [o] @returns {Promise<Blob>} */
      const blob = async (id, { scope, thumb = false } = {}) => {
        const s = scopeFor(scope), key = keyOf(s, id, thumb), g = gen;
        const have = await cache.get(key);
        if (g !== gen) throw fail('sign in first', { status: 401 });   // another account since
        if (have) return have;
        if (!fetching.has(key)) {
          const run = (async () => {
            if (!me()) throw fail('sign in first', { status: 401 });
            const r = await call('GET', where(s, id, thumb));
            if (!r.ok) throw fail(r.status === 404 ? 'not uploaded yet' : `fetch ${r.status}`, { status: r.status });
            const b = await r.blob();
            if (g !== gen) throw fail('sign in first', { status: 401 });   // another account since
            await cache.set(key, b).catch(() => {});   // shown anyway; fetched again next time
            return b;
          })().finally(() => { if (fetching.get(key) === run) fetching.delete(key); });
          fetching.set(key, run);
        }
        return /** @type {Promise<Blob>} */ (fetching.get(key));
      };

      return {
        async add(file, { scope, extra = {} } = {}) {
          const u = me();
          if (!u) throw fail('sign in first');
          if (!(file instanceof Blob)) throw new TypeError('files: add() takes a File or Blob');
          if (file.size > maxBytes) throw fail('too big', { code: 'too-big', max: maxBytes });
          const s = scopeFor(scope), id = newId(), g = gen;
          // another account (or forget) since this add began: its bytes and job must not land in the new account's device
          const moved = () => g !== gen || me()?.uid !== u.uid;
          // (offline before exif.js was ever loaded: no date taken, the photo is still added)
          const facts = exif && /^image\//.test(file.type) ? await import('./exif.js')
            .then(m => m.readExif(file, { place: typeof exif === 'object' && !!exif.place }), () => ({})) : {};
          const img = await prepareImage(file, image);
          if (moved()) throw fail('sign in first');
          const bytes = img ? img.blob : file;
          /** @type {FileRecord} */
          const record = {
            ...extra, id, name: String(/** @type {File} */ (file).name || 'file').slice(0, 255), type: bytes.type || 'application/octet-stream', size: bytes.size,
            ...(img ? { w: img.w, h: img.h, thumb: true } : {}), ...facts, state: 'local',
          };
          const unstash = async () => { await cache.del(keyOf(s, id)); await cache.del(keyOf(s, id, true)); };
          await cache.set(keyOf(s, id), bytes);
          if (img) await cache.set(keyOf(s, id, true), img.thumb);
          if (moved()) { await unstash(); throw fail('sign in first'); }
          q.add(u.uid, { id, scope: s, op: 'put', parts: img ? ['file', 'thumb'] : ['file'], rec: record });
          tell();
          try { await sync.save(collection, s, record, null); }
          catch (e) { q.drop(id); await unstash(); tell(); throw e; }
          void kick();
          return { id, record };
        },
        blob,
        async url(id, o = {}) {
          const key = keyOf(scopeFor(o.scope), id, !!o.thumb);
          const have = urls.get(key) || making.get(key);
          if (have) return have;
          const g = gen;
          const run = (async () => {
            const b = await blob(id, o);
            if (g !== gen) throw fail('sign in first', { status: 401 });
            const href = URL.createObjectURL(b);
            urls.set(key, href);
            return href;
          })().finally(() => { if (making.get(key) === run) making.delete(key); });
          making.set(key, run);
          return run;
        },
        async remove(x, { scope } = {}) {
          const u = me();
          if (!u) throw fail('sign in first');
          const id = typeof x === 'string' ? x : x?.id;
          if (!id) throw new TypeError('files: remove() takes an id or a record');
          const s = scopeFor(scope);
          const cur = typeof x === 'object' ? x : /** @type {FileRecord | null} */ (sync.copyOf(collection, id));
          // the record first: a delete the server refuses leaves the file and its upload as they were
          await sync.save(collection, s, { id, _deleted: true }, cur);
          const put = q.jobs().find(j => j.id === id && j.op === 'put');
          // a file that never left this device needs no delete on the Worker
          const neverSent = put && !putting.has(id) && (put.parts || []).length === (put.rec?.thumb ? 2 : 1);
          if (neverSent) q.drop(id); else q.add(u.uid, { id, scope: s, op: 'delete' });
          tell();
          for (const t of [false, true]) {
            const key = keyOf(s, id, t), href = urls.get(key);
            if (href) { URL.revokeObjectURL(href); urls.delete(key); }
            await cache.del(key);
          }
          void kick();
        },
        jobs: () => q.jobs(),
        retry(id) { q.retry(id); tell(); void kick(); },
        discard(id) { q.drop(id); tell(); },
        kick,
      };
    },
    stop() { halt(); },
  };
}
