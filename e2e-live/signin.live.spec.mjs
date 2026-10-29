// Live sign-in smoke test (workflow "Live smoke"; not part of `npx playwright test`). Signs the test user in on the
// deployed site and checks the signed-in, no-data state: the app shows the signed-in screen for an account that has no
// role yet, and the browser logs no errors. The test user is in no app data, so nothing is read or written.
// The starter signs in with Google only, so the test user (email + password) is signed in through the API
// (app-devkit playwright/live.mjs). Run: LIVE_URL=... LIVE_SPEC=e2e-live LIVE_TEST_EMAIL=... LIVE_TEST_PASSWORD=...
//   npx playwright test -c .devkit/playwright/live.config.mjs
import { test, expect } from '@playwright/test';
import { liveUser, watchConsole, signInViaApi } from '../.devkit/playwright/live.mjs';
import { firebaseConfig } from '../app/src/config.js';

const { email, password } = liveUser();
test.skip(!email || !password || !firebaseConfig.apiKey, 'no test user, or the app has no web config yet');

test('the test user is signed in on the live site, with no data and no console errors', async ({ page }) => {
  const errors = watchConsole(page);
  await page.goto('/');
  await expect(page.locator('#signed-out')).toBeVisible();
  await signInViaApi(page, { apiKey: firebaseConfig.apiKey, authDomain: firebaseConfig.authDomain, email, password });
  await page.reload();
  await expect(page.locator('#who')).toHaveText(email);
  await expect(page.locator('#signed-out')).toBeHidden();
  await expect(page.locator('#align-count')).toBeHidden();   // an account with no role sees no cards
  expect(errors).toEqual([]);
});
