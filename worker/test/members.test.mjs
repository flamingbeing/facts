import test from 'node:test';
import assert from 'node:assert/strict';
import { loadClaims, handleMembers, DEFAULT_ADMINS } from '../members.js';

const adminWith = doc => ({ getDoc: async p => { assert.equal(p, 'members/u1'); return doc; } });

test('a member doc becomes single-group claims', async () => {
  assert.deepEqual(await loadClaims({ uid: 'u1', admin: adminWith({ role: 'member', v: 3 }) }), { g: { _: 'member' }, v: 3 });
});

test('no doc, or an unknown role, clears the claims', async () => {
  assert.equal(await loadClaims({ uid: 'u1', admin: adminWith(null) }), null);
  assert.equal(await loadClaims({ uid: 'u1', admin: adminWith({ role: 'owner' }) }), null);
});

test('a missing v counts as 0', async () => {
  assert.deepEqual(await loadClaims({ uid: 'u1', admin: adminWith({ role: 'viewer' }) }), { g: { _: 'viewer' }, v: 0 });
});

test('the owner is admin by default, only with a verified email and no role doc', async () => {
  const email = DEFAULT_ADMINS[0];
  assert.deepEqual(await loadClaims({ uid: 'u1', token: { email, email_verified: true }, admin: adminWith(null) }), { g: { _: 'admin' }, v: 0 });
  assert.equal(await loadClaims({ uid: 'u1', token: { email, email_verified: false }, admin: adminWith(null) }), null);
  assert.equal(await loadClaims({ uid: 'u1', token: { email: 'x@y.z', email_verified: true }, admin: adminWith(null) }), null);
  assert.deepEqual(await loadClaims({ uid: 'u1', token: { email, email_verified: true }, admin: adminWith({ role: 'viewer', v: 2 }) }), { g: { _: 'viewer' }, v: 2 });
});

// /api/members/<uid>: admins change roles and remove people through the Worker (the rules keep members/ closed to pages)
const ORIGIN = 'https://app.example.com';
const TOKENS = {
  bob: { sub: 'bob' }, ann: { sub: 'ann' }, nob: { sub: 'nob' },
  own: { sub: 'own', email: DEFAULT_ADMINS[0], email_verified: true },
};
const verifyT = async t => { if (!TOKENS[t]) throw new Error('bad token'); return TOKENS[t]; };
function fakeAdmin(docs) {
  const done = [];
  return {
    done, docs, project: 'demo-x',
    getDoc: async p => docs[p] ?? null,
    setDoc: async (p, d) => { done.push(['set', p, d]); docs[p] = d; },
    deleteDoc: async p => { done.push(['delete', p]); delete docs[p]; },
    revoke: async uid => { done.push(['revoke', uid]); docs[`revoked/${uid}`] = { at: 1 }; },
  };
}
const ask = (adm, method, path, { who, body, ...opts } = {}) => handleMembers(new Request(ORIGIN + path, {
  method, body: body === undefined ? undefined : JSON.stringify(body),
  headers: { ...(who ? { Authorization: `Bearer ${who}` } : {}), 'Content-Type': 'application/json' },
}), { admin: adm, verify: verifyT, origin: ORIGIN, ...opts });
const team = () => fakeAdmin({ 'members/bob': { role: 'admin', v: 1 }, 'members/ann': { role: 'member', v: 4, name: 'Ann' } });

test('an admin removes a member: the doc goes and the account is revoked (revoked/, claims cleared, sessions ended)', async () => {
  const adm = team();
  const r = await ask(adm, 'DELETE', '/api/members/ann', { who: 'bob' });
  assert.equal(r.status, 200);
  assert.deepEqual(adm.done, [['delete', 'members/ann'], ['revoke', 'ann']]);
  assert.equal(await loadClaims({ uid: 'ann', admin: adm }), null, 'no role at the next claims ask');
  assert.equal((await ask(adm, 'DELETE', '/api/members/ann', { who: 'bob' })).status, 200, 'gone already: revoked again, fine');
});

test('an admin sets a role: v goes up, other fields kept; a new person starts at v 1', async () => {
  const adm = team();
  assert.equal((await ask(adm, 'PUT', '/api/members/ann', { who: 'bob', body: { role: 'viewer' } })).status, 200);
  assert.deepEqual(adm.docs['members/ann'], { role: 'viewer', v: 5, name: 'Ann' });
  assert.equal((await ask(adm, 'PUT', '/api/members/neo', { who: 'bob', body: { role: 'member' } })).status, 200);
  assert.deepEqual(adm.docs['members/neo'], { role: 'member', v: 1 });
  assert.equal((await ask(adm, 'PUT', '/api/members/neo', { who: 'bob', body: { role: 'owner' } })).status, 400);
  assert.equal((await ask(adm, 'PUT', '/api/members/neo', { who: 'bob', body: 'x' })).status, 400);
});

test('only an admin by the role doc (or the owner by default), never with stale claims, revoked or about themselves', async () => {
  const adm = team();
  assert.equal((await ask(adm, 'DELETE', '/api/members/bob', { who: 'ann' })).status, 403, 'a member');
  assert.equal((await ask(adm, 'DELETE', '/api/members/ann', { who: 'nob' })).status, 403, 'no role');
  assert.equal((await ask(adm, 'DELETE', '/api/members/ann', { who: 'bob' })).status, 200, 'the doc decides, not the claims');
  adm.docs['members/bob'] = { role: 'member', v: 2 };
  assert.equal((await ask(adm, 'PUT', '/api/members/ann', { who: 'bob', body: { role: 'admin' } })).status, 403, 'demoted since');
  assert.equal((await ask(adm, 'PUT', '/api/members/ann', { who: 'own', body: { role: 'member' } })).status, 200, 'the owner, no doc');
  adm.docs['revoked/own'] = { at: 1 };
  assert.equal((await ask(adm, 'DELETE', '/api/members/ann', { who: 'own' })).status, 403, 'revoked');
  const adm2 = team();
  assert.equal((await ask(adm2, 'DELETE', '/api/members/bob', { who: 'bob' })).status, 400, 'not yourself');
  assert.equal((await ask(adm2, 'PUT', '/api/members/bob', { who: 'bob', body: { role: 'member' } })).status, 400);
  assert.deepEqual(adm2.done, []);
});

test('sign-in, origin, method, address and setup are checked first; a failed write is 500', async () => {
  const adm = team();
  assert.equal((await ask(adm, 'DELETE', '/api/members/ann')).status, 401);
  assert.equal((await ask(adm, 'DELETE', '/api/members/ann', { who: 'zzz' })).status, 401);
  assert.equal((await ask(adm, 'GET', '/api/members/ann', { who: 'bob' })).status, 405);
  assert.equal((await ask(adm, 'DELETE', '/api/members/a/b', { who: 'bob' })).status, 404);
  assert.equal((await ask(null, 'DELETE', '/api/members/ann', { who: 'bob' })).status, 503);
  const other = await handleMembers(new Request(ORIGIN + '/api/members/ann', { method: 'DELETE', headers: { Authorization: 'Bearer bob', Origin: 'https://evil.example' } }), { admin: adm, verify: verifyT, origin: ORIGIN });
  assert.equal(other.status, 403);
  adm.revoke = async () => { throw new Error('auth down'); };
  assert.equal((await ask(adm, 'DELETE', '/api/members/ann', { who: 'bob' })).status, 500, 'asked again, it finishes');
  assert.deepEqual(adm.done, [['delete', 'members/ann']], 'the doc first: the page then drops its claims anyway');
});
