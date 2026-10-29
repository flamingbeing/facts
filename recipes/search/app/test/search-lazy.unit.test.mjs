// @core/search loads MiniSearch on first need: before it is in, words match as plain text and onReady runs once it
// is; prepare() builds the index from what was fed before. Its own file: MiniSearch must not be loaded yet.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSearch } from '../public/search/index.js';

test('a search before MiniSearch is in matches plain text, then onReady; after, typos match too', async () => {
  let ready = 0;
  const s = createSearch({ fields: ['title'], onReady: () => { ready++; } });
  s.feed([{ id: 'a', title: 'Laparoscopic cholecystectomy' }, { id: 'b', title: 'Open hernia repair' }]);
  assert.equal(typeof s.prepare, 'function');
  assert.deepEqual(s.search('chole').hits.map(h => h.id), ['a'], 'plain text before MiniSearch');
  assert.deepEqual(s.search('cholecystectmy').hits.map(h => h.id), [], 'no typo tolerance yet');
  await s.prepare();
  assert.equal(ready, 1, 'onReady once MiniSearch is in');
  s.update({ id: 'c', title: 'Cholecystectomy, converted' });
  assert.deepEqual(s.search('cholecystectmy').hits.map(h => h.id).sort(), ['a', 'c'], 'the index has what was fed before and after');
  s.remove('a');
  assert.deepEqual(s.search('chole').hits.map(h => h.id), ['c']);
  await s.prepare();
  assert.equal(ready, 1, 'onReady only once');
});

test('a second index after MiniSearch is in searches with it at once', () => {
  let ready = 0;
  const s = createSearch({ fields: ['title'], onReady: () => { ready++; } });
  s.feed([{ id: 'x', title: 'Appendicectomy' }]);
  assert.deepEqual(s.search('apendicectomy').hits.map(h => h.id), ['x']);
  assert.equal(ready, 0);
});
