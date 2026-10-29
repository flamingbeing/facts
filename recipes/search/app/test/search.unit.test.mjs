// @core/search: the query parser (ported from a working logbook parser) and the index's ranking and filters.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseQuery, createSearch, loadSearch, insertOperator, usesOperators } from '../public/search/index.js';

await loadSearch();   // MiniSearch loads on first need in the page (search-lazy.unit.test.mjs); these tests rank with it

const FIELDS = ['title', 'case', 'tag', 'has'];
const P = q => parseQuery(q, { fields: FIELDS }).groups.map(g => g.map(t => `${t.neg ? '-' : ''}${t.field ? t.field + ':' : ''}${t.phrase ? `"${t.text}"` : t.text}`).join('|')).join(' ');

test('parseQuery: words, fields, phrases, leave-outs, OR', () => {
  assert.equal(P('lap chole'), 'lap chole');
  assert.equal(P('title:AB tag:16 case:hernia'), 'title:ab tag:16 case:hernia');
  assert.equal(P('"lap chole" -paeds'), '"lap chole" -paeds');
  assert.equal(P('spinal OR epidural GA'), 'spinal|epidural ga');
  assert.equal(P('a | b | c'), 'a|b|c');
  assert.equal(P('spinal AND ga & x'), 'spinal ga x');
  assert.equal(P('salt and pepper'), 'salt and pepper');
  assert.equal(P('OR a or b'), 'a or b');
  assert.equal(P('-tag:13 -"day surgery"'), '-tag:13 -"day surgery"');
  assert.equal(P('GA:ETT'), 'ga:ett');
  assert.equal(P('- -- x-ray'), '- -- x-ray');
  assert.equal(P('"open phrase'), '"open phrase"');
});

test('parseQuery: a misspelt field is text and is reported', () => {
  assert.deepEqual(parseQuery('titel:AB tga:16', { fields: FIELDS }).unknown, [{ op: 'titel:', suggest: 'title:' }, { op: 'tga:', suggest: 'tag:' }]);
  assert.deepEqual(parseQuery('GA:ETT', { fields: FIELDS }).unknown, []);
  assert.equal(P('tga:16'), 'tga:16');
});

const docs = [
  { id: 'a', title: 'Spinal for caesarean', body: 'went well', n: 3, updatedAt: 1 },
  { id: 'b', title: 'Hernia repair', body: 'spinal anaesthesia, day surgery', n: 12, updatedAt: 2 },
  { id: 'c', title: 'Knee replacement', body: 'epidural and block', n: 7, updatedAt: 3 },
  { id: 'd', title: 'Paeds hernia', body: 'day surgery', n: 1, updatedAt: 4 },
];
const make = () => {
  const s = createSearch({
    fields: ['title', 'body'], boost: { title: 3 }, store: ['title'],
    operators: { is: (r, v) => v === 'big' && r.n >= 5, after: (r, v) => r.updatedAt > Number(v) },
  });
  s.feed(docs);
  return s;
};
const ids = (s, q) => s.search(q).hits.map(h => h.id);

test('search: ranking, prefix, fuzzy, boost', () => {
  const s = make();
  assert.deepEqual(ids(s, 'spinal'), ['a', 'b']);            // title hit outranks body hit
  assert.deepEqual(ids(s, 'hern').sort(), ['b', 'd']);        // prefix
  assert.deepEqual(ids(s, 'epidurel'), ['c']);                // fuzzy
  assert.deepEqual(s.search('spinal').hits[0].fields, ['title']);
  assert.equal(s.search('spinal').hits[0].title, 'Spinal for caesarean');   // stored field
});

test('search: field, phrase, leave-out, OR, filters', () => {
  const s = make();
  assert.deepEqual(ids(s, 'body:spinal'), ['b']);
  assert.deepEqual(ids(s, '"day surgery"').sort(), ['b', 'd']);
  assert.deepEqual(ids(s, '"surgery day"'), []);
  assert.deepEqual(ids(s, 'hernia -paeds'), ['b']);
  assert.deepEqual(ids(s, 'knee OR caesarean').sort(), ['a', 'c']);
  assert.deepEqual(ids(s, 'is:big').sort(), ['b', 'c']);
  assert.deepEqual(ids(s, 'spinal is:big'), ['b']);
});

test('search: a query of only filters lists newest first', () => {
  const s = make();
  assert.deepEqual(ids(s, 'after:0'), ['d', 'c', 'b', 'a']);
  assert.deepEqual(ids(s, '-hernia'), ['c', 'a']);
  assert.deepEqual(ids(s, '"day surgery"'), ['d', 'b']);
});

test('search: unknown operator is searched as text and hinted', () => {
  const s = make();
  const r = s.search('iss:big');
  assert.deepEqual(r.unknown, [{ op: 'iss:', suggest: 'is:' }]);
});

test('search: update, remove, empty query', () => {
  const s = make();
  s.update({ id: 'a', title: 'Something else', body: '', updatedAt: 9 });
  assert.deepEqual(ids(s, 'spinal'), ['b']);
  s.remove('b');
  assert.deepEqual(ids(s, 'spinal'), []);
  assert.equal(s.size, 3);
  assert.deepEqual(ids(s, '   '), []);
  s.clear();
  assert.equal(s.size, 0);
});

test('parseQuery: a camelCase field is found whatever the case typed', () => {
  const { groups, unknown } = parseQuery('ownerName:Kim ownername:lee', { fields: ['ownerName'] });
  assert.deepEqual(unknown, []);
  assert.deepEqual(groups.flat().map(t => t.field), ['ownerName', 'ownerName']);
});

test('insertOperator: spaces either side, cursor inside the operator', () => {
  assert.deepEqual(insertOperator('', 0, 'tag:', 4), { text: 'tag:', caret: 4 });
  assert.deepEqual(insertOperator('lap', 3, '""', 1), { text: 'lap ""', caret: 5 });
  assert.deepEqual(insertOperator('ab cd', 2, 'OR ', 3), { text: 'ab OR  cd', caret: 6 });
  assert.deepEqual(insertOperator('x', null, '-', 1), { text: 'x -', caret: 3 });
});

test('usesOperators: fields, phrases, leave-outs and OR', () => {
  assert.equal(usesOperators('lap chole'), false);
  assert.equal(usesOperators('"lap chole"'), true);
  assert.equal(usesOperators('a -b'), true);
  assert.equal(usesOperators('x-ray'), false);
  assert.equal(usesOperators('a OR b'), true);
  assert.equal(usesOperators('tag:13', ['tag']), true);
  assert.equal(usesOperators('tag:13'), false);
});
