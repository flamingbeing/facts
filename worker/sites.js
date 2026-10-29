// The Cloudflare Worker for this repo's address. It serves the repo's files (the static assets, bound as ASSETS),
// decides which folder an address may see (routes.js), adds the security headers (headers.js), answers /api/claims
// (claims.js from app-devkit, roles from members.js), /api/members/ (admins set and remove roles, members.js) and
// the optional modules' routes (modules.js: each module's route, e.g. the files recipe's /api/files/), and passes
// Firebase's sign-in helper pages on to the project.
// wrangler.jsonc: "run_worker_first" sends every request here; FIREBASE_PROJECT is a var there, the service account
// (SA_EMAIL, SA_KEY) are Worker secrets.
import { resolve, publicFile } from './routes.js';
import { securityHeaders } from './headers.js';
import { handleCspReport } from './csp-report.js';
import { ROUTES } from './modules.js';
// cloud{ roles and members (a static app has neither: tools/flavour.mjs)
import { handleClaims, verifyIdToken } from './claims.js';
import { adminFor } from './admin.js';
import { loadClaims, handleMembers } from './members.js';
// }cloud

const NOINDEX = 'noindex, nofollow';
const LOCAL = /^(localhost|127\.0\.0\.1|\[::1\])$/;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const local = LOCAL.test(url.hostname);
    const project = env.FIREBASE_PROJECT || '';
    const finish = res => withHeaders(res, { project, local });

    // cloud{
    if (url.pathname === '/api/claims') return finish(await claims(request, env, url, local, project));
    // }cloud
    if (url.pathname === '/api/csp') return finish(await handleCspReport(request));
    // the modules' routes (worker/modules.js), each asked in turn
    for (const route of ROUTES) if (route.match(url)) return finish(await route.handle(request, env, { url, local, project }));
    // cloud{
    if (url.pathname.startsWith('/api/members/')) return finish(await members(request, env, url, local, project));
    // }cloud
    if (request.method !== 'GET' && request.method !== 'HEAD') return finish(new Response('Method not allowed', { status: 405, headers: { Allow: 'GET, HEAD' } }));
    // cloud{ Firebase's sign-in helper pages, from the project's own Firebase address, so sign-in never leaves this one
    if (/^\/__\/(auth|firebase)\//.test(url.pathname) && project && !local) {
      const res = await fetch(new Request(`https://${project}.firebaseapp.com${url.pathname}${url.search}`, request));
      return withHeaders(new Response(res.body, res), { project, local, framedBySelf: true, helper: true });
    }
    // }cloud
    const r = resolve(url.hostname, url.pathname);
    if (r.redirect) return finish(redirect(url, r.redirect));
    if (r.notFound) return finish(notFound());

    // a folder (address ending in "/") serves its index.html
    let file = r.file;
    if (file === '' || file.endsWith('/')) file += 'index.html';
    let res = await asset(env, url, file);
    if (res.status === 404 && publicFile(file)) {
      const pub = await asset(env, url, publicFile(file));
      if (pub.status !== 404) { res = pub; file = publicFile(file); }
    }
    if (res.status === 404 && !/\.[^/]+$/.test(file)) {
      // no such file, but a folder of that name: send the browser to the address with a "/" (as GitHub Pages does)
      let dir = await asset(env, url, file + '/index.html');
      if (dir.status === 404 && publicFile(file + '/index.html')) dir = await asset(env, url, /** @type {string} */ (publicFile(file + '/index.html')));
      // one leading "/" only: "//search/" would send the browser to the host "search"
      if (dir.status === 200) return finish(redirect(url, url.pathname.replace(/^\/+/, '/') + '/'));
    }
    if (res.status === 404) return finish(notFound());
    res = new Response(res.body, res);
    // service workers must always be checked fresh, or phones keep an old app for a day
    if (/(^|\/)sw\.js$/.test(file)) res.headers.set('Cache-Control', 'no-cache');
    return finish(res);
  },
};

// cloud{
function claims(request, env, url, local, project) {
  const adm = adminFor(env, local, project);
  return settledClaims(a => handleClaims(request, { admin: a, loadClaims, origin: url.origin, limit: env.CLAIMS_LIMIT, emulator: !!(local && env.EMULATOR) }), adm);
}

// Two asks for one person at once (a page's first, sent before its role doc exists, and the one the new doc sets off)
// each read the doc, then write the claims, so the older read could be written last: the account loses its role and
// the page, already answered, never asks again. An answer is final only when the docs it read are unchanged after its
// write; otherwise it is asked again (at most twice more, so a doc changing all the time can't hold the request).
/** @param {(adm: any) => Promise<Response>} ask @param {any} adm @returns {Promise<Response>} */
export async function settledClaims(ask, adm, tries = 3) {
  for (let i = 1; ; i++) {
    /** @type {Map<string, string>} */
    const seen = new Map();
    const watched = adm && { ...adm, getDoc: async (/** @type {string} */ p) => { const d = await adm.getDoc(p); seen.set(p, JSON.stringify(d)); return d; } };
    const res = await ask(watched);
    if (!res.ok || i >= tries) return res;
    let same = true;
    for (const [p, j] of seen) if (JSON.stringify(await adm.getDoc(p)) !== j) same = false;
    if (same) return res;
  }
}

// }cloud

// cloud{
// Role changes and removals, as the service account; the same ID token check as /api/claims.
function members(request, env, url, local, project) {
  const emulator = !!(local && env.EMULATOR);
  const verify = project ? (/** @type {string} */ idToken) => verifyIdToken(idToken, { project, emulator }) : null;
  return handleMembers(request, { admin: project ? adminFor(env, local, project) : null, verify, origin: url.origin });
}
// }cloud

function withHeaders(res, opts) {
  const out = new Response(res.body, res);
  for (const [k, v] of securityHeaders(opts)) out.headers.set(k, v);
  out.headers.set('X-Robots-Tag', NOINDEX);
  return out;
}

const asset = (env, url, file) => env.ASSETS.fetch(new Request(new URL('/' + file, url), { method: 'GET' }));
const redirect = (url, path) => Response.redirect(new URL(path + url.search, url).toString(), 301);
const notFound = () => new Response('Not found', { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
