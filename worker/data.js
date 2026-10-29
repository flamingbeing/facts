// The app's data: /data/index.json and /data/<area>.json, the facts and questions from the public anaesfacts repo
// (its app/ folder, built there by tools/build-index.mjs). Served from this address so the page's CSP and the
// service worker treat them as its own files. Live: from GitHub's raw files at main, kept at the edge for 5 minutes
// (a merged change reaches the app within minutes); local (the tests): the made-up set in e2e/fixtures/data/.
// Only this app has this data, so the route lives here, not in the starter.
export const UPSTREAM = 'https://raw.githubusercontent.com/flamingbeing/anaesfacts/main/app/';
const NAME = /^\/data\/([a-z][a-z0-9-]{0,40})\.json$/;

/** @param {URL} url */
export const dataName = url => NAME.exec(url.pathname)?.[1] ?? null;

export const dataRoute = {
  /** @param {URL} url */
  match: url => url.pathname.startsWith('/data/'),
  /** @param {Request} request @param {any} env @param {{ url: URL, local: boolean }} ctx */
  async handle(request, env, { url, local }) {
    const name = dataName(url);
    if (!name || !['GET', 'HEAD'].includes(request.method)) return new Response('Not found', { status: 404 });
    const res = local
      ? await env.ASSETS.fetch(new Request(new URL(`/e2e/fixtures/data/${name}.json`, url), { method: 'GET' }))
      : await fetch(UPSTREAM + name + '.json', /** @type {any} */ ({ cf: { cacheTtl: 300, cacheEverything: true } }));
    if (!res.ok) return new Response('Not found', { status: res.status === 404 ? 404 : 502 });
    return new Response(request.method === 'HEAD' ? null : res.body, {
      headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-cache' },
    });
  },
};
