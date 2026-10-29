// The files module's rules cases (@core/files), loaded by app/test/rules.test.mjs.

export const collections = [
  { path: 'spaces/_/files/f1', read: ['admin', 'member', 'viewer'], write: ['admin', 'member'],
    data: { name: 'a.webp', type: 'image/webp', size: 10, state: 'local', item: 'i1', updatedAt: 1 }, stamp: 'strict',
    list: { roles: ['admin', 'member', 'viewer'] } },
];

export function tests({ test, assert, emu, as }) {
  test('files: the record of a photo or file on an item; known fields only, in their shapes', async () => {
    await emu.clear();
    const at = { serverAt: true }, ok = { name: 'a.webp', type: 'image/webp', size: 10, w: 4, h: 3, thumb: true, taken: 5, state: 'local', item: 'i1', updatedAt: 1 };
    const put = data => as('member').set('spaces/_/files/f', data, at);
    assert.equal((await put(ok)).ok, true);
    assert.equal((await put({ ...ok, state: 'stored' })).ok, true);
    assert.equal((await as('viewer').set('spaces/_/files/f', ok, at)).ok, false, 'viewers only read');
    assert.equal((await put({ ...ok, place: { lat: 1, lng: 2 } })).ok, false, 'the place is never kept here');
    assert.equal((await put({ ...ok, state: 'gone' })).ok, false);
    assert.equal((await put({ ...ok, item: '' })).ok, false, 'on an item');
    assert.equal((await put({ ...ok, name: '' })).ok, false);
    assert.equal((await put({ ...ok, size: 1.5 })).ok, false);
    assert.equal((await put({ ...ok, thumb: 'yes' })).ok, false);
    assert.equal((await as('member').set('spaces/_/files/g', ok)).ok, false, 'unstamped');
  });
}
