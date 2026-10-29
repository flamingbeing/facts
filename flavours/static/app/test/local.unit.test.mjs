// local-store.js with app-sync's local store (in memory in Node): saves, deletes, watchers and the kit's empty SyncApi.
// node --test app/test/local.unit.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { createStores } from 'app-sync/store.js';
import { localStore } from '../src/local-store.js';

const ctx = () => {
  const told = [];
  return { told, status: { set: st => told.push(st) }, report: () => {} };
};
let n = 0;
const started = async () => {
  const c = ctx();
  const m = localStore({ createStores, prefix: `t${++n}:`, colls: ['items', 'settings'] });
  return { m, c, api: await m.start(c) };
};

test('a save is stored and heard; a _deleted save takes it out', async () => {
  const { m, c, api } = await started();
  assert.deepEqual(c.told, [{ state: 'synced', count: 0, unsent: 0 }]);
  assert.equal(api.kept, false, 'Node has no IndexedDB: memory, and the app is told');
  const heard = [];
  const off = api.watch('_', 'items', (list, meta) => heard.push([list.map(d => d.text), meta.changed]));
  assert.deepEqual(heard, [[[], []]]);
  await api.save('items', '_', { id: 'a', text: 'one' }, null);
  assert.deepEqual(heard[1], [['one'], ['a']]);
  assert.equal(typeof api.copyOf('items', 'a').updatedAt, 'number');
  await api.save('items', '_', { id: 'a', _deleted: true }, null);
  assert.deepEqual(heard[2], [[], ['a']]);
  assert.equal(api.copyOf('items', 'a'), null);
  off();
  await api.save('items', '_', { id: 'b', text: 'two' }, null);
  assert.equal(heard.length, 3, 'no word after off()');
  m.stop();
});

test('watchDoc: the one record, then null once it is gone', async () => {
  const { m, api } = await started();
  const seen = [];
  api.watchDoc(['items', 'x'], d => seen.push(d?.text ?? null));
  await api.save('items', '_', { id: 'y', text: 'other' }, null);
  await api.save('items', '_', { id: 'x', text: 'mine' }, null);
  await api.save('items', '_', { id: 'x', _deleted: true }, null);
  assert.deepEqual(seen, [null, 'mine', null]);
  m.stop();
});

test('the kit sees no conflicts or refused saves; unknown collections and scopes throw', async () => {
  const { m, api } = await started();
  assert.deepEqual(api.conflicts(), []);
  assert.deepEqual(api.queue.refused('items'), []);
  let st;
  api.status$(s => { st = s; });
  assert.deepEqual(st, { state: 'synced', count: 0 });
  await assert.rejects(api.save('nope', '_', { id: 'a' }, null), /not one of this app's collections/);
  await assert.rejects(api.save('items', 'other', { id: 'a' }, null), /no scope other/);
  m.stop();
});
