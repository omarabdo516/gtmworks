import { test } from 'node:test';
import assert from 'node:assert/strict';
import { insertToken, tokenAtCaret } from '../lib/composer-mentions.mjs';

// #154, the "@" or "/" token under the composer's caret (design-reference: tokenAtCaret, pickPop). The list opens for
// the token under the caret only: at the message's start or after a space, holding what was typed after it.
test('a token is found at the start of the message and after a space, holding the letters typed after it', () => {
 assert.deepEqual(tokenAtCaret('@', 1), { type: '@', q: '', start: 0, end: 1 });
 assert.deepEqual(tokenAtCaret('@le', 3), { type: '@', q: 'le', start: 0, end: 3 });
 assert.deepEqual(tokenAtCaret('/ag', 3), { type: '/', q: 'ag', start: 0, end: 3 });
 assert.deepEqual(tokenAtCaret('hello @Le', 9), { type: '@', q: 'le', start: 6, end: 9 });
 assert.deepEqual(tokenAtCaret('hello /a', 8), { type: '/', q: 'a', start: 6, end: 8 });
 // The caret may sit inside the message: only the text before it counts.
 assert.deepEqual(tokenAtCaret('@lead more', 5), { type: '@', q: 'lead', start: 0, end: 5 });
});

test('Arabic names keep their letters, and the query folds only case', () => {
 assert.deepEqual(tokenAtCaret('مرحبا @مراجع', 12), { type: '@', q: 'مراجع', start: 6, end: 12 });
 assert.deepEqual(tokenAtCaret('@محتوى', 6), { type: '@', q: 'محتوى', start: 0, end: 6 });
 assert.deepEqual(tokenAtCaret('@LEAD', 5), { type: '@', q: 'lead', start: 0, end: 5 });
});

test('a token is not found inside a word, so an email address opens nothing, nor once a space follows', () => {
 assert.equal(tokenAtCaret('user@example', 12), null);
 assert.equal(tokenAtCaret('mail omar@example.com', 21), null);
 assert.equal(tokenAtCaret('@Lead ', 6), null);
 assert.equal(tokenAtCaret('hello world', 11), null);
 assert.equal(tokenAtCaret('', 0), null);
 assert.equal(tokenAtCaret('x/@a', 4), null);
 assert.equal(tokenAtCaret('@a/b', 4), null);
});

test('picking an entry replaces the token, one space after it, and leaves the caret after that space', () => {
 assert.deepEqual(insertToken('hello @Le', { type: '@', q: 'le', start: 6, end: 9 }, '@Lead '), { value: 'hello @Lead ', caret: 12 });
 assert.deepEqual(insertToken('@re and more', { type: '@', q: 're', start: 0, end: 3 }, '@Reach '), { value: '@Reach  and more', caret: 7 });
 assert.deepEqual(insertToken('/a', { type: '/', q: 'a', start: 0, end: 2 }, '/agent '), { value: '/agent ', caret: 7 });
 assert.deepEqual(insertToken('@مر', { type: '@', q: 'مر', start: 0, end: 3 }, '@مراجع '), { value: '@مراجع ', caret: 7 });
});
