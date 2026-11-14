import { test } from 'node:test';
import assert from 'node:assert/strict';
import { boardColumns, columnOf, keyboardTarget, blockReason, cardAgent } from '../lib/board-columns.mjs';

test('the six columns keep the approved order, Waiting on you first', () => {
 assert.deepEqual(boardColumns, ['waiting', 'ideas', 'planned', 'progress', 'live', 'done']);
});

test('a card shows in its stage column', () => {
 const stages = [{ id: 1, board_column: 'ideas' }, { id: 5, board_column: 'waiting' }, { id: 6, board_column: 'planned' }];
 assert.equal(columnOf({ stage_id: 5 }, stages), 'waiting');
 assert.equal(columnOf({ stage_id: 6 }, stages), 'planned');
});

test('Shift with an arrow moves to the next column in the reading direction', () => {
 assert.equal(keyboardTarget('ideas', 'ArrowLeft', true), 'planned');
 assert.equal(keyboardTarget('ideas', 'ArrowRight', true), 'waiting');
 assert.equal(keyboardTarget('ideas', 'ArrowRight', false), 'planned');
 assert.equal(keyboardTarget('done', 'ArrowLeft', true), null);
 assert.equal(keyboardTarget('ideas', 'ArrowUp', true), null);
});

test('Waiting on you is left by deciding and fills by itself', () => {
 assert.equal(blockReason('waiting', 'ideas'), 'decide');
 assert.equal(blockReason('ideas', 'waiting'), 'waiting');
 assert.equal(blockReason('ideas', 'ideas'), 'same');
 assert.equal(blockReason('ideas', 'planned'), '');
});

test('a card belongs to its first assigned Agent, else to its next actor when that is an Agent', () => {
 const agents = new Set(['writer', 'lead']);
 assert.equal(cardAgent({ id: 1, next_actor: 'lead' }, [{ card_id: 1, person_id: 'person' }, { card_id: 1, person_id: 'writer' }], agents), 'writer');
 assert.equal(cardAgent({ id: 2, next_actor: 'lead' }, [], agents), 'lead');
 assert.equal(cardAgent({ id: 3, next_actor: 'person' }, [{ card_id: 3, person_id: 'person' }], agents), null);
});
