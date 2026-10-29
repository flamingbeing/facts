# 0009: Files (`@core/files`) go through the app's own Worker to R2; device first, queue to send

Status: accepted (2026-10-26)

Decision: an app's photos and files are `@core/files`, v0, incubating in `app/public/files/` with its own import map
entry (`./files/index.js`), `needs: ['auth', 'sync']`, like `@core/ui` (decision 0008). It moves into app-sync once a
third app uses it.

- **Bytes go through the Worker**, `/api/files/<scope>/<id>[.thumb]` (`worker/files.js`, routed from `sites.js`), into
  the R2 bucket bound as `FILES`. The Worker checks the same Firebase ID token as `/api/claims` (the shared verifier,
  not a copy) and the same gates as the Firestore rules (scope and role, the access end `x`, `revoked/{uid}` read as the
  service account); no R2 keys exist anywhere. One file is at most 100 MB
  (the Workers request limit). Presigned URLs and a home server are Later.
- **Device first:** `add` returns at once. The bytes (and a thumbnail) go to IndexedDB, the metadata record goes
  through `sync.save` in the app's own collection, and an upload job waits in the module's storage until the device
  is online and signed in, with back-off; unsent files count as unsent in the status, so sign-out warns and the
  update prompt waits. Sign-out keeps the device's files and queue; a switch to another account wipes them, the same
  rule as sync's device copy. Formats in NOTES, "Files formats".
- **Pictures are resized** on the device with own canvas code (longest side 2048, thumbnail 320, webp with a jpeg
  fallback); the re-encode drops the photo's EXIF, place included. Other files are kept as they are.
- **EXIF is opt-in** (`exif: true`): vendored exifr's lite build, loaded on first use only, reads the date taken
  before the re-encode, and the place only when the app asks (`exif: { place: true }`).
- **Pay-for-use:** a page that never imports `@core/files` loads none of it (the Vite check asserts this).

Why: the Worker is already the app's one address and token check, so files need no new keys, CORS or service, and
R2 has no egress fees. Device first is what sync already does for records, so offline add and the unsent warning
behave the same for both.

Cost: one R2 bucket per app, made once before the first deploy (README, "Start an app"); file bytes pass through
the Worker, so very large files wait for presigned URLs.
