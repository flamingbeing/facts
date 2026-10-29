import test from 'node:test';
import assert from 'node:assert/strict';
import { handleProcess } from '../process.js';
import { DEFAULT_ADMINS } from '../members.js';

const ORIGIN = 'https://facts.anawj.com';
const TOKENS = { own: { sub: 'own', email: DEFAULT_ADMINS[0], email_verified: true }, bob: { sub: 'bob', email: 'bob@example.com', email_verified: true } };
const verify = async t => { if (!TOKENS[t]) throw new Error('bad'); return TOKENS[t]; };
function fakeGithub(run = null, last = null) {
  const started = [];
  return { started, latest: async () => run, last: async () => last, start: async m => { started.push(m); } };
}
const ask = (who, deps, method = 'POST', body, headers = {}) => handleProcess(new Request(ORIGIN + '/api/process', {
  method, headers: { ...(who ? { Authorization: `Bearer ${who}` } : {}), ...headers }, ...(body ? { body: JSON.stringify(body) } : {}) }), { verify, ...deps });

test('process: owner only, his page only; no token 401, others 403, PUT 405', async () => {
  const github = fakeGithub();
  assert.equal((await ask('', { github })).status, 401);
  assert.equal((await ask('nope', { github })).status, 401);
  assert.equal((await ask('bob', { github })).status, 403);
  assert.equal((await ask('own', { github }, 'POST', {}, { Origin: 'https://evil.example' })).status, 403);
  assert.equal((await ask('own', { github }, 'PUT')).status, 405);
  assert.deepEqual(github.started, []);
});

test('process: POST starts the workflow with the model (Sonnet by default); a bad model is 400', async () => {
  const github = fakeGithub({ id: 1, status: 'completed', conclusion: 'success' });
  assert.deepEqual(await (await ask('own', { github }, 'POST', {})).json(), { ok: true, started: true });
  assert.deepEqual(await (await ask('own', { github }, 'POST', { model: 'opus' })).json(), { ok: true, started: true });
  assert.equal((await ask('own', { github }, 'POST', { model: 'gpt' })).status, 400);
  assert.deepEqual(github.started, ['sonnet', 'opus']);
});

test('process: a run already queued or going is not started twice', async () => {
  for (const status of ['queued', 'in_progress']) {
    const github = fakeGithub({ id: 2, status, conclusion: null });
    assert.deepEqual(await (await ask('own', { github }, 'POST', { model: 'sonnet' })).json(), { ok: true, started: false });
    assert.deepEqual(github.started, []);
  }
});

test('process: GET gives the latest run and its last.json; none yet is null; GitHub down is 502', async () => {
  const run = { id: 3, status: 'completed', conclusion: 'success', url: 'https://github.com/x/runs/3', at: 1 };
  const last = { run_id: 3, pr: 'https://github.com/flamingbeing/anaesfacts/pull/9', done: 4, held: 1, left: 0, cost_usd: 0.42 };
  assert.deepEqual(await (await ask('own', { github: fakeGithub(run, last) }, 'GET')).json(), { run, last });
  assert.deepEqual(await (await ask('own', { github: fakeGithub() }, 'GET')).json(), { run: null, last: null });
  const down = { latest: async () => { throw new Error('github runs 500'); } };
  assert.equal((await ask('own', { github: down }, 'GET')).status, 502);
});

test('process: local (no GitHub) starts nothing', async () => {
  assert.deepEqual(await (await ask('own', { github: null }, 'POST', { model: 'sonnet' })).json(), { ok: true, started: false, local: true });
  assert.deepEqual(await (await ask('own', { github: null }, 'GET')).json(), { run: null, last: null });
});
