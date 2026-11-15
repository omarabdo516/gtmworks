import { test } from 'node:test';
import assert from 'node:assert/strict';
import { agentStatus, agentTasks, latestActivity, agentLogFilter } from '../lib/agent-details.mjs';
import { matchesFilters } from '../lib/activity-log.mjs';
import { columnLabel, progressOf } from '../lib/board-columns.mjs';

test('an Agent waiting on the reader says so before it says it is working; with neither it is idle', () => {
 assert.equal(agentStatus({ waitingMine: true, running: true }), 'waiting');
 assert.equal(agentStatus({ waitingMine: false, running: true }), 'working');
 assert.equal(agentStatus({ waitingMine: false, running: false }), 'idle');
});

const stages = [{ id: 1, name: 'Ideas', board_column: 'ideas' }, { id: 2, name: 'Writing', board_column: 'progress' }, { id: 3, name: 'Review', board_column: 'waiting' }, { id: 4, name: 'Published', board_column: 'done' }];

test('an Agent\'s Cards follow the board\'s columns, each with the reference\'s line under it', () => {
 const cards = [
  { id: 10, title: 'Done post', stage_id: 4 },
  { id: 11, title: 'Article', stage_id: 2 },
  { id: 12, title: 'Campaign', stage_id: 3 },
  { id: 13, title: 'Idea', stage_id: 1 },
  { id: 14, title: 'Draft', stage_id: 2 },
 ];
 const checklist = [{ card_id: 11, title: 'Outline', done: true }, { card_id: 11, title: 'Write the intro', done: false }, { card_id: 11, title: 'Edit', done: false }];
 const waiting = [{ kind: 'approval', title: 'Campaign', body: 'Final OK', card_id: 12 }];
 assert.deepEqual(agentTasks(cards, stages, checklist, waiting), [
  { id: 12, title: 'Campaign', column: 'waiting', line: { key: 'boardWaitingYourOk', args: ['Final OK'] }, waiting: true },
  { id: 13, title: 'Idea', column: 'ideas', line: { text: 'Ideas' }, waiting: false },
  { id: 11, title: 'Article', column: 'progress', line: { text: 'Write the intro · 33%' }, waiting: false },
  { id: 14, title: 'Draft', column: 'progress', line: { text: 'Writing' }, waiting: false },
  { id: 10, title: 'Done post', column: 'done', line: { text: 'Published' }, waiting: false },
 ]);
});

test('a question about a Card is its line; a Card waiting on someone else shows its stage', () => {
 const cards = [{ id: 20, title: 'Ad', stage_id: 3 }, { id: 21, title: 'Reel', stage_id: 3 }];
 const lines = agentTasks(cards, stages, [], [{ kind: 'question', title: 'Which angle?', body: '', card_id: 20 }]).map(task => task.line);
 assert.deepEqual(lines, [{ text: 'Which angle?' }, { text: 'Review' }]);
});

test('latest activity is the newest three rows of the last week, newest first', () => {
 const rows = [
  { id: 1, created_at: '2026-06-01T09:00:00Z' },
  { id: 2, created_at: '2026-06-10T09:00:00Z' },
  { id: 3, created_at: '2026-06-12T09:00:00Z' },
  { id: 4, created_at: '2026-06-11T09:00:00Z' },
  { id: 5, created_at: '2026-06-12T09:00:00Z' },
 ];
 assert.deepEqual(latestActivity(rows, '2026-06-05T00:00:00Z').map(row => row.id), [5, 3, 4]);
 assert.deepEqual(latestActivity(rows, '2026-06-11T12:00:00Z').map(row => row.id), [5, 3]);
 assert.deepEqual(latestActivity(rows, '2026-06-13T00:00:00Z'), []);
});

test('the Agent\'s log is what it did and what was done to it, as the Activity log filters an Agent', () => {
 const agent = '65000000-0000-0000-0000-000000000004';
 assert.equal(agentLogFilter(agent), `and(actor_kind.eq.agent,actor_id.eq.${agent}),agent_id.eq.${agent}`);
 const who = { kind: 'agent', id: agent };
 assert.equal(matchesFilters({ actor_kind: 'agent', actor_id: agent }, who, null), true);
 assert.equal(matchesFilters({ actor_kind: 'person', actor_id: 'omar', agent_id: agent }, who, null), true);
 assert.equal(matchesFilters({ actor_kind: 'person', actor_id: agent }, who, null), false);
});

test('a column\'s name and a Card\'s progress are the board\'s', () => {
 assert.equal(columnLabel('waiting', true), 'boardColWaiting');
 assert.equal(columnLabel('waiting', false), 'boardColWaitingTeam');
 assert.equal(columnLabel('progress', false), 'boardColProgress');
 assert.equal(columnLabel('unknown', true), 'boardColIdeas');
 assert.deepEqual(progressOf({ id: 1 }, [{ card_id: 1, title: 'A', done: true }, { card_id: 1, title: 'B', done: false }, { card_id: 2, title: 'C', done: false }]), { pct: 50, next: 'B' });
 assert.equal(progressOf({ id: 3 }, []), null);
});
