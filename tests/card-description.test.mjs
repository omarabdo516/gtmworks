import { test } from 'node:test';
import assert from 'node:assert/strict';
import { companyImage, parseDescription, safeHref, todoItems, todoProgress } from '../lib/card-description.mjs';

// #679: the to-do items are read as the database's card_todos reads them (supabase/tests/card_description.sql), so a tick
// names the item the reader saw.
const brief = '# Brief\n\n- [ ] Write the hook\n- [x] Pick the format\n  - [ ] Nested step\n\n```\n- [ ] not an item\n```\n\n1. [ ] Numbered item\n> - [ ] Quoted item';

test('the to-do items are read in order with their lines, nested, numbered and quoted ones too, and none inside code', () => {
 assert.deepEqual(todoItems(brief), [
  { line: 3, item: 'Write the hook', done: false },
  { line: 4, item: 'Pick the format', done: true },
  { line: 5, item: 'Nested step', done: false },
  { line: 11, item: 'Numbered item', done: false },
  { line: 12, item: 'Quoted item', done: false },
 ]);
});

test('a fence closes only on a fence of its own character, as long, with nothing after it', () => {
 assert.equal(todoItems('~~~~\n- [ ] in\n~~~\n- [ ] still in\n~~~~\n- [ ] out').length, 1);
 assert.equal(todoItems('```js\n- [ ] in\n``` not closed\n- [ ] still in\n```\n- [ ] out').length, 1);
 assert.equal(todoItems('```\n- [ ] in\n~~~\n- [ ] still in').length, 0);
});

test('a box not written as Markdown writes one is no item, and an empty description has none', () => {
 assert.deepEqual(todoItems('- [] nope\n-[ ] nope\n- [ ]tight'), []);
 assert.deepEqual(todoItems(''), []);
 assert.deepEqual(todoItems(null), []);
});

test('"2/5" counts the ticked items of all of them, X ticked too', () => {
 assert.deepEqual(todoProgress('- [x] a\n- [X] b\n- [ ] c\n- [ ] d\n- [ ] e'), { done: 2, total: 5 });
 assert.deepEqual(todoProgress('No list here'), { done: 0, total: 0 });
});

test('the drawn tree finds the same items the count reads, on the same lines', () => {
 const lines = [];
 const walk = (node) => { if (node.type === 'listItem' && typeof node.checked === 'boolean') lines.push(node.position.start.line); (node.children || []).forEach(walk); };
 walk(parseDescription(brief));
 assert.deepEqual(lines, todoItems(brief).map((item) => item.line));
});

test('raw HTML stays its own text in the tree, never an element', () => {
 const tree = parseDescription('Hello <script>alert(1)</script>\n\n<img src=x onerror=alert(1)>');
 const html = [];
 const walk = (node) => { if (node.type === 'html') html.push(node.value); (node.children || []).forEach(walk); };
 walk(tree);
 assert.deepEqual(html, ['<script>', '</script>', '<img src=x onerror=alert(1)>']);
});

test('a link leads to a web page, an email address or a page of this app, and nowhere else', () => {
 assert.equal(safeHref('https://example.com/a?b=1'), 'https://example.com/a?b=1');
 assert.equal(safeHref('mailto:team@example.com'), 'mailto:team@example.com');
 assert.equal(safeHref('/c/rs-learning/work/board?card=3'), '/c/rs-learning/work/board?card=3');
 for (const bad of ['javascript:alert(1)', ' JavaScript:alert(1)', 'data:text/html,x', 'file:///etc/passwd', '//evil.example', '/\\evil.example', 'vbscript:x', '', null]) assert.equal(safeHref(bad), null, String(bad));
});

test('a picture is shown only from the Company\'s own storage', () => {
 assert.equal(companyImage('/c/rs-learning/files/12', 'rs-learning'), '/c/rs-learning/files/12');
 for (const bad of ['/c/other/files/12', 'https://tracker.example/p.png', '/c/rs-learning/files/12?x=1', '/c/rs-learning/files/abc', 'data:image/png;base64,AA']) assert.equal(companyImage(bad, 'rs-learning'), null, bad);
});
