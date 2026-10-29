import test from 'node:test';
import assert from 'node:assert/strict';
import { grade, retrievability, testDeck, topicScores, RELEARN } from '../src/schedule.js';

const DAY = 864e5, T0 = Date.UTC(2026, 9, 29);

test('first answer: right is due in days, wrong comes back after the relearning step', () => {
  const right = grade(null, true, T0), wrong = grade(null, false, T0);
  assert.ok(right.due - T0 >= DAY && right.s > 1);
  assert.equal(wrong.due - T0, RELEARN);
  assert.ok(wrong.s < right.s && wrong.d > right.d);
  assert.deepEqual([right.reps, right.lapses, right.ok, wrong.reps, wrong.lapses, wrong.ok], [1, 0, true, 1, 1, false]);
});

test('right at the due time grows the interval, again and again', () => {
  let st = grade(null, true, T0), last = st.due - T0;
  for (let i = 0; i < 4; i++) {
    st = grade(st, true, st.due);
    const gap = st.due - st.last;
    assert.ok(gap > last, `interval ${gap} grows past ${last}`);
    last = gap;
  }
  assert.equal(st.reps, 5);
});

test('a later hit grows it more than an early one; an early hit never shortens it', () => {
  const st = grade(null, true, T0);
  const early = grade(st, true, T0 + DAY), onTime = grade(st, true, st.due), late = grade(st, true, st.due + 10 * DAY);
  assert.ok(early.s >= st.s);
  assert.ok(late.s > onTime.s && onTime.s > early.s);
});

test('wrong resets the due to the relearning step and lowers stability and raises difficulty', () => {
  let st = grade(null, true, T0);
  for (let i = 0; i < 3; i++) st = grade(st, true, st.due);
  const miss = grade(st, false, st.due);
  assert.equal(miss.due - st.due, RELEARN);
  assert.ok(miss.s < st.s, `stability ${miss.s} < ${st.s}`);
  assert.ok(miss.d > st.d);
  assert.equal(miss.lapses, 1);
  assert.ok(retrievability(st, st.last) === 1 && Math.abs(retrievability(st, st.last + st.s * DAY) - 0.9) < 0.001, 'stability is the days to 90%');
  // right after the miss, the interval starts small again
  assert.ok(grade(miss, true, miss.due).due - miss.due < st.due - st.last);
});

test('difficulty and stability stay in range', () => {
  let st = grade(null, false, T0);
  for (let i = 0; i < 40; i++) st = grade(st, false, st.due);
  assert.ok(st.d <= 10 && st.s >= 0.1);
  for (let i = 0; i < 40; i++) st = grade(st, true, st.due);
  assert.ok(st.d >= 1 && st.s <= 365);
});

const F = (id, topic, extra = {}) => ({ id, area: topic.split('/')[0], topic, title: topic, text: `line ${id}`, qs: [{}], ...extra });
const LIST = [F('a', 'drugs/x'), F('b', 'drugs/x'), F('c', 'airway/y'), F('d', 'airway/y', { qs: [] }), F('e', 'drugs/z')];
const st = (due, last, ok = true) => ({ s: 1, d: 5, due, last, reps: 1, lapses: 0, ok });

test('deck: due first (most overdue first), then never answered, then the rest soonest due first; no question, no card', () => {
  const states = new Map([['a', st(T0 + 5 * DAY, T0)], ['b', st(T0 - 2 * DAY, T0 - 5 * DAY)], ['e', st(T0 - 1 * DAY, T0 - 4 * DAY)]]);
  assert.deepEqual(testDeck(LIST, states, T0).map(f => f.id), ['b', 'e', 'c', 'a']);
  // a miss (due in minutes) comes before a long interval
  states.set('c', st(T0 + RELEARN, T0, false));
  assert.deepEqual(testDeck(LIST, states, T0).map(f => f.id), ['b', 'e', 'c', 'a']);
  assert.deepEqual(testDeck(LIST, new Map([['a', st(T0 + 9 * DAY, T0)], ['c', st(T0 + RELEARN, T0, false)]]), T0).map(f => f.id), ['b', 'e', 'c', 'a']);
});

test('deck: filters, search and skipped lines', () => {
  const none = new Map();
  assert.deepEqual(testDeck(LIST, none, T0, { area: 'airway' }).map(f => f.id), ['c']);
  assert.deepEqual(testDeck(LIST, none, T0, { topic: 'drugs/x' }).map(f => f.id), ['a', 'b']);
  assert.deepEqual(testDeck(LIST, none, T0, { search: 'DRUGS/Z' }).map(f => f.id), ['e']);
  assert.deepEqual(testDeck(LIST, none, T0, {}, new Set(['a', 'e'])).map(f => f.id), ['b', 'c']);
});

test('topic scores: lines whose last answer was right, of those answered', () => {
  const states = new Map([['a', st(T0, T0, true)], ['b', st(T0, T0, false)], ['c', st(T0, T0, true)]]);
  assert.deepEqual(topicScores(LIST, states), [{ topic: 'drugs/x', title: 'drugs/x', right: 1, answered: 2 }, { topic: 'airway/y', title: 'airway/y', right: 1, answered: 1 }]);
  assert.deepEqual(topicScores(LIST, states, { area: 'airway' }).map(r => r.topic), ['airway/y']);
  assert.deepEqual(topicScores(LIST, new Map()), []);
});
