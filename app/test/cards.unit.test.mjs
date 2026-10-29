import test from 'node:test';
import assert from 'node:assert/strict';
import { cardsFrom, queue, questionFor, docId, plain, topicsOf, flagDeck } from '../src/cards.js';

const FILES = [
  { area: 'drugs', topics: [
    { k: 'demo-drug', t: 'Demo drug', f: [['aaa111', 'Dosage', 'Dose **2 mg/kg**'], ['bbb222', 'Notes', 'No question here']],
      q: [['aaa111', 'statement', 'What is the dose?', '2 mg/kg'], ['aaa111', 'mcq', 'Dose?', 1, ['1 mg/kg', '2 mg/kg']],
        ['aaa111', 'mcq', 'Broken', 5, ['x']], ['zzz999', 'mcq', 'Orphan', 0, ['a']]] },
  ] },
  { area: 'airway', topics: [{ k: 'tubes', t: 'Tubes', f: [['ccc333', 'Sizes', 'Size 7 for most women']], q: [['ccc333', 'blank', '____ for most women', 'Size 7']] }] },
];

test('facts: ids, titles and questions (bad MCQs and orphans dropped)', () => {
  const facts = cardsFrom(FILES);
  assert.deepEqual(facts.map(f => f.id), ['drugs/demo-drug#aaa111', 'drugs/demo-drug#bbb222', 'airway/tubes#ccc333']);
  assert.equal(facts[0].qs.length, 2);
  assert.equal(facts[1].qs.length, 0);
  assert.equal(facts[0].title, 'Demo drug');
});

test('queue: unseen with a question, unseen without, then seen oldest first; filters narrow it', () => {
  const facts = cardsFrom(FILES);
  assert.deepEqual(queue(facts, new Map()).map(f => f.id), ['drugs/demo-drug#aaa111', 'airway/tubes#ccc333', 'drugs/demo-drug#bbb222']);
  const seen = new Map([['drugs/demo-drug#aaa111', 20], ['airway/tubes#ccc333', 10]]);
  assert.deepEqual(queue(facts, seen).map(f => f.id), ['drugs/demo-drug#bbb222', 'airway/tubes#ccc333', 'drugs/demo-drug#aaa111']);
  assert.deepEqual(queue(facts, seen, { area: 'airway' }).map(f => f.id), ['airway/tubes#ccc333']);
  assert.deepEqual(queue(facts, seen, { topic: 'drugs/demo-drug' }).map(f => f.id), ['drugs/demo-drug#bbb222', 'drugs/demo-drug#aaa111']);
  assert.deepEqual(queue(facts, seen, { search: 'DEMO dose' }).map(f => f.id), ['drugs/demo-drug#aaa111']);
});

test('questionFor: MCQ first, then the others in turn; none for a bare fact', () => {
  const [a, b] = cardsFrom(FILES);
  assert.equal(questionFor(a)?.kind, 'mcq');
  assert.equal(questionFor(a, 1)?.kind, 'statement');
  assert.equal(questionFor(a, 2)?.kind, 'mcq');
  assert.equal(questionFor(b), null);
});

test('docId; plain text; topics', () => {
  assert.equal(docId('u1', 'drugs/demo-drug#aaa111'), 'u1~drugs~demo-drug~aaa111');
  assert.equal(docId('u1', 'airway/ett/lma#a#b'), 'u1~airway~ett~lma~a~b');
  assert.equal(plain('Dose **2 mg/kg** in `adults`'), 'Dose 2 mg/kg in adults');
  assert.equal(plain('Onset in ____ (_fast_)'), 'Onset in ____ (fast)');
  assert.equal(plain('snake_case_name and *one*'), 'snake_case_name and one');
  assert.deepEqual(topicsOf(cardsFrom(FILES)).map(t => t.topic), ['drugs/demo-drug', 'airway/tubes']);
});

test('flagDeck: open flags first by level (high, cross-topic, medium, low); answered ones go, swiped-on ones last', () => {
  const facts = cardsFrom(FILES);
  const F = (id, level, kind = 'batch', topic = 'drugs/demo-drug') => ({ id, kind, level, topic, line: `line ${id}`, note: 'n' });
  const flags = [F('L', 'low'), F('M', 'med'), F('C', 'med', 'conflict'), F('H', 'high', 'batch', 'airway/tubes'), F('D', 'high'), F('S', 'high')];
  const said = new Map([['flag:D', 'keep'], ['flag:S', 'seen']]);
  const deck = flagDeck(flags, facts, said);
  assert.deepEqual(deck.map(c => c.id), ['flag:H', 'flag:C', 'flag:M', 'flag:L', 'flag:S']);
  assert.equal(deck[1].title, facts.find(f => f.topic === 'drugs/demo-drug')?.title);
  assert.deepEqual(flagDeck(flags, facts, said, { area: 'airway' }).map(c => c.id), ['flag:H']);
  assert.deepEqual(flagDeck(flags, facts, said, { search: 'tubes' }).map(c => c.id), ['flag:H']);
});
