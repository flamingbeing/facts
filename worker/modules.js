// The optional modules' Worker routes (README, "Modules"): one import and one entry per module, which
// `node tools/add.mjs <recipe>` writes after the "add:" marks and `--remove` takes out again. A route is
//   { match(url) -> boolean, handle(request, env, { url, local, project }) -> Promise<Response> }
// and sites.js asks each in turn, after its own /api/ routes; the security headers are added to its answer there.
// add: worker imports
import { dataRoute } from './data.js';
import { flushRoute } from './flush.js';

/** @type {{ match(url: URL): boolean, handle(request: Request, env: any, ctx: { url: URL, local: boolean, project: string }): Promise<Response> }[]} */
export const ROUTES = [
  dataRoute,   // the app's own: facts and questions (data.js)
  flushRoute,  // the app's own: the owner's queue and flags (flush.js)
  // add: worker routes
];
