// The Log tab's "Merge now": the owner runs the notes' queue processor when he wants, with the model he picks, instead
// of waiting for a timer. The processor is a GitHub Actions workflow in the private notes repo
// (.github/workflows/process.yml): it does what that repo's processor.md says, once, and stops at once on an empty queue.
//
//   POST /api/process { model: 'sonnet' | 'opus' }  starts it (workflow_dispatch on main), unless a run is already going
//                     -> { ok, started } (started false: one was already queued or running; it takes the new items too)
//   GET  /api/process  the latest run and its result -> { run: { id, status, conclusion, url, at } | null, last }
//                     last = process/last.json from that repo (written by the run: pr, done, held, left, cost_usd, run_id)
//                     or null. A finished run whose id isn't last.run_id found nothing to do.
//
// Same door as /api/flush (flush.js ownerGate: his verified email only) and the same GitHub token (GITHUB_TOKEN; it
// needs Actions write on that repo). Local (the tests): nothing is started; GET says no run yet.
import { verifyIdToken } from './claims.js';
import { REPO, ghHeaders, ownerGate } from './flush.js';
import { json } from './file.js';

export const WORKFLOW = 'process.yml';
const MODELS = ['sonnet', 'opus'];

/** @param {any} env -> the two GitHub calls this needs */
export const actions = env => {
  const headers = ghHeaders(env), base = `https://api.github.com/repos/${REPO}`;
  return {
    /** -> the latest run of the workflow, or null */
    async latest() {
      const r = await fetch(`${base}/actions/workflows/${WORKFLOW}/runs?per_page=1`, { headers });
      if (!r.ok) throw new Error(`github runs ${r.status}`);
      const run = (await r.json()).workflow_runs?.[0];
      return run ? { id: run.id, status: run.status, conclusion: run.conclusion, url: run.html_url, at: Date.parse(run.created_at) } : null;
    },
    /** @param {string} model */
    async start(model) {
      const r = await fetch(`${base}/actions/workflows/${WORKFLOW}/dispatches`, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ref: 'main', inputs: { model } }) });
      if (!r.ok) throw new Error(`github dispatch ${r.status}`);
    },
    /** -> process/last.json, or null */
    async last() {
      const r = await fetch(`${base}/contents/process/last.json`, { headers: { ...headers, Accept: 'application/vnd.github.raw+json' } });
      if (r.status === 404) return null;
      if (!r.ok) throw new Error(`github read ${r.status}`);
      return r.json();
    },
  };
};

/** @param {Request} request @param {{ verify: (t: string) => Promise<any>, github: ReturnType<typeof actions> | null }} deps */
export async function handleProcess(request, { verify, github }) {
  const g = await ownerGate(request, verify, ['GET', 'POST']);
  if (g.fail) return g.fail;
  let model = 'sonnet';
  if (request.method === 'POST') {
    const body = await request.json().catch(() => ({}));
    if (body?.model != null && !MODELS.includes(body.model)) return json({ error: 'Model: sonnet or opus.' }, 400);
    model = body?.model || 'sonnet';
  }
  if (!github) return json(request.method === 'POST' ? { ok: true, started: false, local: true } : { run: null, last: null });
  try {
    const run = await github.latest();
    if (request.method === 'GET') return json({ run, last: run ? await github.last() : null });
    if (run && run.status !== 'completed') return json({ ok: true, started: false });
    await github.start(model);
    return json({ ok: true, started: true });
  } catch (e) {
    console.error('process failed', /** @type {any} */ (e)?.message);
    return json({ error: 'Couldn’t reach GitHub. Try again.' }, 502);
  }
}

export const processRoute = {
  /** @param {URL} url */
  match: url => url.pathname === '/api/process',
  /** @param {Request} request @param {any} env @param {{ url: URL, local: boolean, project: string }} ctx */
  handle(request, env, { local, project }) {
    const emulator = !!(local && env.EMULATOR);
    return handleProcess(request, {
      verify: (/** @type {string} */ t) => verifyIdToken(t, { project, emulator }),
      github: local || !env.GITHUB_TOKEN ? null : actions(env),
    });
  },
};
