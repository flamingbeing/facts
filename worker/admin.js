// The Firestore admin client the Worker's routes share (claims, members and modules' routes such as files).
// The real project with the service account in Worker secrets; on localhost with EMULATOR set (the e2e server only)
// the emulators, which need no account and accept only a demo- project.
// One per isolate, so its access token (an hour) serves every request rather than an exchange with Google per request.
import { admin } from './claims.js';

const admins = new Map();
/** @param {any} env @param {boolean} local @param {string} project */
export function adminFor(env, local, project) {
  if (local && env.EMULATOR) return admin({ project, emulator: { auth: env.AUTH_EMULATOR, firestore: env.FIRESTORE_EMULATOR } });
  if (!(env.SA_EMAIL && env.SA_KEY && project)) return null;
  const key = `${project}\n${env.SA_EMAIL}\n${env.SA_KEY}`;
  if (!admins.has(key)) admins.set(key, admin({ project, sa: { email: env.SA_EMAIL, key: env.SA_KEY } }));
  return admins.get(key);
}
