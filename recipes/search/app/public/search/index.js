// @core/search (incubating here; it moves into app-sync once a second kind of app uses it): full-text search over the
// records an app holds, with operators. Named exports only and nothing runs on import, so a build keeps only what a
// page uses.
//   createSearch(options)  the index: feed, update, remove, search, prepare (search.js)
//   loadSearch()           loads MiniSearch ahead (it otherwise loads on first need)
//   parseQuery             the box's text -> terms, on its own (query.js, pure)
//   insertOperator, usesOperators   for a "?" operator list: add one at the cursor; whether a query uses any
export { createSearch, loadSearch } from './search.js';
export { parseQuery, editDistance, insertOperator, usesOperators } from './query.js';
