import test from 'node:test';
import assert from 'node:assert/strict';
import { handleDraft, draftFilings, draftPrompt, MAX_TOPIC } from '../draft.js';
import { MODELS } from '../file.js';
import { DEFAULT_ADMINS } from '../members.js';

const ORIGIN = 'https://facts.anawj.com';
const TOKENS = { own: { sub: 'own', email: DEFAULT_ADMINS[0], email_verified: true }, bob: { sub: 'bob', email: 'bob@example.com', email_verified: true } };
const verify = async t => { if (!TOKENS[t]) throw new Error('bad'); return TOKENS[t]; };
const TOPICS = [['drugs/dobutamine', 'Dobutamine', ['Dosage', 'Effects']]];
const AREA = { topics: [{ k: 'dobutamine', t: 'Dobutamine', f: [['d1', 'Effects', 'Raises the heart rate'], ['d2', 'Dosage', 'Starts at 2.5 mcg/kg/min']] }] };
const area = async a => (a === 'drugs' ? AREA : null);
const ask = (who, body, deps, method = 'POST') => handleDraft(new Request(ORIGIN + '/api/draft', {
  method, headers: who ? { Authorization: `Bearer ${who}` } : {}, body: method === 'POST' ? JSON.stringify(body) : undefined }), { verify, area, ...deps });
const reply = text => ({ text, stop: 'end_turn', usage: { input_tokens: 10, output_tokens: 5 } });

test('draft: owner only; POST only; a topic is needed and short', async () => {
  const m = async () => reply('');
  assert.equal((await ask('', { topic: 'x' }, {})).status, 401);
  assert.equal((await ask('bob', { topic: 'x' }, { ask: m })).status, 403);
  assert.equal((await ask('own', {}, {}, 'GET')).status, 405);
  assert.equal((await ask('own', { topic: ' ' }, { ask: m })).status, 400);
  assert.equal((await ask('own', { topic: 'x'.repeat(MAX_TOPIC + 1) }, { ask: m })).status, 400);
  assert.equal((await ask('own', { topic: 'Madeupamine' }, { ask: null })).status, 503);
});

test('draft: items are marked drafted; the picked model is used; a repeat of his line is a duplicate, never an edit', async () => {
  const used = [];
  const model = async (m, o) => {
    used.push(m);
    if (o.system.startsWith('You draft')) return reply(JSON.stringify({ items: [
      { topic: 'drugs/dobutamine', section: 'Effects', line: '- Raises the heart rate' },
      { topic: 'drugs/dobutamine', section: 'Dosage', line: 'Starts at 5 mcg/kg/min' },
      { topic: 'drugs/madeupamine', title: 'Madeupamine', section: 'Dosage', line: '' },
    ] }));
    return reply(JSON.stringify({ results: [{ n: 1, action: 'duplicate', id: 'd1' }, { n: 2, action: 'correct', id: 'd2', line: 'Starts at 5 mcg/kg/min', why: 'x' }] }));
  };
  const r = await ask('own', { topic: 'Dobutamine', topics: TOPICS, model: 'sonnet' }, { ask: model });
  assert.equal(r.status, 200);
  const { items } = await r.json();
  assert.equal(items.length, 2);
  assert.ok(items.every(i => i.drafted === true));
  assert.deepEqual(items.map(i => i.action), ['duplicate', 'new']);
  assert.equal(items[1].line, 'Starts at 5 mcg/kg/min');
  assert.equal(items[1].old, undefined);
  assert.deepEqual(used, [MODELS.sonnet, MODELS.sonnet]);
  assert.equal((await ask('own', { topic: 'Madeupamine' }, { ask: async () => reply('nothing') })).status, 502);
  assert.equal((await ask('own', { topic: 'Madeupamine' }, { ask: async () => { throw new Error('boom'); } })).status, 502);
  assert.match(draftPrompt(TOPICS), /drugs\/dobutamine/);
  assert.deepEqual(draftFilings('{"items":[]}', new Set()), []);
});

test('draft: local returns one canned drafted item', async () => {
  const r = await ask('own', { topic: 'Madeupamine', topics: TOPICS }, { local: true });
  assert.deepEqual((await r.json()).items.map(i => [i.topic, i.drafted]), [['drugs/dobutamine', true]]);
});
