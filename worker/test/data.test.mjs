import test from 'node:test';
import assert from 'node:assert/strict';
import { dataName, dataRoute } from '../data.js';

const u = p => new URL('https://facts.anawj.com' + p);

test('data: only /data/<name>.json names pass', () => {
  assert.equal(dataName(u('/data/index.json')), 'index');
  assert.equal(dataName(u('/data/drugs.json')), 'drugs');
  for (const p of ['/data/../x.json', '/data/%2e%2e.json', '/data/a/b.json', '/data/Drugs.json', '/data/x.txt', '/data/'])
    assert.equal(dataName(u(p)), null, p);
});

test('data: local reads the made-up set; a bad name or method is 404', async () => {
  const seen = [];
  const env = { ASSETS: { fetch: async req => { seen.push(new URL(req.url).pathname); return new Response('{"a":1}'); } } };
  const ok = await dataRoute.handle(new Request(u('/data/drugs.json')), env, { url: u('/data/drugs.json'), local: true });
  assert.equal(ok.status, 200);
  assert.equal(await ok.text(), '{"a":1}');
  assert.deepEqual(seen, ['/e2e/fixtures/data/drugs.json']);
  assert.equal((await dataRoute.handle(new Request(u('/data/x/y.json')), env, { url: u('/data/x/y.json'), local: true })).status, 404);
  const post = new Request(u('/data/drugs.json'), { method: 'POST', body: 'x' });
  assert.equal((await dataRoute.handle(post, env, { url: u('/data/drugs.json'), local: true })).status, 404);
});

test('data: a missing upstream file is 404, other failures 502', async () => {
  const env = { ASSETS: { fetch: async () => new Response('', { status: 404 }) } };
  assert.equal((await dataRoute.handle(new Request(u('/data/none.json')), env, { url: u('/data/none.json'), local: true })).status, 404);
  env.ASSETS.fetch = async () => new Response('', { status: 500 });
  assert.equal((await dataRoute.handle(new Request(u('/data/none.json')), env, { url: u('/data/none.json'), local: true })).status, 502);
});
