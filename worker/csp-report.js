// POST /api/csp: the browser's CSP reports (report-uri's application/csp-report, report-to's application/reports+json).
// One short line per violation goes to the Worker log (Workers Logs, or `npx wrangler tail`): the directive, the
// blocked address and the page's path, with no query strings (they can carry what someone typed). This is how a
// Report-Only policy is read before CSP_ENFORCE (docs/decisions/0003). Pure, tested in worker/test/sites.test.mjs.
const MAX = 16_000;   // bytes in one request; a browser sends a few hundred per report
const MAX_LINES = 20;

const short = (/** @type {unknown} */ u) => String(u ?? '').replace(/[?#].*$/, '').slice(0, 200);
const pathOf = (/** @type {unknown} */ u) => { try { return new URL(String(u)).pathname; } catch { return short(u); } };

/** @param {Request} request @returns {Promise<Response>} */
export async function handleCspReport(request) {
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: { Allow: 'POST' } });
  const text = await request.text();
  if (text.length > MAX) return new Response('Too large', { status: 413 });
  let data;
  try { data = JSON.parse(text); } catch { return new Response('Not JSON', { status: 400 }); }
  /** @type {{ directive: unknown, blocked: unknown, page: unknown }[]} */
  const seen = [];
  if (data && typeof data === 'object' && !Array.isArray(data) && data['csp-report']) {
    const r = data['csp-report'];
    seen.push({ directive: r['effective-directive'] || r['violated-directive'], blocked: r['blocked-uri'], page: r['document-uri'] });
  } else if (Array.isArray(data)) {
    for (const r of data) if (r?.type === 'csp-violation' && r.body) seen.push({ directive: r.body.effectiveDirective, blocked: r.body.blockedURL, page: r.body.documentURL });
  }
  for (const v of seen.slice(0, MAX_LINES)) console.log(`csp-report ${short(v.directive)} ${short(v.blocked)} on ${pathOf(v.page)}`);
  return new Response(null, { status: 204 });
}
