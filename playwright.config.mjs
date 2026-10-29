// Browser tests: npx playwright test (README, "Tests"). The emulators (demo- project, made-up accounts; never a live
// project) and the e2e server (the real Worker in Node) start here unless already running. The kit's base config comes
// from app-devkit (.devkit/, put there by setup-browser in CI; copy it once locally).
import { baseConfig } from './.devkit/playwright/base.mjs';
import { emulatorServer } from './.devkit/playwright/helpers.mjs';

export const PORT = 4173;
// the emulators' firebase-tools (also package.json "rules" and checks.yml): 15.33.0 has Firestore emulator v1.22, the
// first not to lose a change written while a Listen stream restarts after a token refresh (list.spec, "during a token refresh")
const FIREBASE_TOOLS = '15.33.0';
export default baseConfig({
  testDir: 'e2e',
  testMatch: '*.spec.mjs',
  projects: ['phone'],
  retries: 0,   // a flake is a bug to fix, not a retry
  globalSetup: './e2e/global-setup.mjs',
  // PW_CHROMIUM: a Chromium already on the machine (when the pinned Playwright's own download isn't there)
  use: { baseURL: `http://localhost:${PORT}`, launchOptions: process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {} },
  webServer: [
    emulatorServer({ project: 'demo-starter-app', only: 'firestore,auth', cwd: 'app', firebaseTools: FIREBASE_TOOLS }),
    { command: `node e2e/serve.mjs ${PORT}`, url: `http://localhost:${PORT}/app/`, reuseExistingServer: !process.env.CI, timeout: 30_000 },
  ],
});
