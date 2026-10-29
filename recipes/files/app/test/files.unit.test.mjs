// @core/files without a browser: the upload queue, the date a photo was taken (a JPEG with EXIF made here), and the
// module's upload rules with stand-ins for the engine, the Worker and the device cache.
//   node --test app/test/files.unit.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { createQueue, backoff } from '../public/files/queue.js';
import { readExif } from '../public/files/exif.js';
import { memoryCache } from '../public/files/cache.js';
import { files, fit } from '../public/files/index.js';

const memoryStore = () => {
  const m = new Map();
  return { m, get: k => m.get(k), set: (k, v) => m.set(k, JSON.parse(JSON.stringify(v))), remove: k => m.delete(k) };
};

test('queue: jobs belong to one account; a delete takes a put’s place; back-off grows to 5 minutes', () => {
  let t = 1000;
  const store = memoryStore(), q = createQueue(store, { now: () => t, random: () => 0.5 });
  q.add('u1', { id: 'a', scope: '_', op: 'put', parts: ['file', 'thumb'] });
  assert.equal(q.owner(), 'u1');
  assert.deepEqual(store.get('queue').jobs.map(j => j.id), ['a'], 'kept as { v: 1, uid, jobs }');
  assert.throws(() => q.add('u2', { id: 'b', scope: '_', op: 'put', parts: ['file'] }), /another account/);
  q.sent('a', 'file');
  assert.deepEqual(q.jobs()[0].parts, ['thumb']);
  q.later('a');
  assert.equal(q.due().length, 0);
  assert.equal(q.next(), 1000 + 2000);
  t = 3000;
  assert.equal(q.due().length, 1);
  q.add('u1', { id: 'a', scope: '_', op: 'delete' });
  assert.deepEqual(q.jobs().map(j => [j.id, j.op, j.tries]), [['a', 'delete', 0]]);
  q.stuck('a', 'refused 403');
  assert.equal(q.due().length, 0);
  assert.equal(q.next(), null);
  q.wake();
  assert.equal(q.due().length, 0, 'a stuck job waits for retry, sign-in or not');
  q.retry('a');
  assert.equal(q.due().length, 1);
  q.done('a');
  assert.equal(store.get('queue'), undefined, 'an empty queue leaves nothing behind');
  assert.equal(backoff(1, () => 0.5), 2000);
  assert.equal(backoff(30, () => 0.5), 300_000);
  assert.equal(backoff(30, () => 0), 225_000);
});

test('queue: an unknown or older format reads as empty', () => {
  const store = memoryStore();
  store.set('queue', { v: 2, uid: 'u1', jobs: [{ id: 'a' }] });
  assert.deepEqual(createQueue(store).jobs(), []);
});

test('fit keeps the shape and never enlarges', () => {
  assert.deepEqual(fit(4000, 3000, 2048), { w: 2048, h: 1536 });
  assert.deepEqual(fit(300, 200, 2048), { w: 300, h: 200 });
});

// A JPEG that is only its EXIF: IFD0 -> Exif IFD -> DateTimeOriginal (and GPS when asked), little-endian.
function jpegWithExif({ taken = '2024:05:06 07:08:09', gps = null } = {}) {
  const entries0 = [[0x8769, 4, 1, 0]];   // the Exif IFD's offset, filled below
  if (gps) entries0.push([0x8825, 4, 1, 0]);
  const ifd = n => 2 + 12 * n + 4;
  const exifAt = 8 + ifd(entries0.length), dateAt = exifAt + ifd(1), gpsAt = dateAt + 20, ratAt = gpsAt + ifd(4);
  const buf = Buffer.alloc(ratAt + (gps ? 48 : 0));
  buf.write('II', 0, 'ascii'); buf.writeUInt16LE(42, 2); buf.writeUInt32LE(8, 4);
  const writeIfd = (at, list) => {
    buf.writeUInt16LE(list.length, at);
    list.forEach(([tag, type, count, value], i) => {
      const e = at + 2 + 12 * i;
      buf.writeUInt16LE(tag, e); buf.writeUInt16LE(type, e + 2); buf.writeUInt32LE(count, e + 4);
      if (type === 2 && count <= 4) buf.write(value, e + 8, 'ascii'); else buf.writeUInt32LE(value, e + 8);
    });
    buf.writeUInt32LE(0, at + 2 + 12 * list.length);
  };
  entries0[0][3] = exifAt;
  if (gps) entries0[1][3] = gpsAt;
  writeIfd(8, entries0);
  writeIfd(exifAt, [[0x9003, 2, 20, dateAt]]);
  buf.write(taken + '\0', dateAt, 'ascii');
  if (gps) {
    writeIfd(gpsAt, [[1, 2, 2, gps.lat < 0 ? 'S' : 'N'], [2, 5, 3, ratAt], [3, 2, 2, gps.lng < 0 ? 'W' : 'E'], [4, 5, 3, ratAt + 24]]);
    [Math.abs(gps.lat), Math.abs(gps.lng)].forEach((deg, k) => {
      const at = ratAt + 24 * k;
      buf.writeUInt32LE(Math.round(deg * 1e6), at); buf.writeUInt32LE(1e6, at + 4);
      buf.writeUInt32LE(0, at + 8); buf.writeUInt32LE(1, at + 12); buf.writeUInt32LE(0, at + 16); buf.writeUInt32LE(1, at + 20);
    });
  }
  const app1 = Buffer.concat([Buffer.from('Exif\0\0', 'ascii'), buf]);
  const len = Buffer.alloc(2); len.writeUInt16BE(app1.length + 2);
  return new Blob([Buffer.from([0xff, 0xd8, 0xff, 0xe1]), len, app1, Buffer.from([0xff, 0xd9])], { type: 'image/jpeg' });
}

test('readExif: the date taken; the place only when asked; nothing from other files', async () => {
  const photo = jpegWithExif({ gps: { lat: 1.3, lng: 103.8 } });
  assert.deepEqual(await readExif(photo), { taken: +new Date(2024, 4, 6, 7, 8, 9) });
  const both = await readExif(photo, { place: true });
  assert.equal(both.taken, +new Date(2024, 4, 6, 7, 8, 9));
  assert.ok(Math.abs(both.place.lat - 1.3) < 1e-6 && Math.abs(both.place.lng - 103.8) < 1e-6);
  assert.deepEqual(await readExif(new Blob(['not a picture'], { type: 'text/plain' })), {});
  assert.deepEqual(await readExif(new Blob(['broken'], { type: 'image/jpeg' })), {});
});

// The module with stand-ins: the engine (auth, sync), ctx (storage, status, events), the Worker (fetch) and the cache.
function rig({ online = true, answer = () => 201, gate = (/** @type {string} */ _m) => null, refuse = (/** @type {any} */ _rec) => false, cacheGate = null } = {}) {
  const on = {}, saved = [], calls = [], copies = new Map(), net = { online };
  let status = null, user = { uid: 'u1' };
  const ctx = {
    name: 't', storage: (() => { const s = memoryStore(); return () => s; })(), ready: Promise.resolve(),
    status: { set: v => { status = v; } }, report: () => {},
    on: (ev, fn) => { on[ev] = fn; return () => { delete on[ev]; }; },
  };
  const sync = {
    save: async (coll, scope, rec, base) => { if (refuse(rec)) throw Object.assign(new Error('refused'), { code: 'permission-denied' }); saved.push({ coll, scope, rec, base }); copies.set(rec.id, rec); },
    copyOf: (coll, id) => copies.get(id) || null,
  };
  const auth = { user: () => user };
  const mem = memoryCache();
  const cache = cacheGate ? { ...mem, set: async (k, v) => { await cacheGate(); return mem.set(k, v); } } : mem;
  const tokens = [];
  const mod = files({
    collection: 'files', scope: () => '_', cache, now: () => 0,
    token: async force => { tokens.push(!!force); return 'tok'; },
    fetch: async (url, init) => { calls.push([init.method, url, init.headers.Authorization]); await gate(init.method); return new Response(null, { status: answer(init.method, url, calls.length) }); },
    win: { navigator: { get onLine() { return net.online; } }, addEventListener() {}, removeEventListener() {} },
  });
  return { mod, ctx, deps: { auth, sync }, saved, calls, cache, net, on, tokens, status: () => status, signOut: () => { user = null; }, signIn: uid => { user = { uid }; }, copies };
}

test('module: a file added offline waits as unsent, sends when online, then its record says stored', async () => {
  const r = rig({ online: false });
  const api = await r.mod.start(r.ctx, r.deps);
  const { id, record } = await api.add(new Blob(['made-up notes'], { type: 'text/plain' }), { extra: { item: 'i1' } });
  assert.deepEqual({ ...record, id: '' }, { id: '', item: 'i1', name: 'file', type: 'text/plain', size: 13, state: 'local' });
  assert.deepEqual(r.saved.map(s => [s.coll, s.scope, s.rec.state, s.base]), [['files', '_', 'local', null]]);
  assert.deepEqual(r.status(), { state: 'offline', count: 1, unsent: 1 });
  assert.equal(await (await api.blob(id)).text(), 'made-up notes', 'from the device cache');
  await api.kick();
  assert.equal(r.calls.length, 0, 'nothing sent offline');

  r.net.online = true;
  await api.kick();
  assert.deepEqual(r.calls, [['PUT', `/api/files/_/${id}`, 'Bearer tok']]);
  assert.deepEqual(r.saved.at(-1).rec.state, 'stored');
  assert.equal(r.saved.at(-1).base.state, 'local', 'saved over the copy it started from');
  assert.deepEqual(api.jobs(), []);
  assert.equal(r.status(), null);
  r.mod.stop();
});

test('module: an old token is renewed once; a refusal is stuck until retry; too big is refused at add', async () => {
  let refuse = true;
  const r = rig({ answer: (m, u, n) => n === 1 ? 401 : refuse ? 403 : 201 });
  const api = await r.mod.start(r.ctx, r.deps);
  await assert.rejects(api.add(/** not a Blob */ ({ size: 1 })), TypeError);
  await api.add(new Blob([new Uint8Array(10)]));
  await api.kick();
  assert.deepEqual(r.tokens.slice(0, 2), [false, true]);
  assert.equal(api.jobs()[0].stuck, 'refused 403');
  assert.equal(r.status().state, 'attention');
  refuse = false;
  api.retry();
  await api.kick();
  assert.deepEqual(api.jobs(), []);
  r.mod.stop();
  const small = files({ collection: 'files', maxBytes: 5, cache: memoryCache(), token: async () => 't', win: null });
  const api2 = await small.start(r.ctx, r.deps);
  await assert.rejects(api2.add(new Blob(['123456'])), e => e.code === 'too-big');
  small.stop();
});

test('module: remove before upload needs no Worker delete; after upload it queues one; a switch wipes the device', async () => {
  const r = rig({ online: false });
  const api = await r.mod.start(r.ctx, r.deps);
  const a = await api.add(new Blob(['a'], { type: 'text/plain' }));
  await api.remove(a.id);
  assert.deepEqual(api.jobs(), [], 'never left the device');
  assert.equal(r.saved.at(-1).rec._deleted, true);
  assert.equal(await r.cache.get(`_/${a.id}`), null);

  r.net.online = true;
  const b = await api.add(new Blob(['b'], { type: 'text/plain' }));
  await api.kick();
  r.net.online = false;
  await api.remove(b.id);
  assert.deepEqual(api.jobs().map(j => j.op), ['delete']);
  r.net.online = true;
  await api.kick();
  assert.deepEqual(r.calls.at(-1).slice(0, 2), ['DELETE', `/api/files/_/${b.id}`]);

  r.net.online = false;
  const c = await api.add(new Blob(['c'], { type: 'text/plain' }));
  r.signOut();
  assert.equal(api.jobs().length, 1, 'sign-out keeps the queue');
  await r.on.switch();
  assert.deepEqual(api.jobs(), []);
  assert.equal(await r.cache.get(`_/${c.id}`), null);
  r.mod.stop();
});

// a fetch the test lets go of: gate() holds every call of one method until release()
function holder(method) {
  /** @type {(() => void)[]} */ const waiting = [];
  return {
    gate: (/** @type {string} */ m) => m === method ? new Promise(res => waiting.push(() => res(undefined))) : null,
    started: async () => { while (!waiting.length) await new Promise(res => setTimeout(res, 0)); },
    release: () => { for (const go of waiting.splice(0)) go(); },
  };
}

test('module: a remove while the first upload is on its way still deletes it on the Worker', async () => {
  const h = holder('PUT');
  const r = rig({ gate: h.gate });
  const api = await r.mod.start(r.ctx, r.deps);
  const a = await api.add(new Blob(['a'], { type: 'text/plain' }));
  await h.started();
  await api.remove(a.id);
  assert.deepEqual(api.jobs().map(j => j.op), ['delete']);
  h.release();
  await api.kick();
  assert.deepEqual(r.calls.map(c => c[0]), ['PUT', 'DELETE']);
  assert.deepEqual(api.jobs(), []);
  r.mod.stop();
});

test('module: a fetch that ends after a switch is neither cached nor shown', async () => {
  const h = holder('GET');
  const r = rig({ answer: () => 200, gate: h.gate });
  const api = await r.mod.start(r.ctx, r.deps);
  const shown = api.url('x1').then(() => 'shown', e => e.status);
  await h.started();
  await r.on.switch();
  h.release();
  assert.equal(await shown, 401);
  assert.equal(await r.cache.get('_/x1'), null);
  r.mod.stop();
});

test('module: an account switch while add() waits neither writes into the new account nor blocks its adds', async () => {
  const h = holder('set');
  const r = rig({ online: false, cacheGate: () => h.gate('set') });
  const api = await r.mod.start(r.ctx, r.deps);
  const first = api.add(new Blob(['a'], { type: 'text/plain' })).then(() => 'added', e => e.message);
  await h.started();
  await r.on.switch();
  r.signIn('u2');
  h.release();
  assert.match(await first, /sign in first/);
  assert.deepEqual(api.jobs(), [], 'nothing queued under the old account');
  assert.equal(r.saved.length, 0, 'no record saved into the new account');
  const b = api.add(new Blob(['b'], { type: 'text/plain' }));   // the new account's own add goes through
  await h.started();
  h.release();
  const { id } = await b;
  assert.deepEqual(api.jobs().map(j => j.id), [id]);
  r.mod.stop();
});

test('module: two url() calls at once share one object URL', async () => {
  const r = rig({ answer: () => 200 });
  const api = await r.mod.start(r.ctx, r.deps);
  const made = [], real = URL.createObjectURL;
  URL.createObjectURL = b => { const u = real(b); made.push(u); return u; };
  try {
    const [a, b] = await Promise.all([api.url('x1'), api.url('x1')]);
    assert.equal(a, b);
    assert.equal(made.length, 1, 'no second URL left unrevoked');
  } finally { URL.createObjectURL = real; r.mod.stop(); }
});

test('module: a remove the server refuses leaves the upload queued', async () => {
  const r = rig({ online: false, refuse: rec => !!rec._deleted });
  const api = await r.mod.start(r.ctx, r.deps);
  const a = await api.add(new Blob(['a'], { type: 'text/plain' }));
  await assert.rejects(api.remove(a.id), /refused/);
  assert.deepEqual(api.jobs().map(j => [j.id, j.op]), [[a.id, 'put']]);
  assert.equal(await (await r.cache.get(`_/${a.id}`)).text(), 'a', 'bytes kept');
  r.mod.stop();
});

test('module: a file deleted on another device before its upload is not sent', async () => {
  const r = rig({ online: false });
  const api = await r.mod.start(r.ctx, r.deps);
  const a = await api.add(new Blob(['a'], { type: 'text/plain' }));
  r.copies.set(a.id, { id: a.id, _deleted: true });
  r.net.online = true;
  await api.kick();
  assert.deepEqual(r.calls, [], 'no orphan bytes on the Worker');
  assert.deepEqual(api.jobs(), []);
  assert.equal(await r.cache.get(`_/${a.id}`), null);
  r.mod.stop();
});
