// Sign-in, roles from the role doc, and the list: add, edit, delete to the bin.
import AxeBuilder from './axe.mjs';
import { test, expect, clickOpens, signIn, add, synced, serverHas, db, uniq, APP } from './fixtures.mjs';

test('signed out: the sign-in screen, accessible', async ({ phone }) => {
  const page = await phone();
  await page.goto(APP, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#signed-out')).toBeVisible();
  expect(await AxeBuilder(page)).toEqual([]);
});

test('an account with no role sees no list until an admin adds it', async ({ phone }) => {
  const page = await phone();
  await signIn(page, null);
  await expect(page.locator('#list-view')).toBeHidden();
  await expect(page.locator('#uid')).not.toBeEmpty();
});

test('a member adds, edits and deletes; the delete lands in the bin', async ({ phone }) => {
  const page = await phone();
  await signIn(page, 'member');
  const t = uniq('item');
  await add(page, t);
  await synced(page);
  await serverHas(t);
  expect(await AxeBuilder(page)).toEqual([]);

  await clickOpens(page.getByRole('button', { name: t }), page.locator('#edit'));
  await page.fill('#edit-text', t + ' edited');
  await page.click('#edit-save');
  await expect(page.locator('#items')).toContainText(t + ' edited');
  await serverHas(t + ' edited');

  await clickOpens(page.getByRole('button', { name: t + ' edited' }), page.locator('#edit'));
  await page.click('#edit-delete');
  await expect(page.locator('#items')).not.toContainText(t);
  await expect.poll(async () => (await db.list('spaces/_/bin')).some(b => b.data?.text === t + ' edited'), { timeout: 15_000 }).toBe(true);
  await expect.poll(async () => (await db.list('spaces/_/items')).some(d => d.text === t + ' edited')).toBe(false);
});

test('a viewer reads but cannot add or edit', async ({ phone }) => {
  const t = uniq('seen');
  await db.put(`spaces/_/items/${t}`, { text: t, updatedAt: Date.now() });
  const page = await phone();
  await signIn(page, 'viewer');
  await expect(page.locator('#items')).toContainText(t);
  await expect(page.locator('#add')).toBeHidden();
  await expect(page.getByRole('button', { name: t })).toBeDisabled();
});

test('a role change reaches the page by itself (role doc v ahead of the token)', async ({ phone }) => {
  const page = await phone();
  const { uid } = await signIn(page, 'viewer');
  await expect(page.locator('#add')).toBeHidden();
  await db.put(`members/${uid}`, { role: 'member', v: 2 });
  await expect(page.locator('#add')).toBeVisible();
  await db.del(`members/${uid}`);
  await expect(page.locator('#no-access')).toBeVisible({ timeout: 15_000 });
});

// S1: removing someone ends their access, not only their role doc: the Worker deletes the doc and revokes the account
// (revoked/{uid}: the rules refuse at once; claims cleared; refresh tokens ended)
test('an admin removes a member: the page loses the list, writes are refused, the session ends', async ({ phone }) => {
  const admin = await phone(), gone = await phone();
  const { uid: adminUid } = await signIn(admin, 'admin');
  const { uid } = await signIn(gone, 'member');
  // a page can't delete a role doc any more (the rules), and only admins may ask the Worker
  expect(await gone.evaluate(u => window.starter.members().remove(u), adminUid)).toBe('Admins only.');
  expect(await admin.evaluate(u => window.starter.members().remove(u), uid)).toBe('');
  expect(await db.get(`members/${uid}`)).toBeFalsy();
  expect(await db.get(`revoked/${uid}`)).toBeTruthy();
  await expect(gone.locator('#list-view')).toBeHidden({ timeout: 15_000 });
  // after a token refresh the token carries no role; the sessions were ended (validSince: real Firebase then refuses the
  // refresh token and the page signs out; the Auth emulator doesn't check it on refresh, so the test reads the account)
  expect(await gone.evaluate(async () => {
    const { getAuth } = await import('firebase/auth');
    const u = getAuth().currentUser;
    return u ? (await u.getIdTokenResult(true).then(r => r.claims.g ?? 'none', e => e.code)) : 'signed out';
  })).not.toHaveProperty('_');
  const account = await (await fetch(`http://${process.env.FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:9099'}/identitytoolkit.googleapis.com/v1/projects/demo-facts/accounts:lookup`,
    { method: 'POST', headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' }, body: JSON.stringify({ localId: [uid] }) })).json();
  expect(Number(account.users[0].validSince)).toBeGreaterThan(0);
  // added back later: the next claims ask clears revoked/ and the list returns
  expect(await admin.evaluate(u => window.starter.members().setRole(u, 'viewer'), uid)).toBe('');
  expect(await db.get(`members/${uid}`)).toMatchObject({ role: 'viewer', v: 1 });
});

// A token refresh restarts Firestore's Listen stream; a role change written just then must still reach the page (the
// Firestore emulator before v1.22 lost such changes: firebase-tools is pinned past it, package.json "rules")
test('a role change during a token refresh still reaches the page', async ({ phone }) => {
  const page = await phone();
  const { uid } = await signIn(page, 'viewer');
  const refresh = () => page.evaluate(async () => { const { getAuth } = await import('firebase/auth'); void getAuth().currentUser?.getIdToken(true); });
  for (let v = 2; v < 10; v += 2) {
    await refresh();
    await db.put(`members/${uid}`, { role: 'member', v });
    await expect(page.locator('#add')).toBeVisible();
    await refresh();
    await db.put(`members/${uid}`, { role: 'viewer', v: v + 1 });
    await expect(page.locator('#add')).toBeHidden();
  }
});

test('typing the next item while the last one saves keeps the new draft (slow or offline network)', async ({ phone }) => {
  const page = await phone();
  await signIn(page, 'member');
  await synced(page);
  await page.context().setOffline(true);
  const first = uniq('first'), second = uniq('second');
  // both user actions in one task, so the next draft is typed before the first save resolves
  await page.evaluate(({ first, second }) => {
    const box = /** @type {HTMLInputElement} */ (document.querySelector('#new-text'));
    box.value = first;
    /** @type {HTMLFormElement} */ (document.querySelector('#add')).requestSubmit();
    box.value = second;
    box.dispatchEvent(new Event('input', { bubbles: true }));
  }, { first, second });
  await expect(page.locator('#items')).toContainText(first);
  await expect(page.locator('#new-text')).toHaveValue(second);
  await page.click('#add button[type=submit]');
  await expect(page.locator('#items')).toContainText(second);
  await expect(page.locator('#new-text')).toHaveValue('');
  await page.context().setOffline(false);
  await serverHas(first);
  await serverHas(second);
});
