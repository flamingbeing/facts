# 0003: Content-Security-Policy, Report-Only first

Status: accepted (2026-10-25)

Context: a strict CSP stops injected scripts, but a wrong one breaks sign-in or sync on the phones, and Google
sign-in, Firestore and the design kit need several origins allowed.

Decision: `worker/headers.js` sends the policy as `Content-Security-Policy-Report-Only`. The browser tests listen for
`securitypolicyviolation` and fail on any report. The live browser sends its reports to `/api/csp`
(`worker/csp-report.js`), which writes one line each (`csp-report <directive> <blocked> on <path>`) to the Worker
log (Workers Logs in the Cloudflare dashboard, or `npx wrangler tail`). Once a live app's sign-in, sync and update
show no reports there, set `CSP_ENFORCE` to true (one line) and record it here. Firebase's sign-in helper pages
(`/__/auth/`, `/__/firebase/`, passed on from firebaseapp.com) run their own inline script and get no app policy,
only `frame-ancestors 'self'` (2026-10-27).

Consequences: no protection from the CSP until it is enforced; the other headers (HSTS, nosniff, frame-ancestors,
Referrer-Policy, Permissions-Policy) apply from the first deploy.
