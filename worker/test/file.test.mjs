import test from 'node:test';
import assert from 'node:assert/strict';
import { handleFile, filing, numbers, prompt, MODEL } from '../file.js';
import { DEFAULT_ADMINS } from '../members.js';

const ORIGIN = 'https://facts.anawj.com';
const TOKENS = { own: { sub: 'own', email: DEFAULT_ADMINS[0], email_verified: true }, bob: { sub: 'bob', email: 'bob@example.com', email_verified: true } };
const verify = async t => { if (!TOKENS[t]) throw new Error('bad'); return TOKENS[t]; };
const TOPICS = [['drugs/dobutamine', 'Dobutamine', ['Dosage', 'Effects']], ['airway/tubes', 'Tubes', ['Sizes']]];
const ask = (who, body, deps, method = 'POST') => handleFile(new Request(ORIGIN + '/api/file', {
  method, headers: who ? { Authorization: `Bearer ${who}` } : {}, body: method === 'POST' ? JSON.stringify(body) : undefined }), { verify, ...deps });

test('file: owner only; POST only; a fact is needed', async () => {
  assert.equal((await ask('', { text: 'x' }, {})).status, 401);
  assert.equal((await ask('nope', { text: 'x' }, {})).status, 401);
  assert.equal((await ask('bob', { text: 'x' }, { ask: async () => '' })).status, 403);
  assert.equal((await ask('own', {}, {}, 'GET')).status, 405);
  assert.equal((await ask('own', { text: '  ' }, { ask: async () => '' })).status, 400);
  assert.equal((await ask('own', { text: 'x'.repeat(1001) }, { ask: async () => '' })).status, 400);
});

test('file: no key set up is a plain 503; the model answer is checked and returned', async () => {
  const none = await ask('own', { text: 'Dose 5 mg', topics: TOPICS }, { ask: null });
  assert.equal(none.status, 503);
  assert.match((await none.json()).error, /ANTHROPIC_API_KEY/);
  let sent;
  const model = async p => { sent = p; return 'Here: {"topic":"drugs/dobutamine","section":"Dosage","line":"Start at 5 mcg/kg/min"}'; };
  const r = await ask('own', { text: '- start at 5 mcg/kg/min', topics: TOPICS }, { ask: model });
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { topic: 'drugs/dobutamine', section: 'Dosage', line: 'Start at 5 mcg/kg/min', isNew: false });
  assert.match(sent, /drugs\/dobutamine \| Dobutamine \| Dosage; Effects/);
  assert.match(sent, /start at 5 mcg\/kg\/min/);
});

test('file: a new topic carries its title; a changed number falls back to his own words; junk is 502', async () => {
  const text = 'Rocuronium 0.6 mg/kg intubates in 60 s';
  const reply = JSON.stringify({ topic: 'drugs/rocuronium', title: 'Rocuronium', section: 'Dosage', line: 'Rocuronium 0.5 mg/kg intubates in 60 s' });
  const r = await (await ask('own', { text, topics: TOPICS }, { ask: async () => reply })).json();
  assert.deepEqual(r, { topic: 'drugs/rocuronium', section: 'Dosage', line: text, isNew: true, title: 'Rocuronium' });
  assert.equal((await ask('own', { text, topics: TOPICS }, { ask: async () => 'sorry' })).status, 502);
  assert.equal((await ask('own', { text, topics: TOPICS }, { ask: async () => '{"topic":"nope/x","section":"A","line":"b"}' })).status, 502);
  assert.equal((await ask('own', { text, topics: TOPICS }, { ask: async () => { throw new Error('down'); } })).status, 502);
});

test('file: local returns a canned filing and needs no key', async () => {
  const r = await (await ask('own', { text: '- A made-up line', topics: TOPICS }, { ask: null, local: true })).json();
  assert.deepEqual(r, { topic: 'drugs/dobutamine', section: 'Notes', line: 'A made-up line', isNew: false });
});

test('file: helpers', () => {
  assert.deepEqual(numbers('1,000 ml and 2.5 mg, 3'), ['1,000', '2.5', '3']);
  assert.equal(MODEL, 'claude-sonnet-5-5');
  assert.match(prompt('x', []), /\(none yet\)/);
  assert.equal(filing('{"topic":"a/b","section":"s","line":"l"}', 'l', new Set()), null);
});
