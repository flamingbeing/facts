// /api/files/<scope>/<id>: the bytes of the app's files (@core/files), in the R2 bucket bound as FILES (wrangler.jsonc).
// No R2 keys anywhere: the Worker is the only way in, and it checks the same Firebase ID token as /api/claims.
//
//   PUT    /api/files/<scope>/<id>[.thumb]  body = the file (Content-Length required, at most maxBytes), Content-Type kept
//   GET    /api/files/<scope>/<id>[.thumb]  -> the bytes, Cache-Control: private
//   DELETE /api/files/<scope>/<id>          removes the file and its thumbnail (gone already is fine)
//
// The object key is `<scope>/<id>[.thumb]`. scope is the signed-in account's uid (a personal file) or a shared scope
// the token's role allows, by the same rule as the app's Firestore rules (claims { g: { <scope>: role } }): any role
// reads, admin and member write. Personal files need a role too to be written: a signed-in account the app never gave
// a role (admin or member in some group) can't upload. An app with other rules passes its own access().
//
// handleFiles(request, { bucket, verify, revoked, maxBytes, access, origin, now }) is pure: bucket is R2's interface (put, get, delete),
// so the unit tests and the e2e server (e2e/serve.mjs) give it an in-memory one (e2e/memory-bucket.mjs).
//   verify(idToken) -> the token's payload, or throws (sites.js: claims.js's verifyIdToken, shared, not copied)
//   revoked(uid) -> true once a member was removed (revoked/{uid}, as the rules' notRevoked()); null skips it
// Answers 201/204 (or the bytes), or { error } with 400/401/403/404/405/411/413/503.

export const MAX_BYTES = 100_000_000;   // the Workers request body limit (Free and Pro plans)
const PATH = /^\/api\/files\/([A-Za-z0-9_-]{1,128})\/([A-Za-z0-9_-]{1,64})(\.thumb)?$/;
const TYPE = /^[a-z0-9][a-z0-9!#$&^_.+-]{0,63}\/[a-z0-9][a-z0-9!#$&^_.+-]{0,63}$/;
const WRITERS = ['admin', 'member'], READERS = ['admin', 'member', 'viewer'];

/** The starter's rule: your own uid (writes: with admin or member in some group), or a shared scope your role allows
 * (writes: admin and member); not after the access end in the claims (`x`, seconds), the same gate as the rules' live(). */
export function defaultAccess({ token, scope, write, now = Date.now() }) {
  if (token.x != null && !(now < Number(token.x) * 1000)) return false;
  const g = token.g && typeof token.g === 'object' ? token.g : {};
  if (scope === token.sub) return !write || Object.values(g).some(r => WRITERS.includes(r));
  return (write ? WRITERS : READERS).includes(g[scope]);
}

export async function handleFiles(request, { bucket, verify, maxBytes = MAX_BYTES, access = defaultAccess, origin, revoked = null, now = Date.now } = {}) {
  const m = new URL(request.url).pathname.match(PATH);
  if (!m) return json({ error: 'Not found.' }, 404);
  const [, scope, id, thumb] = m;
  const method = request.method;
  if (!['GET', 'PUT', 'DELETE'].includes(method)) return json({ error: 'GET, PUT or DELETE.' }, 405, { Allow: 'GET, PUT, DELETE' });
  if (method === 'DELETE' && thumb) return json({ error: 'Delete the file; its thumbnail goes with it.' }, 400);
  if (!bucket || typeof verify !== 'function') return json({ error: 'Files are not set up yet.' }, 503);
  const from = request.headers.get('Origin');
  if (origin && from && from !== origin) return json({ error: 'Wrong origin.' }, 403);

  const idToken = (request.headers.get('Authorization') || '').match(/^Bearer\s+(\S+)$/)?.[1];
  if (!idToken) return json({ error: 'Sign in first.' }, 401);
  let token;
  try { token = await verify(idToken); } catch (e) { return json({ error: 'Sign in again.', why: e?.message }, 401); }
  if (!access({ token, scope, write: method !== 'GET', now: now() })) return json({ error: 'No access to these files.' }, 403);
  if (revoked) {
    let gone;
    try { gone = await revoked(token.sub); } catch (e) { return json({ error: 'Try again later.', why: e?.message }, 503); }
    if (gone) return json({ error: 'No access to these files.' }, 403);
  }

  const key = `${scope}/${id}${thumb || ''}`;
  // the bucket failing (R2 down) is "try again", in JSON with the usual headers, not the Worker's own error page
  try { return await serve(); } catch (e) { return json({ error: 'Try again later.', why: e?.message }, 503); }

  async function serve() {
    if (method === 'GET') {
      const obj = await bucket.get(key);
      if (!obj) return json({ error: 'Not found.' }, 404);
      const type = obj.httpMetadata?.contentType || 'application/octet-stream';
      const headers = { 'Content-Type': type, 'Cache-Control': 'private', 'X-Content-Type-Options': 'nosniff' };
      // only pictures show in the page; anything else downloads, so a file can never run as a page of this address
      if (!/^image\/(png|jpeg|webp|gif|avif)$/.test(type)) headers['Content-Disposition'] = 'attachment';
      if (obj.size != null) headers['Content-Length'] = String(obj.size);
      return new Response(obj.body, { status: 200, headers });
    }
    if (method === 'DELETE') {
      await bucket.delete([key, key + '.thumb']);
      return new Response(null, { status: 204 });
    }
    const size = Number(request.headers.get('Content-Length'));
    if (!request.headers.has('Content-Length') || !Number.isInteger(size) || size < 0) return json({ error: 'Content-Length needed.' }, 411);
    if (size > maxBytes) return json({ error: 'Too big.', max: maxBytes }, 413);
    const raw = (request.headers.get('Content-Type') || '').split(';')[0].trim().toLowerCase();
    const contentType = TYPE.test(raw) ? raw : 'application/octet-stream';
    await bucket.put(key, request.body, { httpMetadata: { contentType }, customMetadata: { by: token.sub } });
    return json({ ok: true, key }, 201);
  }
}

function json(body, status, extra = {}) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extra } });
}
