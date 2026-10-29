// The app's rules in the Firestore emulator: the rules kit's shared cases plus the app's own.
//   firebase emulators:exec --only firestore --project demo-facts "node --test app/test/rules.test.mjs"
// (from the repo root, after setup-tools or with .devkit/ copied from app-devkit)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { suite } from '../../.devkit/rules/suite.mjs';

// The optional modules' cases (app/test/rules/<module>.mjs, written by tools/add.mjs): each exports `collections`
// (more rows for the shared cases) and `tests({ test, assert, emu, as })`.
const dir = new URL('./rules/', import.meta.url);
const mods = existsSync(dir)
  ? await Promise.all(readdirSync(dir).filter(f => f.endsWith('.mjs')).sort().map(f => import(new URL(f, dir).href)))
  : [];

const emu = suite({
  project: 'demo-facts',
  rules: readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8'),
  roles: ['admin', 'member', 'viewer'],
  collections: [
    { path: 'spaces/_/items/i1', read: ['admin', 'member', 'viewer'], write: ['admin', 'member'],
      data: { text: 'hello', updatedAt: 1 }, stamp: 'strict', list: { roles: ['admin', 'member', 'viewer'] } },
    ...mods.flatMap(m => m.collections ?? []),
  ],
});

const as = role => emu.as(`u-${role}`, { g: { _: role }, v: 1 });

test('people read their own role doc, not others’; nobody writes or deletes one from a page (the Worker does)', async () => {
  await emu.clear();
  await emu.seed('members/u-member', { role: 'member', v: 1 });
  await emu.seed('members/u-other', { role: 'member', v: 1 });
  assert.equal((await as('member').get('members/u-member')).ok, true);
  assert.equal((await emu.as('u-new', {}).get('members/u-new')).ok, true, 'no role yet: may still read (absent) own doc');
  assert.equal((await as('member').get('members/u-other')).ok, false);
  assert.equal((await as('member').set('members/u-member', { role: 'admin', v: 2 })).ok, false, 'no self-promotion');
  assert.equal((await as('admin').get('members/u-other')).ok, true, 'admins read every role doc');
  assert.equal((await as('admin').set('members/u-other', { role: 'viewer', v: 2 })).ok, false, 'role changes: /api/members/');
  assert.equal((await as('admin').set('members/u-new', { role: 'member', v: 1 })).ok, false);
  assert.equal((await as('admin').delete('members/u-other')).ok, false, 'removal: /api/members/ (it also revokes)');
  assert.equal((await as('member').delete('members/u-member')).ok, false);
});

test('items: text required and at most 500 characters; no extra fields', async () => {
  await emu.clear();
  const at = { serverAt: true };
  assert.equal((await as('member').set('spaces/_/items/a', { text: '', updatedAt: 1 }, at)).ok, false);
  assert.equal((await as('member').set('spaces/_/items/a', { text: 'x'.repeat(501), updatedAt: 1 }, at)).ok, false);
  assert.equal((await as('member').set('spaces/_/items/a', { text: 'ok', updatedAt: 1, owner: 'me' }, at)).ok, false);
  assert.equal((await as('member').set('spaces/_/items/a', { text: 'ok', updatedAt: 1 }, at)).ok, true);
  assert.equal((await as('member').set('spaces/_/items/a', { text: 'ok', updatedAt: 1, createdAt: 1 }, at)).ok, true, 'createdAt allowed');
  assert.equal((await as('member').set('spaces/_/items/a', { text: 'ok', updatedAt: 1, createdAt: 'x' }, at)).ok, false, 'createdAt is a number');
  assert.equal((await as('member').set('spaces/_/items/a', { text: 'ok', updatedAt: 1, createdAt: 2 }, at)).ok, false, 'createdAt cannot change');
  const edits = { text: { by: 'Sam', device: 'Phone', at: 1 } };   // who changed each field and when (app-sync edits)
  assert.equal((await as('member').set('spaces/_/items/a', { text: 'ok', updatedAt: 1, _edits: edits }, at)).ok, true, '_edits allowed');
  assert.equal((await as('member').set('spaces/_/items/a', { text: 'ok', updatedAt: 1, _edits: 'x' }, at)).ok, false, '_edits is a map');
});

test('verdicts: members write their own (by and the id are them, the id is the line), one of the choices, text at most 2000; viewers only read; never deleted', async () => {
  await emu.clear();
  const at = { serverAt: true };
  const v = (by, extra = {}) => ({ fact: 'drugs/demo#aaa111', choice: 'agree', at: 1, by, updatedAt: 1, ...extra });
  const path = 'spaces/_/verdicts/u-member~drugs~demo~aaa111';
  assert.equal((await as('member').set(path, v('u-member'), at)).ok, true);
  assert.equal((await as('admin').set('spaces/_/verdicts/u-admin~drugs~demo~aaa111', v('u-admin', { choice: 'repo-wrong', text: 'Dose is 4 mg/kg' }), at)).ok, true);
  assert.equal((await as('admin').set(path, v('u-admin'), at)).ok, false, 'not another person\'s doc');
  assert.equal((await as('member').set('spaces/_/verdicts/u-member~airway~x~y', v('u-member'), at)).ok, false, 'the id is the line\'s');
  assert.equal((await as('member').set(path, v('u-member'))).ok, false, 'unstamped');
  assert.equal((await as('member').set(path, v('u-admin'), at)).ok, false, 'by is the writer');
  assert.equal((await as('member').set(path, v('u-member', { choice: 'maybe' }), at)).ok, false, 'a known choice');
  assert.equal((await as('member').set(path, v('u-member', { text: 'x'.repeat(2001) }), at)).ok, false, 'text at most 2000');
  assert.equal((await as('member').set(path, v('u-member', { at: 'now' }), at)).ok, false, 'at is a number');
  assert.equal((await as('member').set(path, v('u-member', { note: 'x' }), at)).ok, false, 'no extra fields');
  assert.equal((await as('viewer').set('spaces/_/verdicts/u-viewer~drugs~demo~aaa111', v('u-viewer'), at)).ok, false, 'viewers only read');
  assert.equal((await as('viewer').get(path)).ok, true);
  assert.equal((await as('admin').delete(path)).ok, false, 'never deleted');
});

test('bin entries: writers stamp them; viewers only read', async () => {
  await emu.clear();
  const entry = { id: 'a', kind: 'items', data: { text: 'ok' }, deletedAt: 2, updatedAt: 2 };
  assert.equal((await as('viewer').set('spaces/_/bin/items:a', entry, { serverAt: true })).ok, false);
  assert.equal((await as('member').set('spaces/_/bin/items:a', entry, { serverAt: true })).ok, true);
  assert.equal((await as('viewer').get('spaces/_/bin/items:a')).ok, true);
  assert.equal((await as('member').set('spaces/_/bin/items:b', entry)).ok, false, 'unstamped');
});

test('account options: one doc per person, only theirs, only the allowed fields', async () => {
  await emu.clear();
  const at = { serverAt: true };
  const mine = { itemCount: true, updatedAt: 1 };
  for (const role of ['admin', 'member', 'viewer']) {
    assert.equal((await as(role).set(`spaces/_/settings/u-${role}`, mine, at)).ok, true, `${role} saves their own`);
    assert.equal((await as(role).get(`spaces/_/settings/u-${role}`)).ok, true);
  }
  assert.equal((await as('member').set('spaces/_/settings/u-admin', mine, at)).ok, false, 'not someone else’s doc');
  assert.equal((await as('member').get('spaces/_/settings/u-admin')).ok, true, 'the group can read it (a list listen cannot ask for one doc)');
  assert.equal((await emu.as('u-new', {}).get('spaces/_/settings/u-member')).ok, false, 'no role, no read');
  assert.equal((await emu.as('u-new', {}).set('spaces/_/settings/u-new', mine, at)).ok, false, 'no role, no access');
  assert.equal((await as('member').set('spaces/_/settings/u-member', mine)).ok, false, 'unstamped');
  assert.equal((await as('member').set('spaces/_/settings/u-member', { ...mine, other: 1 }, at)).ok, false, 'an option the app did not list');
  assert.equal((await as('member').set('spaces/_/settings/u-member', { itemCount: 'yes', updatedAt: 1 }, at)).ok, false, 'wrong type');
  assert.equal((await as('member').set('spaces/_/settings/u-member', { itemCount: null, profile: null, updatedAt: 2 }, at)).ok, true, 'null forgets a value');
});

for (const m of mods) m.tests?.({ test, assert, emu, as });
