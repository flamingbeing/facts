// Photos and files on items (@core/files): a photo added offline shows at once from this device and uploads once
// online (the e2e server's in-memory bucket); another phone fetches it; remove takes it off both; sign-out keeps an
// unsent upload for the same account's next sign-in, and another account signing in wipes this device's files.
import zlib from 'node:zlib';
import axe from './axe.mjs';
import { test, expect, clickOpens, setOffline, uniq, signIn, signInAgain, add, db, synced, openSettings, openItems } from './fixtures.mjs';

// A small solid-colour PNG, made here (no binary fixture in the repo).
function png(w, h, [r, g, b]) {
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = buf => { let c = 0xffffffff; for (const x of buf) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => {
    const out = Buffer.alloc(12 + data.length);
    out.writeUInt32BE(data.length, 0); out.write(type, 4, 'ascii'); data.copy(out, 8);
    out.writeUInt32BE(crc(out.subarray(4, 8 + data.length)), 8 + data.length);
    return out;
  };
  const head = Buffer.alloc(13);
  head.writeUInt32BE(w, 0); head.writeUInt32BE(h, 4); head[8] = 8; head[9] = 2;
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: w }, () => [r, g, b]).flat())]);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', head),
    chunk('IDAT', zlib.deflateSync(Buffer.concat(Array.from({ length: h }, () => row)))), chunk('IEND', Buffer.alloc(0))]);
}

const openItem = (page, text) => clickOpens(page.getByRole('button', { name: text, exact: true }), page.locator('#edit'));
const attach = (page, name, buffer, mimeType = 'image/png') => page.setInputFiles('#edit-file', { name, mimeType, buffer });
// the shared space's file records on the server (db.list leaves document ids out)
const records = async name => (await db.list('spaces/_/files')).filter(d => d.name === name);
// the keys of the blobs this phone keeps (IndexedDB facts-files / blobs). Other tests' photos on the shared list
// are cached here too (their thumbnails), so a test checks its own keys, not a count, until a wipe empties it.
const cached = page => page.evaluate(() => new Promise((ok, no) => {
  const r = indexedDB.open('facts-files');
  r.onerror = () => no(r.error);
  r.onsuccess = () => {
    const d = r.result;
    if (!d.objectStoreNames.contains('blobs')) { d.close(); ok([]); return; }
    const c = d.transaction('blobs').objectStore('blobs').getAllKeys();
    c.onsuccess = () => { d.close(); ok(c.result); };
  };
}));
const loaded = img => expect.poll(() => img.evaluate(el => el.complete && el.naturalWidth > 0)).toBe(true);

test('a photo added offline shows at once, uploads online, opens on another phone, and remove takes it off both', async ({ phone }) => {
  const a = await phone({ blobs: true });
  const { email } = await signIn(a);
  const t = uniq('photo');
  await add(a, t);
  // (offline before the sheet opens: an item's live watch losing its connection is app-sync's to settle)
  await setOffline(a.context(), true);
  await openItem(a, t);
  await attach(a, `${t}.png`, png(800, 600, [200, 40, 40]));
  const row = a.locator('#edit-files li', { hasText: `${t}.png` });
  await expect(row).toBeVisible();
  await loaded(row.locator('img.thumb'));   // from this device's cache, with no network
  expect(await records(`${t}.png`)).toEqual([]);
  await a.click('#edit button[value=cancel]');
  await loaded(a.locator('#items li', { hasText: t }).locator('img.thumb'));
  expect(await axe(a), 'the list with a thumbnail').toEqual([]);

  await setOffline(a.context(), false);
  await expect.poll(async () => (await records(`${t}.png`))[0]?.state, { timeout: 15_000 }).toBe('stored');
  const [rec] = await records(`${t}.png`);
  expect(rec).toMatchObject({ type: 'image/webp', w: 800, h: 600, thumb: true });

  const b = await phone({ blobs: true });
  await signInAgain(b, email);
  await loaded(b.locator('#items li', { hasText: t }).locator('img.thumb'));   // fetched from the Worker
  await openItem(b, t);
  await loaded(b.locator('#edit-files li', { hasText: `${t}.png` }).locator('img.thumb'));
  expect(await axe(b), 'the sheet with a photo').toEqual([]);
  await b.click('#edit button[value=cancel]');

  await openItem(a, t);
  await a.getByRole('button', { name: `Remove ${t}.png` }).click();
  await a.getByRole('button', { name: 'Remove', exact: true }).click();   // the confirm
  await expect(row).toHaveCount(0);
  await expect.poll(() => records(`${t}.png`), { timeout: 15_000 }).toEqual([]);
  await expect(b.locator('#items li', { hasText: t }).locator('img.thumb')).toHaveCount(0, { timeout: 15_000 });
});

test('a file that is not a picture is kept as it is; sign-out keeps an unsent upload, another account wipes the files', async ({ phone }) => {
  const page = await phone({ blobs: true });
  const { email } = await signIn(page);
  const t = uniq('doc');
  await add(page, t);
  // (offline before the sheet opens: an item's live watch losing its connection is app-sync's to settle)
  await setOffline(page.context(), true);
  await openItem(page, t);
  await attach(page, `${t}.txt`, Buffer.from('made-up notes'), 'text/plain');
  await expect(page.locator('#edit-files li', { hasText: `${t}.txt` })).toBeVisible();
  await expect(page.locator('#edit-files li', { hasText: `${t}.txt` }).locator('img')).toHaveCount(0);
  await page.click('#edit button[value=cancel]');
  await expect(page.locator('#items li', { hasText: t })).toContainText('📎');

  await openSettings(page);
  await page.click('#sign-out');
  await expect(page.locator('#sign-out-msg')).toContainText('unsent');
  await openItems(page);
  const [job] = await page.evaluate(() => window.starter.files().jobs());
  expect(job).toMatchObject({ op: 'put', rec: { name: `${t}.txt` } });
  expect(await cached(page)).toContain(`${job.scope}/${job.id}`);
  await setOffline(page.context(), false);
  await page.evaluate(e => window.starter.signInAs(e), email);
  await expect(page.locator('#list-view')).toBeVisible();
  await expect.poll(async () => (await records(`${t}.txt`))[0]?.state, { timeout: 15_000 }).toBe('stored');
  expect(await records(`${t}.txt`)).toEqual([expect.objectContaining({ type: 'text/plain', size: 13 })]);
  await synced(page);   // the upload's job is done too (a switch waits while anything is unsent)

  await openSettings(page);
  await page.click('#sign-out');
  await openItems(page);
  await expect(page.locator('#signed-out')).toBeVisible();
  const other = `${uniq('u')}@example.com`;
  await page.evaluate(e => window.starter.signInAs(e), other);
  await expect(page.locator('#no-access')).toBeVisible();
  await expect.poll(() => cached(page)).toEqual([]);
});

// Removing someone revokes the account (revoked/{uid}): the files route refuses their uploads at once.
test('an admin removes a member: the files route refuses their uploads', async ({ phone }) => {
  const admin = await phone(), gone = await phone();
  await signIn(admin, 'admin');
  const { uid } = await signIn(gone, 'member');
  const upload = () => gone.evaluate(async uid => {
    const { getAuth } = await import('firebase/auth');
    const t = await getAuth().currentUser?.getIdToken().catch(() => '');
    return (await fetch(`/api/files/${uid}/f1`, { method: 'PUT', body: 'x', headers: { Authorization: `Bearer ${t}` } })).status;
  }, uid);
  expect(await upload()).toBe(201);
  expect(await admin.evaluate(u => window.starter.members().remove(u), uid)).toBe('');
  expect(await upload()).toBe(403);
});
