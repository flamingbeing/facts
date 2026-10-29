// Before the run: wait for the emulators, then empty them, so every run starts from a clean demo project like CI does.
// A reused emulator (a second local run) otherwise keeps every earlier run's items and accounts: the shared list grows,
// each new phone's first snapshot and the emulator's listeners slow down (sign-in timeouts at fixtures.mjs), and
// fixed names like glass.spec's "Sample item 14" turn up twice.
import { waitForEmulators } from '../.devkit/playwright/helpers.mjs';

const PROJECT = 'demo-facts';   // a demo- project: emulator only, never a live one

export default async () => {
  await waitForEmulators(['firestore', 'auth']);
  if (process.env.PW_NO_EMULATOR) return;
  const fs = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
  const auth = process.env.FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:9099';
  for (const url of [
    `http://${fs}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`,
    `http://${auth}/emulator/v1/projects/${PROJECT}/accounts`,
  ]) {
    const r = await fetch(url, { method: 'DELETE' });
    if (!r.ok) throw new Error(`emptying the emulator failed: DELETE ${url} -> ${r.status}`);
  }
};
