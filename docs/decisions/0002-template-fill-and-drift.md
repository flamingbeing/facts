# 0002: A template repo, a fill script and a drift report

Status: accepted (2026-10-25)

Context: a new app should start in minutes with sign-in, rules, tests, headers and CI already working. GitHub
templates copy files once and have no update path.

Decision: this repo is a GitHub template with its own Checks (so it can't rot). `tools/fill.mjs` turns a copy into an
app (name, host, design kit, Firebase project), is idempotent and is tested in CI on a scratch copy. `.starter.json`
records the template version and commit an app started from; app-devkit's drift report compares an app with the
template and only reports, never overwrites.

Consequences: improvements reach existing apps by hand, guided by the drift report. Shared code is never copied in:
app-sync, app-update and the design kit are linked by exact version (or the kit's `v1/` address).
