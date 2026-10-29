# 0006: One Firebase project per app; tests only on demo- projects

Status: accepted (2026-10-25)

Decision: each app has its own Firebase project (no shared one). Tests run only against the local emulators with a
`demo-<name>` project, which can't reach a live project; the app connects to the emulators only on localhost with
`?emulator`.
