import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lineDirection, numberOf, parseDescription, parseInline, todoCount, todoRuns } from '../lib/card-description.mjs';

// A Card's description is its Engine task's Markdown body, read drawn as the approved Card draws it (spec #831, #835;
// design-reference-card: deParse, deIn, deRuns): a block per line, to-do items ticked or not with the count of each run
// of them, and nothing that could make the reader's browser reach another server.
const brief = [
  '# December ads',
  'Write three ads for the **new course**.',
  '',
  '- [x] Read last month\'s numbers',
  '- [ ] Draft the copy',
  '  - [X] Check the price',
  '- [ ] Send for review',
  '',
  '1. Meta',
  '2. Google',
  '',
  '> Keep it short.',
  '',
  '```',
  '<script>alert(1)</script>',
  '```',
  '---',
  '| Channel | Budget |',
  '| --- | --- |',
  '| Meta | 4000 |',
  '![The old banner](https://tracker.example/pixel.png)',
].join('\n');

test('a description reads as the prototype\'s blocks, with its to-do items ticked or not and counted', () => {
  const blocks = parseDescription(brief);
  assert.deepEqual(blocks.map(block => block.t), ['h1', 'p', 'todo', 'todo', 'todo', 'todo', 'ol', 'ol', 'quote', 'code', 'hr', 'table', 'img']);
  assert.deepEqual(blocks.filter(block => block.t === 'todo').map(block => [block.x, block.c, block.l]),
    [['Read last month\'s numbers', true, 0], ['Draft the copy', false, 0], ['Check the price', true, 1], ['Send for review', false, 0]]);
  assert.deepEqual(todoCount(brief), { done: 2, total: 4 });
  // One run of to-dos, nested ones in it, counted above its first line.
  assert.deepEqual([...todoRuns(blocks)], [[2, { done: 2, total: 4 }]]);
  assert.deepEqual([numberOf(blocks, 6), numberOf(blocks, 7)], [1, 2]);
  // Code stays its own text, never markup; a table keeps its rows.
  assert.equal(blocks[9].x, '<script>alert(1)</script>');
  assert.deepEqual(blocks[11].rows, [['Channel', 'Budget'], ['Meta', '4000']]);
  assert.deepEqual(todoCount(''), { done: 0, total: 0 });
});

test('inline Markdown: bold, struck, italic, code, a break and links that lead only to a web page or an email', () => {
  assert.deepEqual(parseInline('Read **the [brief](https://example.com/b)** and `price`'), [
    { t: 'text', v: 'Read ' }, { t: 'b', in: [{ t: 'text', v: 'the ' }, { t: 'a', href: 'https://example.com/b', in: [{ t: 'text', v: 'brief' }] }] },
    { t: 'text', v: ' and ' }, { t: 'code', v: 'price' }]);
  assert.deepEqual(parseInline('[x](javascript:alert(1))').find(part => part.t === 'a')?.href, null);
  assert.deepEqual(parseInline('~~old~~ *new*<br>next'), [{ t: 's', in: [{ t: 'text', v: 'old' }] }, { t: 'text', v: ' ' }, { t: 'i', in: [{ t: 'text', v: 'new' }] }, { t: 'br' }, { t: 'text', v: 'next' }]);
  assert.deepEqual(parseInline('\\*not italic\\*'), [{ t: 'text', v: '*' }, { t: 'text', v: 'not italic' }, { t: 'text', v: '*' }]);
  assert.deepEqual(parseInline('[mail](mailto:team@example.com)')[0], { t: 'a', href: 'mailto:team@example.com', in: [{ t: 'text', v: 'mail' }] });
});

test('a line\'s direction is its main language, by words', () => {
  assert.equal(lineDirection('SEO كتب مقال عن الكورس'), 'rtl');
  assert.equal(lineDirection('Write the copy for الكورس'), 'ltr');
  assert.equal(lineDirection('`code` 123'), '');
});
