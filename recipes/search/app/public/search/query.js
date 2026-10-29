// The search box's text -> terms (pure, no dependencies). Ported from a working logbook parser.
//   field:value   one field, or an app-defined filter (is:, has:, after:); the app names them
//   "a phrase"    an exact phrase       -word / -field:value   leave out
//   a OR b, a | b either (a group); a space or AND means both
// A near miss of a field name ("tga:16") is searched as plain text and reported, so the box can say "did you mean tag:?".

/** @typedef {{ field: string | null, text: string, phrase: boolean, neg: boolean }} Term */
/** @typedef {{ groups: Term[][], unknown: { op: string, suggest: string }[] }} Parsed */

/** Edit distance of a and b, giving up past max (then max + 1).
 * @param {string} a @param {string} b @param {number} max */
export function editDistance(a, b, max) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      best = Math.min(best, cur[j]);
    }
    if (best > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}

/** All groups must match; within a group any term may (OR). The text is lower-cased.
 * @param {string} q @param {{ fields?: string[] }} [opts]  fields: the names that may come before a colon
 * @returns {Parsed} */
export function parseQuery(q, { fields = [] } = {}) {
  /** @type {({ or: true } | Term)[]} */
  const tokens = [];
  /** @type {Parsed['unknown']} */
  const unknown = [];
  const re = /(-?)(?:([A-Za-z]+):)?(?:"([^"]*)"?|(\S+))/g;
  const src = String(q || '');
  let m;
  while ((m = re.exec(src))) {
    if (!m[0]) { re.lastIndex++; continue; }
    let [, neg, field, phrase, word] = m;
    // a lone "-", or "-" before nothing useful, is just a character
    if (neg && !field && phrase == null && !/^[\p{L}\p{N}]/u.test(word || '')) { word = '-' + (word || ''); neg = ''; }
    if (!neg && !field && phrase == null && (word === 'OR' || word === '|')) { tokens.push({ or: true }); continue; }
    if (!neg && !field && phrase == null && (word === 'AND' || word === '&')) continue;   // a space does the same
    /** @type {string | null} */
    // a field as the app names it (ownerName), whatever the case typed
    let f = field ? fields.find(x => x.toLowerCase() === field.toLowerCase()) ?? field.toLowerCase() : null;
    if (f && !fields.includes(f)) {
      // not a field: the whole thing is text ("GA:ETT"); a near miss of one is reported
      const name = f;
      const near = fields.find(x => name.length >= 3 && editDistance(name, x.toLowerCase(), 2) <= 2);
      if (near) unknown.push({ op: field + ':', suggest: near + ':' });
      word = field + ':' + (phrase != null ? phrase : word || ''); phrase = /** @type {any} */ (undefined); f = null;
    }
    const text = (phrase != null ? phrase : word || '').trim().toLowerCase();
    if (!text) continue;
    tokens.push({ field: f, text, phrase: phrase != null, neg: !!neg });
  }
  // a | b | c is one group; OR at either end is ignored
  /** @type {Term[][]} */
  const groups = [];
  let joinNext = false;
  for (const t of tokens) {
    if ('or' in t) { joinNext = groups.length > 0; continue; }
    if (joinNext) groups[groups.length - 1].push(t); else groups.push([t]);
    joinNext = false;
  }
  return { groups, unknown };
}

/** The box's text with an operator added at the cursor (a space either side as needed), and where the cursor goes next.
 * @param {string} text @param {number | null | undefined} caret @param {string} insert @param {number} at  cursor offset inside insert
 * @returns {{ text: string, caret: number }} */
export function insertOperator(text, caret, insert, at) {
  text = String(text || '');
  const c = Math.max(0, Math.min(text.length, caret ?? text.length));
  const before = text.slice(0, c), after = text.slice(c);
  const pre = before && !/\s$/.test(before) ? ' ' : '';
  const post = after && !/^\s/.test(after) ? ' ' : '';
  return { text: before + pre + insert + post + after, caret: before.length + pre.length + at };
}

/** Whether the query uses any operator (for a "?" note); cheap.
 * @param {string} q @param {string[]} [fields] */
export function usesOperators(q, fields = []) {
  const names = fields.map(f => f.replace(/[^A-Za-z]/g, '')).filter(Boolean).join('|');
  const field = names ? `|(${names}):` : '';
  return new RegExp(`(^|\\s)(-\\S|"${field})|\\s(OR|AND|\\||&)\\s`, 'i').test(String(q || ''));
}
