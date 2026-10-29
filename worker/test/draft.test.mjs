import test from 'node:test';
import assert from 'node:assert/strict';
import { handleDraft, draftFilings, draftPrompt, MAX_TOPIC } from '../draft.js';
import { MODEL } from '../file.js';
import { DEFAULT_ADMINS } from '../members.js';

const ORIGIN = 'https://facts.anawj.com';
const TOKENS = { own: { sub: 'own', email: DEFAULT_ADMINS[0], email_verified: true }, bob: { sub: 'bob', email: 'bob@example.com', email_verified: true } };
const verify = async t => { if (!TOKENS[t]) throw new Error('bad'); return TOKENS[t]; };
const TOPICS = [['drugs/dobutamine', 'Dobutamine', ['Dosage', 'Effects']]];
const ask = (who, body, deps, method = 'POST') => handleDraft(new Request(ORIGIN + '/api/draft', {
  method, headers: who ? { Authorization: `Bearer ${who}` } : {}, body: method === 'POST' ? JSON.stringify(body) : undefined }), { verify, ...deps });

test('draft: owner only; POST only; a topic is needed and short', async () => {
  assert.equal((await ask('', { topic: 'x' }, {})).status, 401);
  assert.equal((await ask('bob', { topic: 'x' }, { ask: async () => '' })).status, 403);
  assert.equal((await ask('own', {}, {}, 'GET')).status, 405);
  assert.equal((await ask('own', { topic: ' ' }, { ask: async () => '' })).status, 400);
  assert.equal((await ask('own', { topic: 'x'.repeat(MAX_TOPIC + 1) }, { ask: async () => '' })).status, 400);
  assert.equal((await ask('own', { topic: 'Madeupamine' }, { ask: null })).status, 503);
});

test('draft: every returned item is marked drafted; the picked model is used; junk is 502', async () => {
  let used;
  const model = async (p, m) => {
    used = m;
    return JSON.stringify({ items: [
      { topic: 'drugs/madeupamine', title: 'Madeupamine', section: 'Effects', line: '- Raises the heart rate' },
      { topic: 'drugs/madeupamine', section: 'Dosage', line: 'Starts at 5 mcg/kg/min' },
      { topic: 'drugs/madeupamine', section: 'Dosage', line: '' },
    ] });
  };
  const r = await ask('own', { topic: 'Madeupamine', topics: TOPICS, model: 'haiku' }, { ask: model });
  assert.equal(r.status, 200);
  const { items } = await r.json();
  assert.equal(items.length, 2);
  assert.ok(items.every(i => i.drafted === true));
  assert.equal(items[0].line, 'Raises the heart rate');
  assert.equal(items[0].isNew, true);
  assert.equal(items[1].line, 'Starts at 5 mcg/kg/min');
  assert.equal(used, 'claude-haiku-5-5');
  await ask('own', { topic: 'Madeupamine' }, { ask: async (p, m) => { used = m; return 'nothing'; } });
  assert.equal(used, MODEL);
  assert.equal((await ask('own', { topic: 'Madeupamine' }, { ask: async () => 'nothing' })).status, 502);
  assert.equal((await ask('own', { topic: 'Madeupamine' }, { ask: async () => { throw new Error('boom'); } })).status, 502);
  assert.match(draftPrompt('Madeupamine', TOPICS), /Madeupamine/);
  assert.deepEqual(draftFilings('{"items":[]}', new Set()), []);
});

test('draft: local returns one canned drafted item', async () => {
  const r = await ask('own', { topic: 'Madeupamine', topics: TOPICS }, { local: true });
  assert.deepEqual((await r.json()).items.map(i => [i.topic, i.drafted]), [['drugs/dobutamine', true]]);
});
