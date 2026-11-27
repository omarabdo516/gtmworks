import { test } from 'node:test';
import assert from 'node:assert/strict';
import { latestActivity, agentLogFilter, pickTab, fileSize, agentFiles, worksWith } from '../lib/agent-details.mjs';
import { matchesFilters } from '../lib/activity-log.mjs';

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

test('the panel opens on the tab its address names, Memory included since it opens (#350), and on Activity for anything else', () => {
 assert.deepEqual(['activity', 'tasks', 'files', 'memory', 'log'].map(pickTab), ['activity', 'tasks', 'files', 'memory', 'log']);
 for (const other of ['Files', '', undefined, ['files']]) assert.equal(pickTab(other), 'activity');
});

test('a file\'s size reads as the reference writes it, in Latin digits', () => {
 assert.deepEqual([300, 88064, 1048576 * 12.4, 1048576 * 240].map(fileSize), ['300 B', '86 KB', '12.4 MB', '240 MB']);
 assert.equal(fileSize(1536), '2 KB', 'kilobytes are whole, as the reference writes them');
});

test('a file the Agent handed over in a channel is listed by its channel, beside the Conversation\'s (#715)', () => {
 const files = agentFiles({
  slug: 'rs-learning',
  conversationFiles: [{ id: 5, name: 'audiences.csv', size: 18000, created_at: '2026-06-12T09:00:00Z', conversation_id: 'c-1', agent_name: 'Meta Ads' }],
  titles: new Map(),
  channelFiles: [{ id: 5, name: 'report.pdf', size: 4000, created_at: '2026-06-13T09:00:00Z', channel: 'launch' }],
 });
 assert.deepEqual(files.map(file => [file.key, file.name, file.source, file.href]), [
  ['channel-5', 'report.pdf', '#launch', '/c/rs-learning/files/channel/5'],
  ['conversation-5', 'audiences.csv', 'Meta Ads', '/c/rs-learning/files/conversation/5'],
 ]);
});

test('an Agent\'s files are the reader\'s own Conversations\' with it, newest first, each named for where it came from, and none of the old board\'s Cards (#846)', () => {
 const files = agentFiles({
  slug: 'rs-learning',
  conversationFiles: [
   { id: 3, name: 'audiences.csv', size: 18000, created_at: '2026-06-12T09:00:00Z', conversation_id: 'c-1', agent_name: 'Meta Ads' },
   { id: 4, name: 'old.png', size: 90, created_at: '2026-06-01T09:00:00Z', conversation_id: 'c-2', agent_name: 'Meta Ads' },
  ],
  titles: new Map([['c-1', 'Plan the June campaign']]),
  channelFiles: [],
 });
 assert.deepEqual(files.map(file => [file.name, file.source, file.href]), [
  ['audiences.csv', 'Plan the June campaign', '/c/rs-learning/files/conversation/3'],
  ['old.png', 'Meta Ads', '/c/rs-learning/files/conversation/4'],
 ]);
});

test('a new Agent works with you in a Company worked alone or when only its sole Owner sees it, else with the whole team', () => {
 const owner = { person_id: 'omar', role: 'owner' }, sara = { person_id: 'sara', role: 'contributor' };
 assert.equal(worksWith({ alone: true, me: 'sara', members: [owner, sara], access: ['sara'] }), 'you');
 assert.equal(worksWith({ alone: false, me: 'omar', members: [owner, sara], access: [] }), 'you');
 assert.equal(worksWith({ alone: false, me: 'omar', members: [owner, sara], access: ['sara'] }), 'team', 'another Member was given it');
 assert.equal(worksWith({ alone: false, me: 'omar', members: [owner], access: ['gone'] }), 'you', 'a removed Member\'s row counts for nothing');
 assert.equal(worksWith({ alone: false, me: 'omar', members: [owner, { person_id: 'mona', role: 'owner' }], access: [] }), 'team', 'every Owner sees every Agent');
 assert.equal(worksWith({ alone: false, me: 'sara', members: [owner, sara], access: ['sara'] }), 'team', 'a Member is never alone with an Agent: the Owner sees it too');
});
