import test from 'node:test';
import assert from 'node:assert/strict';
import {
  handleFile, filing, filings, verdicts, numbers, modelId, anthropic, chunks, reconcile, topicReader, localAsk,
  filePrompt, RECONCILE, MODELS, MAX_DUMP, MAX_LINES, CHUNK,
} from '../file.js';
import { DEFAULT_ADMINS } from '../members.js';

const ORIGIN = 'https://facts.anawj.com';
const TOKENS = { own: { sub: 'own', email: DEFAULT_ADMINS[0], email_verified: true }, bob: { sub: 'bob', email: 'bob@example.com', email_verified: true } };
const verify = async t => { if (!TOKENS[t]) throw new Error('bad'); return TOKENS[t]; };
const TOPICS = [['drugs/dobutamine', 'Dobutamine', ['Dosage', 'Effects']], ['airway/tubes', 'Tubes', ['Sizes']]];
const DATA = {
  drugs: { area: 'drugs', topics: [{ k: 'dobutamine', t: 'Dobutamine', f: [
    ['d1', 'Dosage', 'Start at **5 mcg/kg/min**'],
    ['d2', 'Effects', 'Increases contractility'],
    ['d3', 'Effects', 'Owner-checked line about heart rate'],
  ] }] },
  airway: { area: 'airway', topics: [{ k: 'tubes', t: 'Tubes', f: [['t1', 'Sizes', 'Adult female 7.0']] }] },
};
const area = async a => DATA[a] ?? null;
const post = (who, body, deps, method = 'POST') => handleFile(new Request(ORIGIN + '/api/file', {
  method, headers: who ? { Authorization: `Bearer ${who}` } : {}, body: method === 'POST' ? JSON.stringify(body) : undefined }), { verify, area, ...deps });

/** a fake Anthropic: pass 1 answers `filed`, pass 2 answers `results(topic)`; it records every call */
const fake = (filed, results = () => [], stop = 'end_turn') => {
  const calls = [];
  const ask = async (model, o) => {
    calls.push({ model, ...o });
    const usage = { input_tokens: 100, output_tokens: 10, cache_read_input_tokens: o.cache ? 50 : 0 };
    if (o.system === RECONCILE) return { text: JSON.stringify({ results: results(/^Topic: (\S+)/.exec(o.user)[1], o.user) }), stop: 'end_turn', usage };
    return { text: JSON.stringify({ items: filed }), stop, usage };
  };
  return { ask, calls };
};

test('file: owner only; POST only; text needed; caps', async () => {
  const { ask } = fake([]);
  assert.equal((await post('', { text: 'x' }, { ask })).status, 401);
  assert.equal((await post('nope', { text: 'x' }, { ask })).status, 401);
  assert.equal((await post('bob', { text: 'x' }, { ask })).status, 403);
  assert.equal((await post('own', {}, { ask }, 'GET')).status, 405);
  assert.equal((await post('own', { text: '  ' }, { ask })).status, 400);
  assert.equal((await post('own', { text: 'x'.repeat(MAX_DUMP + 1) }, { ask })).status, 400);
  const wrong = await handleFile(new Request(ORIGIN + '/api/file', { method: 'POST', headers: { Authorization: 'Bearer own', Origin: 'https://evil.example' }, body: '{}' }), { verify, ask, area });
  assert.equal(wrong.status, 403);
});

test('file: no key set up is a plain 503', async () => {
  const r = await post('own', { text: 'Dose 5 mg', topics: TOPICS }, { ask: null });
  assert.equal(r.status, 503);
  assert.match((await r.json()).error, /ANTHROPIC_API_KEY/);
});

test('file: model mapping; the page never names a model id', async () => {
  assert.equal(modelId('sonnet'), MODELS.sonnet);
  assert.equal(modelId('haiku'), MODELS.haiku);
  for (const x of [undefined, '', 'opus', MODELS.sonnet, 'claude-opus-5-5']) assert.equal(modelId(x), MODELS.haiku);
  for (const [m, want, said] of [[undefined, MODELS.haiku, 'haiku'], ['sonnet', MODELS.sonnet, 'sonnet'], ['claude-opus-5-5', MODELS.haiku, 'haiku']]) {
    const { ask, calls } = fake([{ source: 'start at 5 mcg/kg/min', topic: 'drugs/dobutamine', section: 'Dosage', line: 'Start at 5 mcg/kg/min' }]);
    const r = await post('own', { text: 'start at 5 mcg/kg/min', topics: TOPICS, model: m }, { ask });
    assert.equal((await r.json()).model, said);
    assert.ok(calls.length === 2 && calls.every(c => c.model === want));
  }
});

test('file: pass 1 caches the topic list in the system block; pass 2 gets the topic\'s lines and the new facts', async () => {
  const { ask, calls } = fake([
    { source: 'start at 5 mcg/kg/min', topic: 'drugs/dobutamine', section: 'Dosage', line: 'Start at 5 mcg/kg/min' },
    { source: 'size 7.0 for women', topic: 'airway/tubes', section: 'Sizes', line: 'Size 7.0 for women' },
    { source: 'new drug x', topic: 'drugs/new-drug', title: 'New drug', section: 'Notes', line: 'New drug x' },
  ]);
  const r = await post('own', { text: 'start at 5 mcg/kg/min\nsize 7.0 for women\nnew drug x', topics: TOPICS }, { ask });
  assert.equal(r.status, 200);
  const [one, ...rest] = calls;
  assert.equal(one.cache, true);
  assert.equal(one.system, filePrompt(TOPICS));
  assert.match(one.system, /drugs\/dobutamine \| Dobutamine \| Dosage; Effects/);
  assert.equal(one.user, 'start at 5 mcg/kg/min\nsize 7.0 for women\nnew drug x');
  // one reconcile call per existing topic touched; a new topic needs none
  assert.equal(rest.length, 2);
  const dob = rest.find(c => c.user.startsWith('Topic: drugs/dobutamine'));
  assert.match(dob.user, /d1 \| Dosage \| Start at \*\*5 mcg\/kg\/min\*\*/);
  assert.match(dob.user, /New facts \(n \| section \| line\):\n1 \| Dosage \| Start at 5 mcg\/kg\/min$/);
  const out = await r.json();
  assert.deepEqual(out.items.map(i => i.action), ['new', 'new', 'new']);
  assert.equal(out.items[2].isNew, true);
  assert.deepEqual(out.usage, { calls: 3, input: 300, output: 30, cacheRead: 50, cacheWrite: 0 });
});

test('file: the four actions, each checked', async () => {
  const filed = [
    { source: 'starts at 5 mcg/kg/min', topic: 'drugs/dobutamine', section: 'Dosage', line: 'Starts at 5 mcg/kg/min' },
    { source: 'increases contractility via beta1', topic: 'drugs/dobutamine', section: 'Effects', line: 'Increases contractility via beta1' },
    { source: 'start at 2.5 mcg/kg/min', topic: 'drugs/dobutamine', section: 'Dosage', line: 'Start at 2.5 mcg/kg/min' },
    { source: 'can cause hypotension', topic: 'drugs/dobutamine', section: 'Adverse effects', line: 'Can cause hypotension' },
  ];
  const { ask } = fake(filed, () => [
    { n: 1, action: 'duplicate', id: 'd1' },
    { n: 2, action: 'merge', id: 'd2', line: 'Increases contractility (beta1)' },
    { n: 3, action: 'correct', id: 'd1', line: 'Start at **2.5 mcg/kg/min**', why: 'Lower starting dose.' },
    { n: 4, action: 'new' },
  ]);
  const out = await (await post('own', { text: filed.map(f => f.source).join('\n'), topics: TOPICS }, { ask })).json();
  const [dup, merge, correct, add] = out.items;
  assert.deepEqual([dup.action, merge.action, correct.action, add.action], ['duplicate', 'merge', 'correct', 'new']);
  assert.deepEqual(dup.old, { id: 'd1', section: 'Dosage', line: 'Start at **5 mcg/kg/min**' });
  assert.equal(merge.line, 'Increases contractility (beta1)');
  assert.equal(merge.section, 'Effects');
  assert.deepEqual(merge.old, { id: 'd2', section: 'Effects', line: 'Increases contractility' });
  assert.equal(correct.line, 'Start at **2.5 mcg/kg/min**');
  assert.equal(correct.why, 'Lower starting dose.');
  assert.equal(add.line, 'Can cause hypotension');
  assert.equal(add.old, undefined);
});

test('verdicts: number guard; unknown ids, unknown actions and no-op lines stay "new"', () => {
  const lines = DATA.drugs.topics[0].f;
  const facts = [{ line: 'Start at 2.5 mcg/kg/min' }];
  const one = r => verdicts(JSON.stringify({ results: [{ n: 1, ...r }] }), facts, lines)[0];
  assert.equal(one({ action: 'correct', id: 'd1', line: 'Start at 2.5 mcg/kg/min' }).action, 'correct');
  assert.equal(one({ action: 'correct', id: 'd1', line: 'Start at 3 mcg/kg/min' }).action, 'new');        // invents 3
  assert.equal(one({ action: 'correct', id: 'd1', line: 'Start low, per kg' }).action, 'new');             // loses 2.5
  assert.equal(one({ action: 'merge', id: 'd1', line: 'Start at 2.5 mcg/kg/min' }).action, 'new');         // a merge drops the old 5
  assert.equal(one({ action: 'merge', id: 'd1', line: 'Start at 2.5 to 5 mcg/kg/min' }).action, 'merge');
  assert.equal(one({ action: 'duplicate', id: 'zzz' }).action, 'new');                                     // no such line
  assert.equal(one({ action: 'delete', id: 'd1' }).action, 'new');
  assert.equal(one({ action: 'merge', id: 'd1', line: 'start at **5 mcg/kg/min**.' }).action, 'new');      // same as the old line
  assert.equal(one({ action: 'correct', id: 'd1', line: 'Start at 2.5 mcg/kg/min' }).why, 'Differs from the line in the notes.');
  assert.equal(one({ action: 'correct', id: 'd1', line: 'Start at 2.5 mcg/kg/min', why: 'x'.repeat(500) }).why.length, 200);
  // a fact the reply skipped, a garbled reply: "new"
  assert.deepEqual(verdicts('not json', facts, lines), [{ action: 'new' }]);
  assert.deepEqual(verdicts(JSON.stringify({ results: [{ n: 7, action: 'duplicate', id: 'd1' }] }), facts, lines), [{ action: 'new' }]);
});

test('filings: never invents; a changed number falls back to his words; the fact cap; max_tokens is a cut', () => {
  const known = new Set(['drugs/dobutamine']);
  const r = filings(JSON.stringify({ items: [
    { source: 'start at 5 mcg/kg/min', topic: 'drugs/dobutamine', section: 'Dosage', line: 'Start at 10 mcg/kg/min' },
    { source: 'not in his text', topic: 'drugs/dobutamine', section: 'Dosage', line: 'Dose 99 mg' },
    { source: 'not in his text either', topic: 'drugs/dobutamine', section: 'Dosage', line: 'Dose 5 mcg' },
  ] }), '- start at 5 mcg/kg/min', known);
  assert.equal(r.items[0].line, 'start at 5 mcg/kg/min');
  assert.equal(r.items.length, 2);
  assert.equal(r.skipped, 1);
  assert.equal(r.cut, false);
  const many = Array.from({ length: MAX_LINES + 5 }, (_, i) => ({ source: `fact ${i}`, topic: 'drugs/dobutamine', section: 'Notes', line: `Fact ${i}` }));
  const text = many.map(m => m.source).join('\n');
  const capped = filings(JSON.stringify({ items: many }), text, known);
  assert.equal(capped.items.length, MAX_LINES);
  assert.equal(capped.cut, true);
  assert.equal(filings(JSON.stringify({ items: many.slice(0, 2) }), text, known, true).cut, true);
  // a reply cut off mid-object keeps the whole ones
  const half = JSON.stringify({ items: many.slice(0, 3) }).slice(0, -30);
  assert.equal(filings(half, text, known).items.length, 2);
});

test('filing: tolerant topic ids; unknown area is "other"; new topics get a title', () => {
  const known = new Set(['drugs/dobutamine']);
  assert.deepEqual(filing({ topic: 'Drugs/Dobutamine', section: '## Dosage', line: '- Start 5' }, 'start 5', known), { topic: 'drugs/dobutamine', section: 'Dosage', line: 'Start 5', isNew: false });
  assert.equal(filing({ topic: 'potions/new thing', line: 'x' }, 'x', known).topic, 'other/new-thing');
  assert.equal(filing({ topic: 'drugs/new_thing', line: 'x' }, 'x', known).title, 'new thing');
  assert.equal(filing({ topic: 'drugs/', line: 'x' }, 'x', known), null);
  assert.deepEqual(numbers('Dose 2.5 mg, max 1,000 mcg'), ['2.5', '1,000']);
});

test('reconcile: a big topic is read in chunks, each call under the cap; the first match wins', async () => {
  const lines = Array.from({ length: 3000 }, (_, i) => [`id${i}`, 'Notes', `Line ${'x'.repeat(80)} ${i}`]);
  assert.ok(chunks(lines).length > 1);
  assert.ok(chunks(lines).every(c => c.reduce((n, l) => n + l.join('   ').length, 0) <= CHUNK + 10));
  const read = topicReader(async () => ({ topics: [{ k: 'big', t: 'Big', f: lines }] }));
  const sizes = [];
  const ask = async (_m, o) => {
    sizes.push(o.user.length);
    const hit = o.user.includes('id2999 |');
    return { text: JSON.stringify({ results: [{ n: 1, action: hit ? 'duplicate' : 'new', id: 'id2999' }] }), stop: 'end_turn', usage: {} };
  };
  const r = await reconcile([{ topic: 'drugs/big', section: 'Notes', line: 'Line 2999', isNew: false }], read, ask, MODELS.haiku);
  assert.ok(sizes.length > 1 && sizes.every(n => n < 130000));
  assert.equal(r.items[0].action, 'duplicate');
  assert.equal(r.usage.calls, sizes.length);
  // the area is read once per call
  let reads = 0;
  const once = topicReader(async () => { reads++; return DATA.drugs; });
  await once('drugs/dobutamine'); await once('drugs/dobutamine'); assert.equal(reads, 1);
  assert.equal(await once('drugs/none'), null);
});

test('file: unusable reply and a refusal are 502; a failing area read leaves facts "new"', async () => {
  const bad = await post('own', { text: 'x', topics: TOPICS }, { ask: async () => ({ text: 'sorry', stop: 'end_turn', usage: {} }) });
  assert.equal(bad.status, 502);
  const refusing = anthropic({ ANTHROPIC_API_KEY: 'k' });
  const real = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ stop_reason: 'refusal', content: [] }));
  try {
    const r = await post('own', { text: 'x', topics: TOPICS }, { ask: refusing });
    assert.equal(r.status, 502);
    assert.match((await r.json()).error, /declined/);
  } finally { globalThis.fetch = real; }
  const { ask } = fake([{ source: 'start at 5 mcg/kg/min', topic: 'drugs/dobutamine', section: 'Dosage', line: 'Start at 5 mcg/kg/min' }], () => [{ n: 1, action: 'duplicate', id: 'd1' }]);
  const r = await handleFile(new Request(ORIGIN + '/api/file', { method: 'POST', headers: { Authorization: 'Bearer own' }, body: JSON.stringify({ text: 'start at 5 mcg/kg/min', topics: TOPICS }) }),
    { verify, ask, area: async () => { throw new Error('down'); } });
  assert.equal((await r.json()).items[0].action, 'new');
});

test('anthropic: the request (cached system, Haiku at effort low, no sampling params) and the reply\'s text blocks', async () => {
  const real = globalThis.fetch;
  const sent = [];
  globalThis.fetch = async (url, init) => {
    sent.push(JSON.parse(init.body));
    assert.equal(url, 'https://api.anthropic.com/v1/messages');
    assert.equal(init.headers['x-api-key'], 'k');
    return new Response(JSON.stringify({ stop_reason: 'max_tokens', usage: { input_tokens: 3 }, content: [{ type: 'thinking', thinking: '...' }, { type: 'text', text: 'a' }, { type: 'text', text: 'b' }] }));
  };
  try {
    const ask = anthropic({ ANTHROPIC_API_KEY: 'k' });
    const r = await ask(MODELS.haiku, { system: 'S', user: 'U', cache: true, maxTokens: 500 });
    assert.deepEqual(r, { text: 'a\nb', stop: 'max_tokens', usage: { input_tokens: 3 } });
    await ask(MODELS.sonnet, { system: 'S', user: 'U' });
  } finally { globalThis.fetch = real; }
  const [h, s] = sent;
  assert.deepEqual(h.system, [{ type: 'text', text: 'S', cache_control: { type: 'ephemeral' } }]);
  assert.deepEqual(h.output_config, { effort: 'low' });
  assert.equal(h.max_tokens, 500);
  assert.deepEqual(h.messages, [{ role: 'user', content: 'U' }]);
  assert.deepEqual(s.system, [{ type: 'text', text: 'S' }]);
  assert.equal(s.output_config, undefined);
  for (const b of sent) for (const k of ['temperature', 'top_p', 'top_k']) assert.equal(b[k], undefined);
});

test('file: max_tokens on pass 1 returns what came, marked cut', async () => {
  const { ask } = fake([{ source: 'start at 5 mcg/kg/min', topic: 'drugs/dobutamine', section: 'Dosage', line: 'Start at 5 mcg/kg/min' }], () => [], 'max_tokens');
  const out = await (await post('own', { text: 'start at 5 mcg/kg/min', topics: TOPICS }, { ask })).json();
  assert.equal(out.cut, true);
  assert.equal(out.items.length, 1);
});

test('localAsk: the canned model gives each of the four actions', async () => {
  const topics = [['drugs/demo-drug', 'Demo drug', ['Dosage', 'Notes']]];
  const demo = { topics: [{ k: 'demo-drug', t: 'Demo drug', f: [['aaa111', 'Dosage', 'Dose **2 mg/kg** IV'], ['bbb222', 'Notes', 'Made-up line with no question']] }] };
  const r = await handleFile(new Request(ORIGIN + '/api/file', { method: 'POST', headers: { Authorization: 'Bearer own' },
    body: JSON.stringify({ text: 'A brand new line\nMade-up line with no question\nMore: given slowly\nNot: Dose 3 mg/kg IV', topics }) }),
  { verify, ask: null, area: async () => demo, local: true });
  const out = await r.json();
  assert.deepEqual(out.items.map(i => i.action), ['new', 'duplicate', 'merge', 'correct']);
  assert.equal(out.items[2].line, 'Dose **2 mg/kg** IV; given slowly');
  assert.equal(out.items[3].line, 'Dose 3 mg/kg IV');
  assert.equal(typeof localAsk, 'function');
});
