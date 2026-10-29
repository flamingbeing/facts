import test from 'node:test';
import assert from 'node:assert/strict';
import { handleFileMany, manyFilings, manyPrompt, parseItems, MAX_DUMP, MAX_LINES } from '../file-many.js';
import { DEFAULT_ADMINS } from '../members.js';

const ORIGIN = 'https://facts.anawj.com';
const TOKENS = { own: { sub: 'own', email: DEFAULT_ADMINS[0], email_verified: true }, bob: { sub: 'bob', email: 'bob@example.com', email_verified: true } };
const verify = async t => { if (!TOKENS[t]) throw new Error('bad'); return TOKENS[t]; };
const TOPICS = [['drugs/dobutamine', 'Dobutamine', ['Dosage', 'Effects']], ['airway/tubes', 'Tubes', ['Sizes']]];
const ask = (who, body, deps, method = 'POST') => handleFileMany(new Request(ORIGIN + '/api/file-many', {
  method, headers: who ? { Authorization: `Bearer ${who}` } : {}, body: method === 'POST' ? JSON.stringify(body) : undefined }), { verify, ...deps });

const DUMP = 'Madeupamine\n- Start at 5 mcg/kg/min\n- Max 20 mcg/kg/min\n- Can cause fast heart rate';
const reply = items => JSON.stringify({ items, more: false });

test('file-many: owner only; POST only; a paste is needed and capped', async () => {
  assert.equal((await ask('', { text: 'x' }, {})).status, 401);
  assert.equal((await ask('bob', { text: 'x' }, { ask: async () => '' })).status, 403);
  assert.equal((await ask('own', {}, {}, 'GET')).status, 405);
  assert.equal((await ask('own', { text: '  ' }, { ask: async () => '' })).status, 400);
  assert.equal((await ask('own', { text: 'x'.repeat(MAX_DUMP + 1) }, { ask: async () => '' })).status, 400);
  assert.equal((await ask('own', { text: 'x'.repeat(MAX_DUMP) }, { ask: async () => reply([]) })).status, 502);
});

test('file-many: no key is a plain 503; the dump is split into checked items sharing one new topic', async () => {
  const none = await ask('own', { text: DUMP, topics: TOPICS }, { ask: null });
  assert.equal(none.status, 503);
  assert.match((await none.json()).error, /ANTHROPIC_API_KEY/);
  let sent;
  const model = async p => {
    sent = p;
    return 'Sure:\n' + reply([
      { source: 'Start at 5 mcg/kg/min', topic: 'drugs/madeupamine', title: 'Madeupamine', section: 'Dosage', line: 'Start at 5 mcg/kg/min' },
      { source: 'Max 20 mcg/kg/min', topic: 'drugs/madeupamine', title: 'Madeupamine', section: 'Dosage', line: 'Maximum 20 mcg/kg/min' },
      { source: 'Can cause fast heart rate', topic: 'drugs/madeupamine', section: 'Adverse effects', line: 'Can cause a fast heart rate' },
    ]);
  };
  const r = await ask('own', { text: DUMP, topics: TOPICS }, { ask: model });
  assert.equal(r.status, 200);
  const out = await r.json();
  assert.equal(out.cut, false);
  assert.equal(out.skipped, 0);
  assert.deepEqual(out.items.map(i => [i.topic, i.section, i.line, i.isNew]), [
    ['drugs/madeupamine', 'Dosage', 'Start at 5 mcg/kg/min', true],
    ['drugs/madeupamine', 'Dosage', 'Maximum 20 mcg/kg/min', true],
    ['drugs/madeupamine', 'Adverse effects', 'Can cause a fast heart rate', true]]);
  assert.equal(out.items[0].title, 'Madeupamine');
  assert.match(sent, /drugs\/dobutamine \| Dobutamine \| Dosage; Effects/);
  assert.match(sent, /Max 20 mcg\/kg\/min/);
});

test('file-many: a changed number falls back to his words for that item only; a number he never gave drops it', () => {
  const known = new Set(['drugs/dobutamine']);
  const r = manyFilings(reply([
    { source: 'Max 20 mcg/kg/min', topic: 'drugs/dobutamine', section: 'Dosage', line: 'Max 25 mcg/kg/min' },
    { source: 'Start at 5 mcg/kg/min', topic: 'drugs/dobutamine', section: 'Dosage', line: 'Starts at 5 mcg/kg/min' },
    { source: 'not in his text 7', topic: 'drugs/dobutamine', section: 'Dosage', line: 'Give 7 mg' },
    { topic: 'drugs/dobutamine', section: 'Dosage', line: 'Peak effect at 5 min' },
    { source: 'Start at 5 mcg/kg/min', topic: 'nonsense', section: 'Dosage', line: 'x' },
  ]), DUMP, known);
  assert.deepEqual(r.items.map(i => i.line), ['Max 20 mcg/kg/min', 'Starts at 5 mcg/kg/min', 'Peak effect at 5 min']);
  assert.equal(r.skipped, 2);
  assert.equal(r.cut, false);
});

test('file-many: tolerant parsing (text around it, a reply cut off mid-item) and the line cap say the dump was cut', () => {
  const two = '{"items":[{"source":"a 1","topic":"drugs/x","section":"S","line":"a 1"},{"source":"b 2","topic":"drugs/x","section":"S","line":"b 2"},{"source":"c 3","topic":"dru';
  const p = parseItems(two);
  assert.equal(p.items.length, 2);
  assert.equal(p.truncated, true);
  assert.equal(manyFilings(two, 'a 1 b 2 c 3', new Set()).cut, true);
  assert.equal(parseItems('["no"').items.length, 0);
  assert.equal(parseItems('sorry').items.length, 0);
  const many = Array.from({ length: MAX_LINES + 5 }, (_, i) => ({ source: `fact ${i}`, topic: 'other/x', section: 'S', line: `fact ${i}` }));
  const dump = many.map(m => m.source).join('\n');
  const r = manyFilings(reply(many), dump, new Set());
  assert.equal(r.items.length, MAX_LINES);
  assert.equal(r.cut, true);
  assert.equal(manyFilings(JSON.stringify({ items: many.slice(0, 2), more: true }), dump, new Set()).cut, true);
});

test('file-many: junk and a failing model are 502; local returns one canned item per line', async () => {
  assert.equal((await ask('own', { text: DUMP }, { ask: async () => 'sorry' })).status, 502);
  assert.equal((await ask('own', { text: DUMP }, { ask: async () => { throw new Error('down'); } })).status, 502);
  const r = await (await ask('own', { text: '- One made-up line\n\n- Two made-up line', topics: TOPICS }, { ask: null, local: true })).json();
  assert.deepEqual(r, { items: [
    { topic: 'drugs/dobutamine', section: 'Notes', line: 'One made-up line', isNew: false },
    { topic: 'drugs/dobutamine', section: 'Notes', line: 'Two made-up line', isNew: false }], cut: false, skipped: 0 });
  assert.match(manyPrompt('x', []), /\(none yet\)/);
});
