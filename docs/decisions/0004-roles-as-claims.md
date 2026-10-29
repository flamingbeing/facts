# 0004: Roles from role docs, cached as claims

Status: accepted (2026-10-25)

Context: rules that read a role document cost a lookup per request; claims cost none but can go stale.

Decision: `members/{uid}` = `{ role, v }` is the source of truth. The Worker's `/api/claims` (app-devkit `claims.js`)
writes `{ g: { _: role }, v, m }` on the account; the page refreshes its token at sign-in and whenever the doc's `v` is
ahead, or the doc is gone. Rules use the rules kit's `can('_', roles)` (claim, expiry and `revoked/{uid}`). One group,
`_`, by default.

Only the Worker writes role docs (amended 2026-10-27): `PUT /api/members/<uid>` sets a role (v + 1) and
`DELETE /api/members/<uid>` removes someone (`worker/members.js`); the caller must be an admin by their own role doc
(or the owner by default) and not revoked. The rules refuse every page write to `members/`. A page deleting the doc
only took the role away at the next claims ask, and nothing wrote `revoked/{uid}` or ended the sessions.

Consequences: a role change reaches an open page within seconds. A removal deletes the doc, then `admin().revoke()`:
`revoked/{uid}` cuts the person off at once in the rules and the files route, the claims are cleared, and their
refresh tokens stop working, so they are signed out within the hour their ID token has left (the Auth emulator does
not refuse old refresh tokens; e2e reads the account's `validSince` instead). Adding them back clears `revoked/` at
their next claims ask (they sign in again). The first admin doc still comes from the Firebase console (no rules there).
