// cloud.js's pure parts, with no imports Node can't resolve (app/test/cloud.unit.test.mjs runs them): the emulator
// switch, whether the app is set up, roles from the token's claims, and plain words for errors.
import { firebaseConfig } from './config.js';

// ?emulator on localhost (tests): the local emulators and a demo- project
/** @returns {{ fs: number, auth: number } | null} */
export const emulator = (() => {
  try {
    if (!/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) return null;
    const v = new URLSearchParams(location.search).get('emulator');
    if (v === null) return null;
    const [fs, auth] = v.split(':').map(Number);
    return { fs: fs || 8080, auth: auth || 9099 };
  } catch { return null; }
})();
export const usingEmulator = !!emulator;
export const configured = !!emulator || !!(firebaseConfig.apiKey && firebaseConfig.projectId);

/** @typedef {{ g?: { _?: unknown }, v?: unknown } & Record<string, unknown>} Claims */
/** @typedef {{ role?: string, v?: unknown } | null} RoleDoc */

// The role from the token's claims ('' = none); the token's claims version.
/** @param {Claims | null | undefined} claims @returns {string} */
export const roleOf = claims => (claims?.g && typeof claims.g._ === 'string') ? claims.g._ : '';
/** @param {Claims | null | undefined} claims @returns {number} */
export const versionOf = claims => Number.isInteger(claims?.v) ? Number(claims?.v) : -1;
// New claims are needed when the token has none yet, the role doc moved on, or it is gone while the token has a role.
/** @param {Claims | null | undefined} claims @param {RoleDoc | undefined} doc @returns {boolean} */
export const needsClaims = (claims, doc) => versionOf(claims) < 0
  || (doc ? (Number(doc.v) || 0) > versionOf(claims) || doc.role !== roleOf(claims) : roleOf(claims) !== '');
