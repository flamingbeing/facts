import test from 'node:test';
import assert from 'node:assert/strict';
import { handleFlush, mergeQueue, flagCard, isOwner, sgtDate, ACTION } from '../flush.js';
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
const ask = (path, who, deps, method = path === '/api/flags' ? 'GET' : 'POST') => handleFlush(new Request(ORIGIN + path, {
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
