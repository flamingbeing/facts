// Sign-in, roles and sync for the app, on the shared engine's modules: createApp({ config, modules: [auth(), sync(),
// update()] }) from app-sync (an exact version from core.anawj.com, named once in index.html's import map).
//
// Firestore layout (rules in firestore.app.rules):
//   members/{uid}              { role: admin | member | viewer, v }   the role doc (source of truth; admins change it
//                              through the Worker's /api/members/, which revokes a removed person's access)
//   spaces/_/items/{id}        { text, updatedAt, serverAt, _edits }  the list (_edits: who changed each field, and when) ('_' is the single group)
//   spaces/_/verdicts/{id}     { fact, choice, text?, at, by, … }   Align's answers, one per line (cards.js docId)
//   spaces/_/bin/{coll:id}     { id, kind, data, deletedAt, … }       a deleted item's last version (delete to bin)
//
// Roles reach the rules as custom claims ({ g: { _: role }, v }), a cache of the role doc: the Worker's /api/claims
// writes them. The auth module reads the role doc live (claims.watch) and asks for new claims whenever its v is ahead
// of the token's; the page then shows what the token says.
//
// Every save goes to a durable outbox first (the sync module's write queue), then to the server in a transaction; a
// save that meets a change made elsewhere is kept as a conflict until the person chooses, and one the server refuses
// waits in a list until it is retried or discarded. Sign-out keeps this device's copy and its unsent saves (they send
// when the same account signs in again); another account signing in wipes them first (refused while any are unsent),
// and "Forget this device" wipes them on purpose.
import { createApp } from '@core/app';
import { auth } from '@core/auth';
import { sync, leaveEntry } from '@core/sync';
import { update } from '@core/update';
import { settings } from '@core/settings';
import * as register from 'app-update/register.js';
import { firebaseConfig, APP } from './config.js';
import { emulator, configured, roleOf, needsClaims } from './roles.js';
import { setHint } from './hint.js';
import { OPTIONS, SETTINGS_COLL } from './options.js';
import { dataModules } from './data-modules.js';
import { COLL } from './items.js';
import { VERDICTS, docId } from './cards.js';

export { usingEmulator } from './roles.js';
export { lastSignedIn, keepList, keptList } from './hint.js';
const SPACE = '_';
// (the list's shared bits live in items.js, the same in a static app; named here too for the files recipe)
export { COLL, itemText, REFUSED } from './items.js';

/** @typedef {import('./items.js').Item} Item */
/** @typedef {import('./items.js').User} User */
/** @typedef {import('./items.js').Phase} Phase */
/** @typedef {import('./items.js').State} State */

/** @type {Promise<{ A: typeof import('firebase/auth'), F: typeof import('firebase/firestore'), auth: any, db: any, emulator: boolean }> | null} */
let fb = null;
// The Firebase SDK, loaded once for every module (the import map names its version).
export function sdk() {
  if (fb) return fb;
  fb = (async () => {
    const [app, A, F] = await Promise.all([import('firebase/app'), import('firebase/auth'), import('firebase/firestore')]);
    // the emulator project is always demo-<name> (tools/fill.mjs keeps it in step with the tests), never the live one
    const cfg = emulator ? { apiKey: 'demo-key', projectId: 'demo-facts', authDomain: 'localhost', appId: 'demo' }
      : { ...firebaseConfig, authDomain: firebaseConfig.authDomain || APP.host };
    const a = app.initializeApp(cfg);
    const auth = A.getAuth(a);
    const db = F.getFirestore(a);   // no SDK offline cache: the engine keeps the device copy and the outbox
    if (emulator) {
      F.connectFirestoreEmulator(db, '127.0.0.1', emulator.fs);
      A.connectAuthEmulator(auth, `http://127.0.0.1:${emulator.auth}`, { disableWarnings: true });
    }
    return { A, F, auth, db, emulator: !!emulator };
  })();
  fb.catch(() => { fb = null; });
  return fb;
}

// Tests only (?emulator): sign in as a made-up Google account.
/** @param {string} email */
export async function emulatorSignIn(email) {
  if (!emulator) throw new Error('Only with ?emulator');
  const { A, auth } = await sdk();
  await A.signInWithCredential(auth, A.GoogleAuthProvider.credential(JSON.stringify({ sub: email.replace(/\W/g, ''), email, email_verified: true })));
}

// This phone's name for the popup ('Phone', 'Tablet', 'Computer'), from the browser; the app may let people set one.
function deviceName() {
  try {
    const ua = navigator.userAgent || '';
    return /iPad|Tablet/.test(ua) ? 'Tablet' : /iPhone|Android.*Mobile|Mobile/.test(ua) ? 'Phone' : 'Computer';
  } catch { return ''; }
}

/** @param {Record<string, unknown>} rec */
const binCopy = ({ serverAt, ...rest }) => JSON.parse(JSON.stringify(rest));
/**
 * @typedef {object} Hooks
 * @property {(s: State) => void} onState
 * @property {(items: Item[], changed: Set<string>) => void} onList  the list as this device has it, with its unsent saves
 *   laid over; changed: the ids whose copy changed since the last call (none the first time)
 * @property {(verdicts: import('./cards.js').Verdict[]) => void} [onVerdicts]  Align's answers as this device has them
 * @property {(byItem: Map<string, unknown[]>) => void} [onFiles]  every item's attached files (item id -> them), whenever
 *   one changes (the files recipe)
 */
/** @typedef {NonNullable<Awaited<ReturnType<typeof start>>>} Started */

// start({ canReload }) -> the modules' apis (for the UI kit) and the app's actions, or null when the app isn't set up.
// canReload: with a service worker, the app's own "nothing open" answer for the update's reload (it also waits for
// unsent saves); none: no update module. Nothing shows until follow(hooks).
/** @param {{ canReload?: (() => boolean | Promise<boolean>) | null }} o */
export async function start({ canReload = null }) {
  if (!configured) return null;
  let claimsStatus = 0, unsent = 0;
  /** @type {() => Promise<void>} */
  let show = async () => {};
  /** @type {Hooks | null} */
  let hooks = null;
  const modules = [
    auth({
      // roles: the role doc, read live, against the token's claims; /api/claims writes new ones
      claims: {
        url: '/api/claims', watch: true, doc: (/** @type {User} */ u) => ['members', u.uid],
        behind: (/** @type {any} */ doc, /** @type {any} */ claims) => needsClaims(claims, doc),
        onClaims: (/** @type {{ status: number }} */ { status }) => { if (status) claimsStatus = status; void show(); },
      },
    }),
    sync({
      colls: [COLL, VERDICTS, SETTINGS_COLL, ...(dataModules.files ? [dataModules.files.coll] : [])], path: (/** @type {string} */ space, /** @type {string} */ coll) => ['spaces', space, coll],
      scope: () => SPACE, device: deviceName(), wake: true,
      // a delete writes the item's last version to the bin in the same transaction ({ id, kind, data, deletedAt }:
      // the other devices drop the item from it, and data keeps the deleted version)
      // held: a same-field clash is kept on the phone that made the save until its person chooses (never overwritten);
      // edits: each write records who changed each field and when, for the popup
      // commitRetry: a send refused with permission-denied just after sign-in (the role check still catching up) is tried
      // once more after 500 ms, as app-sync advises for rules that read a document another write is creating
      backend: { stampMode: 'server', writeId: false, held: true, edits: '_edits', commitRetry: { codes: ['permission-denied'], delay: 500 },
        onCommit: (/** @type {any} */ { scope, coll, before, after, at, fields }) => coll === COLL && !after && before
          ? [{ path: ['spaces', scope, 'bin', `${coll}:${before.id}`], data: { ...leaveEntry(coll, before, at), data: binCopy(before), ...fields } }] : [] },
      hub: { bin: 'bin' }, stores: { metaOnly: ['bin'] },
      // a save the server refused is set aside (kept, with its code) until the person retries or discards it
      onRefused: () => 'archive',
    }),
    ...(dataModules.files ? [dataModules.files.engine(SPACE)] : []),
    settings({ options: OPTIONS, collection: SETTINGS_COLL, scope: SPACE }),
    ...(canReload ? [update({ register, app: 'app', sw: 'sw.js', canReload })] : []),
  ];
  const app = createApp({ config: { name: APP.name, sdk }, modules });
  await app.ready;
  const { auth: fa } = await sdk();
  // Firebase restores the saved sign-in a moment after it starts: until it has, "no user" is not yet "signed out"
  const settled = fa.authStateReady?.() ?? Promise.resolve();

  app.status$((/** @type {{ unsent: number }} */ st) => { unsent = st.unsent; });

  /** @type {(() => void) | null} */
  let offList = null;
  /** @type {(() => void) | null} */
  let offFiles = null;
  /** @type {(() => void) | null} */
  let offVerdicts = null;
  let seq = 0;
  // the token Firestore has been told about: its own token listener (added when the SDK started, so before this one)
  // runs in the same notification and restarts its connection with the new token. A list listen sent before that goes
  // out with the old token, the rules refuse it, and the engine doesn't listen again; so the list waits for this.
  let tokenSeen = '';
  fa.onIdTokenChanged(async (/** @type {any} */ u) => { tokenSeen = u ? await u.getIdToken().catch(() => '') : ''; void show(); });
  /** @type {(() => void) | null} */
  let offSettings = null;
  // the claims of the token Firebase last had (User.toJSON keeps it), for when it can't get a new one
  /** @param {any} u */
  const lastToken = u => {
    const token = u.toJSON?.()?.stsTokenManager?.accessToken || '';
    let claims = {};
    try { claims = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))); } catch { /* none */ }
    return { token, claims, stale: true };
  };
  const stopList = () => { offList?.(); offList = null; offFiles?.(); offFiles = null; offVerdicts?.(); offVerdicts = null; offSettings?.(); offSettings = null; };
  // the token as it is now decides what the page shows (after sign-in, and after every claims ask); the newest call wins
  show = async () => {
    if (!hooks) return;
    const { onState, onList, onFiles, onVerdicts } = hooks;
    const n = ++seq;
    await settled;
    if (n !== seq) return;
    const u = fa.currentUser, me = app.auth.user();
    if (u && !me) return;   // Firebase has the person; the engine's own copy of the user follows (onUser calls back)
    if (!u || !me || me.uid !== u.uid) { stopList(); setHint(false); onState({ phase: 'signed-out' }); return; }
    if (claimsStatus === 503) { setHint(false); onState({ phase: 'not-set-up' }); return; }
    // offline with an expired token Firebase can't refresh it (auth/network-request-failed): the role comes from the
    // last token it holds, so the saved list still shows; back online, the fresh token calls back (onIdTokenChanged)
    const t = await u.getIdTokenResult().catch(() => lastToken(u)), role = roleOf(t.claims);
    if (n !== seq) return;
    if (role && t.token !== tokenSeen && !t.stale) return;   // a new token Firestore hasn't seen yet: onIdTokenChanged calls back
    const user = { uid: me.uid, email: me.email, name: me.name };
    if (!role) { stopList(); setHint(false); onState({ phase: 'no-access', user, role: '' }); return; }
    setHint(true);
    onState({ phase: 'ready', user, role });
    offSettings ??= app.settings.follow();   // the account's options, heard from other devices (listening needs the role)
    let first = true;
    offList ??= app.sync.watch(SPACE, COLL, (/** @type {Item[]} */ list, /** @type {{ changed?: string[] }} */ meta) => {
      onList(list.filter(x => !x._deleted), new Set(first ? [] : meta?.changed || []));
      first = false;
    });
    if (onVerdicts) offVerdicts ??= app.sync.watch(SPACE, VERDICTS, (/** @type {any[]} */ list) => onVerdicts(list.filter(x => !x._deleted)));
    if (onFiles && dataModules.files) offFiles ??= dataModules.files.watch(app, SPACE, onFiles);
  };
  app.auth.onUser(() => { claimsStatus = 0; void show(); });

  /** @param {string} method @param {string} uid @param {unknown} [body] @returns {Promise<string>} */
  const membersCall = async (method, uid, body) => {
    try {
      const token = await fa.currentUser?.getIdToken();
      if (!token) return 'Sign in first.';
      const r = await fetch(`/api/members/${encodeURIComponent(uid)}`, { method, headers: { Authorization: `Bearer ${token}`,
        ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
      return r.ok ? '' : (await r.json().catch(() => ({}))).error || `Refused (${r.status})`;
    } catch { return 'Offline: try again.'; }
  };
  /** @param {Promise<unknown>} saving */
  const refusal = saving => saving.then(() => '', e => (e instanceof Error && e.message) || 'The server refused it');
  const id = () => (crypto.randomUUID?.() || String(Date.now()) + Math.random().toString(36).slice(2)).replace(/-/g, '');
  return {
    // the modules' apis, for the UI kit's parts (update: with a service worker only, else null)
    auth: app.auth, sync: app.sync, settings: app.settings, update: app.update || null, files: app.files,
    // the whole app's status (sync and the modules): { state, count, unsent }
    /** @param {(st: { state: string, count: number, unsent: number }) => void} fn */
    status$: fn => app.status$(fn),
    // from now on: onState with what the page shows, onList with the list once it is shown
    /** @param {Hooks} h */
    follow(h) { hooks = h; void show(); },
    // add and edit resolve to '' when the save is stored or queued, or to the reason when the server refused it at
    // once (app-sync rejects then; the copy waits in the refused list, so the page says so rather than fail)
    /** @param {string} text @returns {Promise<string>} */
    add: text => refusal(app.sync.save(COLL, SPACE, { id: id(), text, createdAt: Date.now() }, null)),
    // base: the copy the edit started from
    /** @param {Item} item @param {string} text @returns {Promise<string>} */
    edit: (item, text) => refusal(app.sync.save(COLL, SPACE, { ...item, text }, item)),
    // a delete takes the item's attached files with it (the files recipe)
    /** @param {Item} item @param {unknown[]} [attached] */
    remove: async (item, attached = []) => {
      void app.sync.hub.drop(SPACE, COLL, [item.id]);
      await app.sync.save(COLL, SPACE, { id: item.id, _deleted: true }, item);
      await dataModules.files?.removeAll(app, attached);
    },
    // one item, live from the server: cb(item) when its copy changes, cb(null) once the server says it is gone -> stop()
    /** @param {string} itemId @param {(item: Item | null) => void} cb @returns {() => void} */
    watchItem: (itemId, cb) => app.sync.watchDoc(['spaces', SPACE, COLL, itemId], cb),
    // Align: his answer on a line (one doc per line, the latest answer wins); base: the doc as this device had it, if any
    /** @param {string} fact @param {string} choice @param {string} text @param {import('./cards.js').Verdict | null} base @returns {Promise<string>} */
    verdict: (fact, choice, text, base) => {
      const by = fa.currentUser?.uid || '';
      // text is always written ('' for none), so a later "agree" clears an earlier edit's text
      return refusal(app.sync.save(VERDICTS, SPACE, { id: docId(fact), fact, choice, text: text.slice(0, 2000), at: Date.now(), by }, base));
    },
    // admins: set someone's role, or remove them (they lose access at once; their sessions end). -> '' or the reason
    members: {
      /** @param {string} uid @param {'admin' | 'member' | 'viewer'} role */
      setRole: (uid, role) => membersCall('PUT', uid, { role }),
      /** @param {string} uid */
      remove: uid => membersCall('DELETE', uid),
    },
    // Sign-out keeps this device's copy and unsent saves. -> how many are still unsent (they send at the next sign-in)
    async signOut() { await app.auth.signOut(); return unsent; },
  };
}
