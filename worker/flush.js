// The owner's queue for the notes' processor, and the open flags for his flag cards. Owner only: his verified email
// (members.js DEFAULT_ADMINS); readers' answers stay in their own app data and never reach the queue.
//
//   POST /api/flush   reads the verdicts saved since the last flush (Firestore, as the service account: serverAt after
//                     flush/{uid}.upto), keeps his answers that ask for a change (ACTION), adds them to that day's
//                     queue file in the private notes repo (queue/<SGT date>.json, one commit) and moves the mark on.
//                     -> { ok, n } (n: items added). The page calls it after a card, once the finger is up, and on close;
//                     a lost call costs nothing, the next one takes everything since the mark.
//   GET  /api/flags   the open flags (flags.json in the same repo) -> { flags: [...] }
//
// The repo is written with a fine-grained GitHub token (Worker secret GITHUB_TOKEN: that repo only, contents read and
// write; kept in the owner's secrets vault first). Local (the tests): the flags come from e2e/fixtures/flags.json and
// nothing is written to GitHub; the answer lists the items instead. Only this app has this queue, so it lives here.
import { verifyIdToken, fromValue } from './claims.js';
import { adminFor } from './admin.js';
import { DEFAULT_ADMINS } from './members.js';

export const REPO = 'flamingbeing/anaesfacts-private';
const API = `https://api.github.com/repos/${REPO}/contents/`;
// the answers that ask for a change to the notes; agree, me-wrong and seen only move the mark
export const ACTION = ['repo-wrong', 'edit', 'also-true', 'bad-question', 'accept-fix', 'keep', 'add'];
const PAGE = 200, PAGES = 5;

/** @param {any} token */
export const isOwner = token => token?.email_verified === true && DEFAULT_ADMINS.includes(String(token.email || '').toLowerCase());

/** @param {number} ms -> the SGT date, YYYY-MM-DD */
export const sgtDate = ms => new Date(ms + 8 * 3600e3).toISOString().slice(0, 10);

/** a verdict doc as the queue keeps it: the line (or flag), his answer, the question he saw, when */
/** @param {any} v */
export const queueItem = v => ({ id: v.id, fact: v.fact, choice: v.choice, ...(v.text ? { text: v.text } : {}), ...(v.section ? { section: v.section } : {}), ...(v.q ? { q: v.q } : {}), at: v.at });

/**
 * The pure part: from the verdicts since the mark, his actionable ones, merged into the day's file (no item twice:
 * the same doc id and time is the same answer).
 * @param {any[]} verdicts @param {string} uid @param {{ items: any[] } | null} file
 */
export function mergeQueue(verdicts, uid, file) {
  const items = [...(file?.items || [])];
  const have = new Set(items.map(i => `${i.id}@${i.at}`));
  let n = 0;
  for (const v of verdicts) {
    if (v.by !== uid || !ACTION.includes(v.choice) || have.has(`${v.id}@${v.at}`)) continue;
    items.push(queueItem(v)); have.add(`${v.id}@${v.at}`); n++;
  }
  return { file: { items }, n };
}

/** @param {any} f  a flags.json row -> what the card needs (open ones only) */
export const flagCard = f => ({
  id: f.id, kind: f.kind, level: f.confidence, topic: String(f.topic || '').replace(/\.md$/, ''), line: f.line, note: f.note,
  ...(f.suggested_fix ? { fix: f.suggested_fix } : {}),
  ...(f.kind === 'conflict' ? { topicB: String(f.topic_b || '').replace(/\.md$/, ''), lineB: f.line_b } : {}),
});

/** @param {any} env */
const gh = env => {
  const headers = { Authorization: `Bearer ${env.GITHUB_TOKEN}`, Accept: 'application/vnd.github+json', 'User-Agent': 'facts-worker', 'X-GitHub-Api-Version': '2022-11-28' };
  return {
    /** @param {string} path -> { sha, json } or null */
    async read(path) {
      const r = await fetch(API + path, { headers });
      if (r.status === 404) return null;
      if (!r.ok) throw new Error(`github read ${r.status}`);
      const j = await r.json();
      const text = new TextDecoder().decode(Uint8Array.from(atob(String(j.content).replace(/\s/g, '')), c => c.charCodeAt(0)));
      return { sha: j.sha, json: JSON.parse(text) };
    },
    /** @param {string} path @param {unknown} json @param {string | undefined} sha @param {string} message -> ok, or false on a clash */
    async write(path, json, sha, message) {
      const bytes = new TextEncoder().encode(JSON.stringify(json, null, 1) + '\n');
      let bin = '';
      for (const b of bytes) bin += String.fromCharCode(b);
      const r = await fetch(API + path, { method: 'PUT', headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, content: btoa(bin), ...(sha ? { sha } : {}) }) });
      if (r.status === 409 || r.status === 422) return false;
      if (!r.ok) throw new Error(`github write ${r.status}`);
      return true;
    },
  };
};

/** the verdicts saved after `after` (serverAt, ms), oldest first, at most PAGE * PAGES */
/** @param {any} adm @param {string} base @param {number} after */
async function since(adm, base, after) {
  const out = [];
  let from = new Date(after).toISOString();
  for (let p = 0; p < PAGES; p++) {
    const r = await fetch(`${base}/v1/projects/${encodeURIComponent(adm.project)}/databases/(default)/documents/spaces/_:runQuery`, {
      method: 'POST', headers: { Authorization: `Bearer ${await adm.accessToken()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ structuredQuery: {
        from: [{ collectionId: 'verdicts' }],
        where: { fieldFilter: { field: { fieldPath: 'serverAt' }, op: 'GREATER_THAN', value: { timestampValue: from } } },
        orderBy: [{ field: { fieldPath: 'serverAt' }, direction: 'ASCENDING' }], limit: PAGE,
      } }),
    });
    if (!r.ok) throw new Error(`runQuery ${r.status}`);
    const rows = (await r.json()).filter((/** @type {any} */ x) => x.document);
    for (const { document: d } of rows) {
      const v = fromValue({ mapValue: { fields: d.fields || {} } });
      out.push({ ...v, id: d.name.split('/').pop(), serverAt: d.fields?.serverAt?.timestampValue });
    }
    if (rows.length < PAGE) break;
    from = out[out.length - 1].serverAt;
  }
  return out;
}

const json = (/** @type {unknown} */ body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });

/**
 * handleFlush(request, deps): deps = { verify(idToken), admin (claims.js admin or null), firestore (its base URL),
 * github (gh(env) or null: local, write nothing), now() }. Exported with its seams for worker/test/flush.test.mjs.
 * @param {Request} request @param {any} deps
 */
export async function handleFlush(request, { verify, admin: adm, firestore, github, flagsLocal, now = Date.now, query = since }) {
  const url = new URL(request.url);
  const flags = url.pathname === '/api/flags';
  if (request.method !== (flags ? 'GET' : 'POST')) return json({ error: flags ? 'GET.' : 'POST.' }, 405);
  const from = request.headers.get('Origin');
  if (from && from !== url.origin) return json({ error: 'Wrong origin.' }, 403);
  const idToken = (request.headers.get('Authorization') || '').match(/^Bearer\s+(\S+)$/)?.[1];
  if (!idToken) return json({ error: 'Sign in first.' }, 401);
  let token;
  try { token = await verify(idToken); } catch { return json({ error: 'Sign in again.' }, 401); }
  if (!isOwner(token)) return json({ error: 'Owner only.' }, 403);
  try {
    if (flags) {
      const rows = github ? (await github.read('flags.json'))?.json?.flags : await flagsLocal();
      return json({ flags: (rows || []).filter((/** @type {any} */ f) => f.status === 'open').map(flagCard) });
    }
    if (!adm) return json({ error: 'Not set up yet.' }, 503);
    const mark = `flush/${token.sub}`;
    const upto = Number((await adm.getDoc(mark))?.upto) || 0;
    const got = await query(adm, firestore, upto);
    if (!got.length) return json({ ok: true, n: 0 });
    const last = Math.max(upto, ...got.map((/** @type {any} */ v) => Date.parse(v.serverAt) || 0));
    let n = 0, items = /** @type {any[]} */ ([]);
    const path = `queue/${sgtDate(now())}.json`;
    if (got.some((/** @type {any} */ v) => v.by === token.sub && ACTION.includes(v.choice))) {
      for (let tries = 0; ; tries++) {
        const cur = github ? await github.read(path) : null;
        const m = mergeQueue(got, token.sub, cur?.json ?? null);
        n = m.n; items = m.file.items;
        if (!n || !github) break;
        if (await github.write(path, m.file, cur?.sha, `queue: ${n} from the app`)) break;
        if (tries >= 2) throw new Error('queue file kept changing');
      }
    }
    await adm.setDoc(mark, { upto: last });
    return json({ ok: true, n, ...(github ? {} : { items }) });
  } catch (e) {
    console.error('flush failed', /** @type {any} */ (e)?.message);
    return json({ error: 'Couldn’t reach the queue. It tries again later.' }, 502);
  }
}

export const flushRoute = {
  /** @param {URL} url */
  match: url => url.pathname === '/api/flush' || url.pathname === '/api/flags',
  /** @param {Request} request @param {any} env @param {{ url: URL, local: boolean, project: string }} ctx */
  handle(request, env, { url, local, project }) {
    const emulator = !!(local && env.EMULATOR);
    return handleFlush(request, {
      verify: (/** @type {string} */ t) => verifyIdToken(t, { project, emulator }),
      admin: project ? adminFor(env, local, project) : null,
      firestore: emulator ? `http://${env.FIRESTORE_EMULATOR}` : 'https://firestore.googleapis.com',
      github: local ? null : env.GITHUB_TOKEN ? gh(env) : null,
      flagsLocal: async () => {
        const r = await env.ASSETS.fetch(new Request(new URL('/e2e/fixtures/flags.json', url), { method: 'GET' }));
        return r.ok ? (await r.json()).flags : [];
      },
    });
  },
};
