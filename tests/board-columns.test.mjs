import { test } from 'node:test';
import assert from 'node:assert/strict';
import { boardColumns, columnOf, keyboardTarget, blockReason, cardAgent, inEdgeBand, visibleApprovals } from '../lib/board-columns.mjs';

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

test('a drag scrolls a box by itself only while the finger is in the box\'s own edge bands', () => {
 const board = { left: 0, right: 390, top: 400, bottom: 900, width: 390, height: 500 };
 assert.equal(inEdgeBand(board, { x: 200, y: 650 }), false);
 assert.equal(inEdgeBand(board, { x: 296, y: 520 }), false);
 assert.equal(inEdgeBand(board, { x: 313, y: 650 }), true);
 assert.equal(inEdgeBand(board, { x: 77, y: 650 }), true);
 assert.equal(inEdgeBand(board, { x: 200, y: 499 }), true);
 assert.equal(inEdgeBand(board, { x: 200, y: 801 }), true);
 assert.equal(inEdgeBand(board, { x: 420, y: 650 }), true);
 // The board scrolls only sideways, so its top and bottom bands do not count, and a list that scrolls only down not its sides.
 assert.equal(inEdgeBand(board, { x: 200, y: 450 }, { x: true, y: false }), false);
 assert.equal(inEdgeBand(board, { x: 330, y: 450 }, { x: true, y: false }), true);
 assert.equal(inEdgeBand(board, { x: 20, y: 650 }, { x: false, y: true }), false);
 assert.equal(inEdgeBand(board, { x: 20, y: 850 }, { x: false, y: true }), true);
});

test('an approval on a Card of an Agent hidden from the reader is not counted, nor its waiting item', () => {
 const cards = [{ id: 1, agent_id: null }, { id: 2, agent_id: 'seen' }, { id: 3, agent_id: 'hidden' }];
 const items = [{ kind: 'approval', id: 1 }, { kind: 'approval', id: 2 }, { kind: 'approval', id: 3 }, { kind: 'mention', id: 3 }];
 const shown = visibleApprovals(cards, items, new Set(['seen']));
 assert.deepEqual(shown.cards.map(card => card.id), [1, 2]);
 assert.deepEqual(shown.items, [{ kind: 'approval', id: 1 }, { kind: 'approval', id: 2 }, { kind: 'mention', id: 3 }]);
});
