import { test } from 'node:test';
import assert from 'node:assert/strict';
import { agentStatus, agentTasks, latestActivity, agentLogFilter, pickTab, fileSize, agentFiles } from '../lib/agent-details.mjs';
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

test('the panel opens on the tab its address names, and on Activity for anything else, Memory included while it waits', () => {
 assert.deepEqual(['activity', 'tasks', 'files', 'log'].map(pickTab), ['activity', 'tasks', 'files', 'log']);
 for (const other of ['memory', 'Files', '', undefined, ['files']]) assert.equal(pickTab(other), 'activity');
});

test('a file\'s size reads as the reference writes it, in Latin digits', () => {
 assert.deepEqual([300, 88064, 1048576 * 12.4, 1048576 * 240].map(fileSize), ['300 B', '86 KB', '12.4 MB', '240 MB']);
 assert.equal(fileSize(1536), '2 KB', 'kilobytes are whole, as the reference writes them');
});

test('an Agent\'s files are its Cards\' and the reader\'s own Conversations\' with it, newest first, each named for where it came from', () => {
 const files = agentFiles({
  slug: 'rs-learning',
  cards: [{ id: 7, title: 'June campaign' }],
  cardFiles: [{ id: 3, name: 'brief.pdf', size: 1200, created_at: '2026-06-10T09:00:00Z', card_id: 7 }],
  conversationFiles: [
   { id: 3, name: 'audiences.csv', size: 18000, created_at: '2026-06-12T09:00:00Z', conversation_id: 'c-1', agent_name: 'Meta Ads' },
   { id: 4, name: 'old.png', size: 90, created_at: '2026-06-01T09:00:00Z', conversation_id: 'c-2', agent_name: 'Meta Ads' },
  ],
  titles: new Map([['c-1', 'Plan the June campaign']]),
 });
 assert.deepEqual(files.map(file => [file.name, file.source, file.href]), [
  ['audiences.csv', 'Plan the June campaign', '/c/rs-learning/files/conversation/3'],
  ['brief.pdf', 'June campaign', '/c/rs-learning/files/3'],
  ['old.png', 'Meta Ads', '/c/rs-learning/files/conversation/4'],
 ]);
 assert.equal(new Set(files.map(file => file.key)).size, 3, 'a Card file and a Conversation file with the same number are two rows');
});
