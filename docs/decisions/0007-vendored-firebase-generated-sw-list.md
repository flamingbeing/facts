# 0007: Firebase vendored; the service worker's file list generated; Vite as a check only

Status: accepted (2026-10-25)

Decision: the page loads Firebase from its own address (`app/public/vendor/firebase/<version>/`: gstatic's files,
byte for byte, but the one import of `firebase-app.js` made relative; `tools/firebase.lock.json` holds their sha256),
and `sw.js`'s SHELL list is generated (`tools/sw-files.mjs`: the app folder plus every file the import map's core
entries load, read from the `app-sync` devDependency at the same version). Vite is a dev dependency used only by CI
(`vite build` with everything in the import map external, then the whole browser suite on the build); nothing
deployed comes from it.

Measured before deciding (12.19.0, app + auth + firestore): 948,654 bytes raw; gstatic sends 244,650 bytes gzip (no
Brotli); the same files compress to 203,257 bytes with Brotli, which Cloudflare can serve. Offline: before, Firebase
was cached only once the page had fetched it (the SDK runtime rule); now it installs with the rest of the version, so
a phone that opened the app once starts with no network (`e2e/offline.spec.mjs`), and the page needs no second site
(one fewer connection on a slow network; `www.gstatic.com` left the CSP). Cost: a Firebase bump is
`node tools/vendor-firebase.mjs <version>` plus `node tools/sw-files.mjs app`, in one PR.
