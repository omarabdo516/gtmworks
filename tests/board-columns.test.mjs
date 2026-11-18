import { test } from 'node:test';
import assert from 'node:assert/strict';
import { boardColumns, chatWait, columnOf, keyboardTarget, blockReason, cardAgent, inEdgeBand, scrollAxes, onCard, visibleApprovals, waitingCount, chatPlace } from '../lib/board-columns.mjs';

test('the six columns keep the approved order, Waiting on you first', () => {
 assert.deepEqual(boardColumns, ['waiting', 'ideas', 'planned', 'progress', 'live', 'done']);
});

test('a card shows in its stage column', () => {
 const stages = [{ id: 1, board_column: 'ideas' }, { id: 5, board_column: 'waiting' }, { id: 6, board_column: 'planned' }];
 assert.equal(columnOf({ stage_id: 5 }, stages), 'waiting');
 assert.equal(columnOf({ stage_id: 6 }, stages), 'planned');
});

// #146: a card whose chat waits on its person shows under Waiting on you, whatever its stage, which stays as it is.
test('a card whose chat waits shows in Waiting on you from any stage, and in its stage column once it waits no more', () => {
 const stages = [{ id: 1, board_column: 'ideas' }, { id: 3, board_column: 'progress' }, { id: 5, board_column: 'waiting' }, { id: 7, board_column: 'live' }];
 const wait = { person: 'p-1', kind: 'hand', title: 'انشر المقال' };
 for (const stage_id of [1, 3, 5, 7]) assert.equal(columnOf({ stage_id, wait }, stages), 'waiting');
 assert.equal(columnOf({ stage_id: 3, wait: null }, stages), 'progress');
});

// design-reference: kcardHTML's waiting branch and cardMine, with a Viewer reading the team's wait (#146).
test('a chat\'s wait reads as the reader\'s own, another person\'s or the team\'s, and the reader\'s approval comes before another person\'s wait', () => {
 const wait = { person: 'omar', kind: 'question', title: 'Which audience first?' };
 const read = (me, writer, approval, card = { wait }) => chatWait(card, { me, writer, approval });
 assert.deepEqual(read('omar', true, false), { ...wait, mine: true, team: false });
 assert.deepEqual(read('sara', true, false), { ...wait, mine: false, team: false });
 assert.deepEqual(read('nour', false, false), { ...wait, mine: false, team: true });
 assert.deepEqual(read('omar', true, true), { ...wait, mine: true, team: false });
 assert.equal(read('sara', true, true), null);
 assert.equal(read('omar', true, true, { wait: null }), null);
 assert.equal(read('omar', true, false, {}), null);
});

test('Waiting on you counts each Card once: its approval and its chat\'s question and hand together, every other row apart', () => {
 const row = (kind, card_id, conversation_id = null) => ({ kind, card_id, conversation_id });
 assert.equal(onCard(row('approval', 5)), true);
 assert.equal(onCard(row('hand', 5, 'c-1')), true);
 assert.equal(onCard(row('question', 5, 'c-1')), true);
 assert.equal(onCard(row('hand', null, 'c-2')), false, 'a hand of a chat with no Card');
 assert.equal(onCard(row('question', 5)), false, 'a question about a Card, asked by no chat');
 assert.equal(onCard(row('mention', 5, 'c-1')), false);
 assert.equal(waitingCount([row('approval', 5), row('hand', 5, 'c-1'), row('question', 5, 'c-1'), row('hand', 6, 'c-3'), row('question', 6, 'c-3'), row('hand', null, 'c-2'), row('question', 5), row('mention', 5)]), 5);
 assert.equal(waitingCount([]), 0);
});

// #165: a permission request is one more thing waiting on its person: with its chat's Card when the chat has one, else
// alone, and a channel's alone.
test('Waiting on you counts a permission request with its chat\'s Card, and alone otherwise', () => {
 const row = (kind, card_id, conversation_id = null) => ({ kind, card_id, conversation_id });
 assert.equal(onCard(row('permission', 5, 'c-1')), true);
 assert.equal(onCard(row('permission', null, 'c-2')), false);
 assert.equal(onCard(row('channel_permission', null)), false);
 assert.equal(waitingCount([row('permission', 5, 'c-1'), row('question', 5, 'c-1'), row('permission', null, 'c-2'), row('channel_permission', null), row('channel_permission', null)]), 4);
});

test('a waiting row opens its chat at its card: a handed step and a permission request by their anchor, a channel\'s request in its channel', () => {
 assert.equal(chatPlace('rs', { kind: 'permission', id: 9, conversation_id: 'c-1' }), '/c/rs/conversations/c-1#permission-9');
 assert.equal(chatPlace('rs', { kind: 'hand', id: 4, conversation_id: 'c-1' }), '/c/rs/conversations/c-1#hand-4');
 assert.equal(chatPlace('rs', { kind: 'question', id: 3, conversation_id: 'c-1' }), '/c/rs/conversations/c-1');
 assert.equal(chatPlace('rs', { kind: 'channel_permission', id: 7, conversation_id: null, channel_id: 'ch-1' }), '/c/rs/channels/ch-1#permission-7');
 assert.equal(chatPlace('rs', { kind: 'approval', id: 2, conversation_id: null }), null);
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

test('a card its chat holds in Waiting on you is left by the chat, not by a decision (#146)', () => {
 assert.equal(blockReason('waiting', 'ideas', true), 'chat');
 assert.equal(blockReason('waiting', 'live', true), 'chat');
 assert.equal(blockReason('waiting', 'waiting', true), 'same');
 assert.equal(blockReason('ideas', 'waiting', true), 'waiting');
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

test('a box scrolls by itself on the axis it has room to scroll, not on the axis it merely spills over', () => {
 // The board runs sideways; a pixel of spill downward must not hand a held Card the downward axis (#249).
 const sideways = scrollAxes({ x: 1286, y: 1 });
 assert.deepEqual(sideways, { x: true, y: false });
 const board = { left: 0, right: 390, top: 400, bottom: 900, width: 390, height: 500 };
 assert.equal(inEdgeBand(board, { x: 200, y: 499 }, sideways), false, 'the top band of a box that scrolls sideways');
 assert.equal(inEdgeBand(board, { x: 330, y: 650 }, sideways), true, 'its own side band');
 assert.deepEqual(scrollAxes({ x: 0, y: 360 }), { x: false, y: true });
 assert.deepEqual(scrollAxes({ x: 240, y: 360 }), { x: false, y: true });
 assert.deepEqual(scrollAxes({ x: 0, y: 0 }), { x: false, y: false });
 assert.deepEqual(scrollAxes({ x: -2, y: 0 }), { x: false, y: false }, 'past the edge is no room');
 assert.deepEqual(scrollAxes({ x: 40, y: 40 }), { x: true, y: true }, 'equal room on both axes scrolls on both');
});

test('an approval on a Card of an Agent hidden from the reader is not counted, nor its waiting item', () => {
 const cards = [{ id: 1, agent_id: null }, { id: 2, agent_id: 'seen' }, { id: 3, agent_id: 'hidden' }];
 const items = [{ kind: 'approval', id: 1 }, { kind: 'approval', id: 2 }, { kind: 'approval', id: 3 }, { kind: 'mention', id: 3 }];
 const shown = visibleApprovals(cards, items, new Set(['seen']));
 assert.deepEqual(shown.cards.map(card => card.id), [1, 2]);
 assert.deepEqual(shown.items, [{ kind: 'approval', id: 1 }, { kind: 'approval', id: 2 }, { kind: 'mention', id: 3 }]);
});
