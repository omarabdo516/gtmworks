import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inEdgeBand, scrollAxes, chatPlace, placeOrder, placeChanges, cardColumns, columnOfStatus, cardSymbol, orderCards, statusOfColumn, moveTarget, waitsOn, waitsOnReader } from '../lib/board-columns.mjs';

test('a waiting row opens its chat at its card: a handed step and a permission request by their anchor, a channel\'s request in its channel', () => {
 assert.equal(chatPlace('rs', { kind: 'permission', id: 9, conversation_id: 'c-1' }), '/c/rs/conversations/c-1#permission-9');
 assert.equal(chatPlace('rs', { kind: 'hand', id: 4, conversation_id: 'c-1' }), '/c/rs/conversations/c-1#hand-4');
 assert.equal(chatPlace('rs', { kind: 'question', id: 3, conversation_id: 'c-1' }), '/c/rs/conversations/c-1');
 assert.equal(chatPlace('rs', { kind: 'channel_permission', id: 7, conversation_id: null, channel_id: 'ch-1' }), '/c/rs/channels/ch-1#permission-7');
 assert.equal(chatPlace('rs', { kind: 'approval', id: 2, conversation_id: null }), null);
});

// #200: a Member mentioned in a channel opens that channel at the message.
test('a channel mention opens its channel at the message', () => {
 assert.equal(chatPlace('rs', { kind: 'channel_mention', id: 11, conversation_id: null, channel_id: 'ch-1', channel_message_id: 42 }), '/c/rs/channels/ch-1#mention-42');
 assert.equal(chatPlace('rs', { kind: 'channel_mention', id: 11, conversation_id: null }), null);
});

test('a place before a Card or at the column\'s end gives the column\'s new order, and a drop on its own place changes nothing', () => {
 assert.deepEqual(placeOrder([1, 2, 3], 3, null), [1, 2, 3]);
 assert.deepEqual(placeOrder([1, 2, 3], 3, 1), [3, 1, 2], 'carried to the top');
 assert.deepEqual(placeOrder([1, 2, 3], 1, 3), [2, 1, 3], 'carried above the last Card');
 assert.deepEqual(placeOrder([1, 2, 3], 1, 2), [1, 2, 3], 'a drop on its own place');
 assert.deepEqual(placeOrder([1, 2, 3, 4], 4, 2), [1, 4, 2, 3], 'into the middle');
 assert.equal(placeChanges([1, 2, 3], 1, 2), false);
 assert.equal(placeChanges([1, 2, 3], 3, null), false);
 assert.equal(placeChanges([1, 2, 3], 1, null), true);
 assert.equal(placeChanges([1, 2, 3], 2, 1), true);
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

// Spec #831 (#834): the board is the Engine's own Kanban board, its statuses grouped into five columns in one place.
test('the Engine board has five columns, Waiting on you first and no Live, and each Engine status lands in one of them', () => {
 assert.deepEqual(cardColumns, ['waiting', 'ideas', 'planned', 'progress', 'done']);
 const landed = Object.fromEntries(['blocked', 'review', 'triage', 'todo', 'scheduled', 'ready', 'running', 'done'].map(status => [status, columnOfStatus(status)]));
 assert.deepEqual(landed, { blocked: 'waiting', review: 'waiting', triage: 'ideas', todo: 'planned', scheduled: 'planned', ready: 'planned', running: 'progress', done: 'done' });
 assert.equal(columnOfStatus('archived'), null);
 assert.equal(columnOfStatus('something new'), null);
});

test('a Card\'s symbol says what it is doing: working now, a question, a review, stopped after failures, stopped, waiting for other Cards', () => {
 assert.deepEqual(cardSymbol({ status: 'running', failures: 0, parents: 0 }), { kind: 'working' });
 // Parked where the dispatcher does not start it (#838): a person's Stop, or an Agent that set its Card aside.
 assert.deepEqual(cardSymbol({ status: 'scheduled', failures: 0, parents: 0 }), { kind: 'stopped' });
 assert.deepEqual(cardSymbol({ status: 'blocked', failures: 0, parents: 0 }), { kind: 'question' });
 assert.deepEqual(cardSymbol({ status: 'blocked', failures: 1, parents: 0 }), { kind: 'question' });
 assert.deepEqual(cardSymbol({ status: 'blocked', failures: 2, parents: 0 }), { kind: 'failed' });
 assert.deepEqual(cardSymbol({ status: 'review', failures: 0, parents: 0 }), { kind: 'review' });
 assert.deepEqual(cardSymbol({ status: 'todo', failures: 0, parents: 1 }), { kind: 'waits', count: 1 });
 assert.deepEqual(cardSymbol({ status: 'todo', failures: 0, parents: 3 }), { kind: 'waits', count: 3 });
 for (const status of ['triage', 'todo', 'ready', 'done']) assert.equal(cardSymbol({ status, failures: 0, parents: 0 }), null, status);
 // A Card that already started is no longer waiting for its parents, whatever links it keeps.
 assert.deepEqual(cardSymbol({ status: 'running', failures: 0, parents: 2 }), { kind: 'working' });
});

test('Waiting on you lists the newest Card first; every other column keeps the Engine\'s own order', () => {
 const cards = [
  { id: 't_1', column: 'waiting', createdAt: 100 }, { id: 't_2', column: 'planned', createdAt: 300 }, { id: 't_3', column: 'waiting', createdAt: 300 },
  { id: 't_4', column: 'planned', createdAt: 100 }, { id: 't_5', column: 'waiting', createdAt: 200 },
 ];
 assert.deepEqual(orderCards(cards).map(card => card.id), ['t_3', 't_5', 't_1', 't_2', 't_4']);
});

// Spec #831 (#841): what waits on whom is worked out from the board read. A question waits on the Card's Member
// Assignee, else the person who made it, else every Administrator and Manager; a review only on those who may decide it;
// a Card given to a Member waits on them until it is done. A person who is no longer a Member is waited on by nobody.
test('a waiting Card waits on its Member, else its maker, else the Administrators and Managers; a review on those who decide it', () => {
 const members = new Set(['mona', 'omar', 'sara', 'vic']);
 const blocked = { status: 'blocked', person: null, maker: null };
 assert.deepEqual(waitsOn({ ...blocked, person: 'mona', maker: 'omar' }, members), { person: 'mona' });
 assert.deepEqual(waitsOn({ ...blocked, maker: 'mona' }, members), { person: 'mona' });
 assert.deepEqual(waitsOn(blocked, members), { leads: true });
 // A former Member is waited on by nobody: the question goes to the next in line.
 assert.deepEqual(waitsOn({ ...blocked, person: 'gone', maker: 'mona' }, members), { person: 'mona' });
 assert.deepEqual(waitsOn({ ...blocked, maker: 'gone' }, members), { leads: true });
 for (const card of [{ status: 'review', person: 'mona', maker: 'mona' }, { status: 'review', person: null, maker: null }])
  assert.deepEqual(waitsOn(card, members), { leads: true });
 for (const status of ['triage', 'todo', 'scheduled', 'ready', 'running'])
  assert.deepEqual(waitsOn({ status, person: 'mona', maker: 'omar' }, members), { person: 'mona' }, status);
 for (const status of ['triage', 'todo', 'ready', 'running']) assert.equal(waitsOn({ status, person: null, maker: 'omar' }, members), null, status);
 assert.equal(waitsOn({ status: 'done', person: 'mona', maker: 'omar' }, members), null);
 assert.equal(waitsOn({ status: 'ready', person: 'gone', maker: 'omar' }, members), null);
});

test('a Card waits on the reader when it waits on them by name, or on the Administrators and Managers and they are one', () => {
 assert.equal(waitsOnReader({ person: 'mona' }, { me: 'mona', role: 'contributor' }), true);
 assert.equal(waitsOnReader({ person: 'mona' }, { me: 'omar', role: 'owner' }), false);
 for (const [role, mine] of [['owner', true], ['manager', true], ['contributor', false], ['viewer', false], [null, false]])
  assert.equal(waitsOnReader({ leads: true }, { me: 'x', role }), mine, String(role));
 assert.equal(waitsOnReader(null, { me: 'mona', role: 'owner' }), false);
});

// #837: a person moves a Card into Ideas, Planned or Done, each asking the Engine for one status; In progress and Waiting
// on you are the work's own, and Shift with an arrow passes over them to the next column a person moves a Card into.
test('a person\'s move asks the Engine for the status its column means, and In progress and Waiting on you for none', () => {
  assert.equal(statusOfColumn('ideas', false), 'triage');
  assert.equal(statusOfColumn('planned', false), 'ready');
  assert.equal(statusOfColumn('planned', true), 'todo');
  assert.equal(statusOfColumn('done', true), 'done');
  assert.equal(statusOfColumn('progress', false), null);
  assert.equal(statusOfColumn('waiting', false), null);
  // Left to right in English: Waiting on you, Ideas, Planned, In progress, Done.
  assert.equal(moveTarget('ideas', 'ArrowRight', false), 'planned');
  assert.equal(moveTarget('planned', 'ArrowRight', false), 'done');
  assert.equal(moveTarget('done', 'ArrowRight', false), null);
  assert.equal(moveTarget('ideas', 'ArrowLeft', false), null);
  assert.equal(moveTarget('progress', 'ArrowLeft', false), 'planned');
  assert.equal(moveTarget('waiting', 'ArrowRight', false), 'ideas');
  // In Arabic the columns run right to left.
  assert.equal(moveTarget('ideas', 'ArrowLeft', true), 'planned');
  assert.equal(moveTarget('planned', 'ArrowUp', false), null);
});
