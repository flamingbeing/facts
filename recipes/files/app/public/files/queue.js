// The upload queue: the uploads and deletes this device still owes the Worker, one account's at a time, kept as JSON
// in the module's storage (ctx.storage(): `<name>:files/queue`, NOTES "Files formats"):
//   { v: 1, uid, jobs: Job[] }
//   Job { id, scope, op: 'put' | 'delete', parts: ['file', 'thumb'?] (put: the parts still to send), tries,
//         at (ms: not before), stuck?: why (refused: waits for retry or discard), rec? (put: the metadata record) }
// Pure: no network or timers here (module.js runs it), so the unit tests drive it with their own store and clock.

/** @typedef {import('./types').FileRecord} FileRecord */
/** @typedef {import('./types').Job} Job */
/** @typedef {{ get: (key: string) => any, set: (key: string, value: any) => void, remove: (key: string) => void }} Store */

const KEY = 'queue';
const MAX_DELAY = 5 * 60_000;

// the wait before try n+1: 2 s, 4 s, 8 s ... at most 5 minutes, each 75-125 % so phones don't retry in step
/** @param {number} tries @param {() => number} [random] */
export const backoff = (tries, random = Math.random) => Math.round(Math.min(MAX_DELAY, 1000 * 2 ** Math.max(1, tries)) * (0.75 + random() / 2));

/** @param {Store} store @param {{ now?: () => number, random?: () => number }} [o] */
export function createQueue(store, { now = Date.now, random = Math.random } = {}) {
  /** @returns {{ v: 1, uid: string, jobs: Job[] }} */
  const read = () => {
    const q = store.get(KEY);
    return q && q.v === 1 && typeof q.uid === 'string' && Array.isArray(q.jobs) ? q : { v: 1, uid: '', jobs: [] };
  };
  /** @param {string} uid @param {Job[]} jobs */
  const write = (uid, jobs) => { if (jobs.length) store.set(KEY, { v: 1, uid, jobs }); else store.remove(KEY); };
  /** @param {string} id @param {(j: Job) => Job | null} fn */
  const change = (id, fn) => {
    const q = read();
    write(q.uid, q.jobs.flatMap(j => { if (j.id !== id) return [j]; const n = fn(j); return n ? [n] : []; }));
  };

  return {
    /** the account whose jobs these are ('' when none) */
    owner: () => read().uid,
    /** @returns {Job[]} */
    jobs: () => read().jobs,
    /** @param {string} uid @param {Omit<Job, 'tries' | 'at'>} job  a new put, or a delete (which drops any put of that file) */
    add(uid, job) {
      const q = read();
      if (q.uid && q.uid !== uid && q.jobs.length) throw new Error('files: another account still has uploads on this device');
      const rest = q.jobs.filter(j => j.id !== job.id);
      write(uid, [...rest, { ...job, tries: 0, at: 0 }]);
    },
    /** @param {string} id  drop a job without sending it (a put of a file removed before it left the device) */
    drop: (/** @type {string} */ id) => change(id, () => null),
    /** the jobs due now, oldest first (stuck ones wait) */
    due: () => read().jobs.filter(j => !j.stuck && j.at <= now()),
    /** when the next job is due (ms), or null */
    next() { const at = read().jobs.filter(j => !j.stuck).map(j => j.at); return at.length ? Math.min(...at) : null; },
    /** @param {string} id @param {string} part  one part of a put was sent (the job stays until done()) */
    sent: (/** @type {string} */ id, /** @type {string} */ part) => change(id, j => ({ ...j, parts: (j.parts || []).filter(p => p !== part) })),
    done: (/** @type {string} */ id) => change(id, () => null),
    /** @param {string} id  a failure worth trying again later */
    later: (/** @type {string} */ id) => change(id, j => ({ ...j, tries: j.tries + 1, at: now() + backoff(j.tries + 1, random) })),
    /** @param {string} id @param {string} why  refused: waits for retry() or discard() */
    stuck: (/** @type {string} */ id, /** @type {string} */ why) => change(id, j => ({ ...j, stuck: why })),
    /** @param {string} [id]  try the stuck ones (or one) again now */
    retry(id) {
      const q = read();
      write(q.uid, q.jobs.map(j => (!id || j.id === id) ? (({ stuck, ...rest }) => ({ ...rest, tries: 0, at: 0 }))(j) : j));
    },
    /** at sign-in: everything waiting is due now (the same account) */
    wake() { const q = read(); write(q.uid, q.jobs.map(j => j.stuck ? j : { ...j, at: 0 })); },
    clear: () => store.remove(KEY),
  };
}
