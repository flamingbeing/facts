import test from 'node:test';
import assert from 'node:assert/strict';
import { handleFlush, mergeQueue, flagCard, isOwner, sgtDate, ACTION, logItem } from '../flush.js';
import { DEFAULT_ADMINS } from '../members.js';

const ORIGIN = 'https://facts.anawj.com';
const TOKENS = { own: { sub: 'own', email: DEFAULT_ADMINS[0], email_verified: true }, bob: { sub: 'bob', email: 'bob@example.com', email_verified: true },
  unv: { sub: 'own', email: DEFAULT_ADMINS[0], email_verified: false } };
const verify = async t => { if (!TOKENS[t]) throw new Error('bad'); return TOKENS[t]; };
const v = (id, choice, at, by = 'own', extra = {}) => ({ id, fact: `drugs/x#${id}`, choice, at, by, serverAt: new Date(at).toISOString(), ...extra });
function fakeAdmin(docs = {}) { return { docs, getDoc: async p => docs[p] ?? null, setDoc: async (p, d) => { docs[p] = d; } }; }
function fakeGithub(files = {}) {
  const writes = [];
  return { files, writes, read: async p => files[p] ? { sha: 's' + writes.length, json: structuredClone(files[p]) } : null,
    write: async (p, json, sha, msg) => { writes.push({ p, json, sha, msg }); files[p] = json; return true; } };
}
const ask = (path, who, deps, method = path === '/api/flags' || path === '/api/queue' ? 'GET' : 'POST') => handleFlush(new Request(ORIGIN + path, {
  method, headers: who ? { Authorization: `Bearer ${who}` } : {} }), { verify, now: () => Date.parse('2026-10-29T10:00:00Z'), ...deps });

test('flush: owner only (his verified email); others 403, no token 401', async () => {
  assert.equal(isOwner(TOKENS.own), true);
  assert.equal(isOwner(TOKENS.unv), false);
  assert.equal((await ask('/api/flush', '', {})).status, 401);
  assert.equal((await ask('/api/flush', 'nope', {})).status, 401);
  assert.equal((await ask('/api/flush', 'bob', { admin: fakeAdmin() })).status, 403);
  assert.equal((await ask('/api/flush', 'unv', { admin: fakeAdmin() })).status, 403);
  assert.equal((await ask('/api/flush', 'own', {}, 'GET')).status, 405);
});

test('flush: his change answers since the mark go into the day file; the mark moves on; others and agree/seen do not', async () => {
  const adm = fakeAdmin({ 'flush/own': { upto: 1000 } }), github = fakeGithub();
  let asked;
  const query = async (_a, _b, after) => { asked = after; return [v('a', 'repo-wrong', 2000, 'own', { text: 'Fix', q: 'Stem?' }), v('b', 'agree', 3000), v('c', 'edit', 4000, 'bob'), v('d', 'keep', 5000)]; };
  const r = await ask('/api/flush', 'own', { admin: adm, github, query });
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { ok: true, n: 2 });
  assert.equal(asked, 1000);
  assert.equal(github.writes.length, 1);
  assert.equal(github.writes[0].p, 'queue/2026-10-29.json');
  assert.deepEqual(github.writes[0].json.items, [{ id: 'a', fact: 'drugs/x#a', choice: 'repo-wrong', text: 'Fix', q: 'Stem?', at: 2000 }, { id: 'd', fact: 'drugs/x#d', choice: 'keep', at: 5000 }]);
  assert.equal(adm.docs['flush/own'].upto, 5000);
  // the same answers again (two calls at once): nothing twice, no commit
  const again = await ask('/api/flush', 'own', { admin: adm, github, query });
  assert.deepEqual(await again.json(), { ok: true, n: 0 });
  assert.equal(github.writes.length, 1);
});

test('flush: an Add tab line (choice add) is queued with its section', async () => {
  const github = fakeGithub();
  const query = async () => [v('x', 'add', 2000, 'own', { fact: 'add:drugs/dobutamine#k1', text: 'Line', section: 'Dosage' })];
  assert.deepEqual(await (await ask('/api/flush', 'own', { admin: fakeAdmin(), github, query })).json(), { ok: true, n: 1 });
  assert.deepEqual(github.writes[0].json.items, [{ id: 'x', fact: 'add:drugs/dobutamine#k1', choice: 'add', text: 'Line', section: 'Dosage', at: 2000 }]);
  assert.equal(ACTION.includes('add'), true);
});

test('flush: an Add tab change (choice edit) is queued with the old line and why; the Log shows them', async () => {
  const github = fakeGithub();
  const query = async () => [v('e', 'edit', 2000, 'own', { fact: 'edit:drugs/dobutamine#d1@k1', text: 'New line', section: 'Dosage', old: 'Old line', why: 'Lower dose.' })];
  assert.deepEqual(await (await ask('/api/flush', 'own', { admin: fakeAdmin(), github, query })).json(), { ok: true, n: 1 });
  const item = { id: 'e', fact: 'edit:drugs/dobutamine#d1@k1', choice: 'edit', text: 'New line', section: 'Dosage', old: 'Old line', why: 'Lower dose.', at: 2000 };
  assert.deepEqual(github.writes[0].json.items, [item]);
  assert.deepEqual(logItem(item), { fact: item.fact, choice: 'edit', at: 2000, text: 'New line', section: 'Dosage', old: 'Old line', reason: 'Lower dose.', status: 'queued' });
});

test('flush: a Test tab "This fact is wrong" (choice flag) is queued with the line; the Test tab\'s other saves never are', async () => {
  const github = fakeGithub();
  const query = async () => [v('w', 'flag', 2000, 'own', { fact: 'wrong:drugs/x#abc', text: 'The line as shown' }), v('x', 'flag', 3000, 'bob', { fact: 'wrong:drugs/x#abc', text: 'Not his' })];
  assert.deepEqual(await (await ask('/api/flush', 'own', { admin: fakeAdmin(), github, query })).json(), { ok: true, n: 1 });
  assert.deepEqual(github.writes[0].json.items, [{ id: 'w', fact: 'wrong:drugs/x#abc', choice: 'flag', text: 'The line as shown', at: 2000 }]);
  assert.equal(ACTION.includes('flag'), true);
});

test('flush: nothing new, or nothing to change: no commit, the mark still moves', async () => {
  const adm = fakeAdmin(), github = fakeGithub();
  assert.deepEqual(await (await ask('/api/flush', 'own', { admin: adm, github, query: async () => [] })).json(), { ok: true, n: 0 });
  assert.deepEqual(await (await ask('/api/flush', 'own', { admin: adm, github, query: async () => [v('s', 'seen', 7000)] })).json(), { ok: true, n: 0 });
  assert.equal(github.writes.length, 0);
  assert.equal(adm.docs['flush/own'].upto, 7000);
});

test('flush: a write that clashes reads again; GitHub down is 502 and the mark stays', async () => {
  const adm = fakeAdmin(), github = fakeGithub({ 'queue/2026-10-29.json': { items: [{ id: 'z', at: 1 }] } });
  let clash = 1;
  const write = github.write;
  github.write = async (...a) => clash-- > 0 ? false : write(...a);
  const query = async () => [v('a', 'edit', 2000)];
  assert.deepEqual(await (await ask('/api/flush', 'own', { admin: adm, github, query })).json(), { ok: true, n: 1 });
  assert.deepEqual(github.files['queue/2026-10-29.json'].items.map(i => i.id), ['z', 'a']);
  const down = { read: async () => { throw new Error('github read 500'); } };
  const adm2 = fakeAdmin();
  assert.equal((await ask('/api/flush', 'own', { admin: adm2, github: down, query })).status, 502);
  assert.equal(adm2.docs['flush/own'], undefined);
});

test('flush: local (no GitHub) lists the items instead of writing', async () => {
  const r = await ask('/api/flush', 'own', { admin: fakeAdmin(), github: null, query: async () => [v('a', 'bad-question', 2000, 'own', { q: 'Stem?' })] });
  assert.deepEqual((await r.json()).items.map(i => i.choice), ['bad-question']);
});

test('flags: owner only; open ones, shaped for the card', async () => {
  const rows = [{ id: 'F1', kind: 'batch', confidence: 'high', topic: 'drugs/a.md', line: 'L', note: 'N', suggested_fix: 'S', status: 'open' },
    { id: 'F2', kind: 'conflict', confidence: 'med', topic: 'drugs/a', topic_b: 'drugs/b', line: 'A', line_b: 'B', note: 'N', suggested_fix: null, status: 'open' },
    { id: 'F3', kind: 'batch', confidence: 'low', topic: 'x', line: 'L', note: 'N', status: 'fixed' }];
  assert.equal((await ask('/api/flags', 'bob', { flagsLocal: async () => rows })).status, 403);
  const r = await ask('/api/flags', 'own', { github: null, flagsLocal: async () => rows });
  assert.deepEqual((await r.json()).flags, [
    { id: 'F1', kind: 'batch', level: 'high', topic: 'drugs/a', line: 'L', note: 'N', fix: 'S' },
    { id: 'F2', kind: 'conflict', level: 'med', topic: 'drugs/a', line: 'A', note: 'N', topicB: 'drugs/b', lineB: 'B' }]);
  const gh = fakeGithub({ 'flags.json': { flags: rows } });
  assert.equal((await (await ask('/api/flags', 'own', { github: gh })).json()).flags.length, 2);
});

test('the queue helpers', () => {
  assert.equal(sgtDate(Date.parse('2026-10-29T16:30:00Z')), '2026-10-30');
  assert.deepEqual(ACTION.includes('agree') || ACTION.includes('seen') || ACTION.includes('me-wrong'), false);
  assert.equal(mergeQueue([v('a', 'edit', 1)], 'own', { items: [{ id: 'a', at: 1 }] }).n, 0);
  assert.equal(flagCard({ id: 'F', kind: 'batch', topic: 't.md', line: 'l', note: 'n', confidence: 'low' }).topic, 't');
});

test('queue: owner only; the last 14 days newest first with queued / done (PR link or note) / held', async () => {
  const T = d => Date.parse(d + 'T02:00:00Z');
  const files = {
    'queue/2026-10-29.json': { items: [{ id: 'u~a', fact: 'drugs/x#a', choice: 'edit', text: 'Made-up edit', at: T('2026-10-29') },
      { id: 'u~b', fact: 'add:drugs/y#k', choice: 'add', text: 'Made-up line', section: 'Dosage', at: T('2026-10-29') + 5, held: 'line changed since' }] },
    'queue/2026-10-20.json': { items: [{ id: 'u~c', fact: 'drugs/x#c', choice: 'repo-wrong', at: T('2026-10-20'), done: 'https://github.com/flamingbeing/anaesfacts/pull/9' },
      { id: 'u~d', fact: 'wrong:drugs/x#d', choice: 'flag', at: T('2026-10-20') + 1, done: 'flagged F0012' }] },
    'queue/2026-10-01.json': { items: [{ id: 'u~e', fact: 'drugs/x#e', choice: 'keep', at: T('2026-10-01'), done: 'kept' }] },
  };
  const github = { ...fakeGithub(files), names: async () => ['README.md', ...Object.keys(files).map(k => k.slice(6))] };
  assert.equal((await ask('/api/queue', 'bob', { github })).status, 403);
  assert.equal((await ask('/api/queue', '', { github })).status, 401);
  assert.equal((await ask('/api/queue', 'own', { github }, 'POST')).status, 405);
  const { items } = await (await ask('/api/queue', 'own', { github })).json();
  assert.deepEqual(items.map(i => [i.fact, i.status]), [['add:drugs/y#k', 'held'], ['drugs/x#a', 'queued'], ['wrong:drugs/x#d', 'done'], ['drugs/x#c', 'done']]);
  assert.equal(items[0].why, 'line changed since');
  assert.equal(items[0].id, undefined);
  assert.equal(items[2].note, 'flagged F0012');
  assert.equal(items[3].pr, 'https://github.com/flamingbeing/anaesfacts/pull/9');
  // GitHub down: 502, nothing leaks
  const down = { names: async () => { throw new Error('github list 500'); } };
  assert.equal((await ask('/api/queue', 'own', { github: down })).status, 502);
  // local: the fixture
  const local = await ask('/api/queue', 'own', { github: null, queueLocal: async () => [{ fact: 'a', choice: 'keep', at: T('2026-10-29') }] });
  assert.deepEqual((await local.json()).items.map(i => i.status), ['queued']);
});
