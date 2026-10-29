// Where the app's roles live: one role doc per person, members/{uid} = { role, v }. The doc is the source of truth;
// the claims on the account (rules kit shape, single group '_') are a cache of it, written by /api/claims.
// v goes up whenever an admin changes the doc, so a page whose token carries an older v asks for new claims.
export const ROLES = ['admin', 'member', 'viewer'];
// The owner is an admin of every app made from this template, with no role doc needed. A role doc still wins (so an
// admin can demote or remove them); only a verified email counts.
export const DEFAULT_ADMINS = ['kohwenjun@gmail.com'];

export async function loadClaims({ uid, token, admin }) {
  const d = await admin.getDoc(`members/${uid}`);
  if (!d && token?.email_verified === true && DEFAULT_ADMINS.includes(String(token.email).toLowerCase())) return { g: { _: 'admin' }, v: 0 };
  if (!d || !ROLES.includes(d.role)) return null;   // not (or no longer) a member: claims cleared
  return { g: { _: d.role }, v: Number.isInteger(d.v) ? d.v : 0 };
}

// /api/members/<uid>: the only way to change the role docs (the rules refuse pages' writes to members/). The caller must
// be an admin by their own role doc now (or the owner by default), not revoked; nobody changes their own doc here.
//   PUT    /api/members/<uid>  { role }  sets the role, v + 1 (the person's page then asks for new claims)
//   DELETE /api/members/<uid>            removes the person: their doc goes, then admin.revoke() (revoked/{uid} so the
//                                        rules refuse at once, claims cleared, refresh tokens ended: signed out within
//                                        the hour their ID token has left, and the files route refuses at once too)
// handleMembers(request, { admin, verify, origin }): admin is claims.js's admin(...) (null: 503), verify(idToken) the
// same ID token check as /api/claims. Answers { ok: true }, or { error } with 400/401/403/404/405/500/503.
const PATH = /^\/api\/members\/([A-Za-z0-9_-]{1,128})$/;

export async function handleMembers(request, { admin: adm, verify, origin } = {}) {
  const m = new URL(request.url).pathname.match(PATH);
  if (!m) return json({ error: 'Not found.' }, 404);
  const uid = m[1], method = request.method;
  if (method !== 'PUT' && method !== 'DELETE') return json({ error: 'PUT or DELETE.' }, 405, { Allow: 'PUT, DELETE' });
  if (!adm || typeof verify !== 'function') return json({ error: 'Members are not set up yet.' }, 503);
  const from = request.headers.get('Origin');
  if (origin && from && from !== origin) return json({ error: 'Wrong origin.' }, 403);
  const idToken = (request.headers.get('Authorization') || '').match(/^Bearer\s+(\S+)$/)?.[1];
  if (!idToken) return json({ error: 'Sign in first.' }, 401);
  let token;
  try { token = await verify(idToken); } catch (e) { return json({ error: 'Sign in again.', why: e?.message }, 401); }
  try {
    const mine = await loadClaims({ uid: token.sub, token, admin: adm });
    if (mine?.g._ !== 'admin' || await adm.getDoc(`revoked/${token.sub}`)) return json({ error: 'Admins only.' }, 403);
    if (uid === token.sub) return json({ error: 'Ask another admin to change your own role.' }, 400);
    if (method === 'DELETE') {
      // the doc first: should the revoke fail, the person's page sees it gone and drops its claims; asking again finishes
      await adm.deleteDoc(`members/${uid}`);
      await adm.revoke(uid);
      return json({ ok: true });
    }
    let body;
    try { body = await request.json(); } catch { body = null; }
    if (!ROLES.includes(body?.role)) return json({ error: `role: one of ${ROLES.join(', ')}.` }, 400);
    const d = await adm.getDoc(`members/${uid}`);
    await adm.setDoc(`members/${uid}`, { ...(d || {}), role: body.role, v: (Number.isInteger(d?.v) ? d.v : 0) + 1 });
    return json({ ok: true });
  } catch (e) {
    console.error('members failed', e?.message);
    return json({ error: 'Couldn’t change that. Try again.' }, 500);
  }
}

function json(body, status, extra = {}) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extra } });
}
