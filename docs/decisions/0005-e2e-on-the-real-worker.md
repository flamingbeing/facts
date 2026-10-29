# 0005: Browser tests run on the real Worker

Status: accepted (2026-10-25)

Context: a static test server would skip the headers, the routes and `/api/claims`.

Decision: `e2e/serve.mjs` runs `worker/sites.js` in Node with the repo's files as its assets and the emulators behind
`/api/claims` (emulator mode is honoured on localhost only, with a `demo-` project). A test hook (`/__test/bump`)
changes `sw.js` so the update test sees a new version.

Consequences: the tests cover the headers and the claims route as deployed; wrangler is needed only to deploy.
