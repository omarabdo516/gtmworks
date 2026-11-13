import test from 'node:test';
import assert from 'node:assert/strict';
import { orderAgents, groupRecents, waitingLabel, themeChoices, companyAgents, matchChats, moreSections } from '../lib/sidebar.mjs';
import { readFileSync } from 'node:fs';

test('the Inbox entry is named at zero too, so it stays reachable when nothing waits', () => {
 assert.deepEqual(waitingLabel(0), ['nothingWaitingOnYou']);
 assert.deepEqual(waitingLabel(3), ['thingsWaitingOnYou', 3]);
});

test('the account menu offers Light, Dark and following the Device', () => {
 assert.deepEqual(themeChoices, ['light', 'dark', 'device']);
});

test('the sidebar reads the company’s own real Agents, the main Agent first', async () => {
 const calls = [];
 const rows = [{ id: 'a', connection_id: 'ca', name: 'Ads', speciality: 'Ads', is_default: false }, { id: 'l', connection_id: 'cl', name: 'Lead', speciality: 'General', is_default: true }];
 const db = { from: table => { calls.push(['from', table]); const chain = {
  select: columns => { calls.push(['select', columns]); return chain; },
  eq: (column, value) => { calls.push(['eq', column, value]); return chain; },
  order: column => { calls.push(['order', column]); return Promise.resolve({ data: rows }); },
 }; return chain; } };
 assert.deepEqual((await companyAgents(db, 'company-1')).map(agent => agent.id), ['l', 'a']);
 assert.deepEqual(calls, [['from', 'hermes_agents'], ['select', 'id,connection_id,name,speciality,is_default'], ['eq', 'company_id', 'company-1'], ['order', 'name']]);
 const empty = { from: () => ({ select: () => ({ eq: () => ({ order: () => Promise.resolve({ data: null }) }) }) }) };
 assert.deepEqual(await companyAgents(empty, 'company-1'), []);
});

test('the main Agent, Lead, comes first and the rest keep their name order', () => {
 const agents = [{ id: 'a', name: 'Ads', is_default: false }, { id: 'l', name: 'Lead', is_default: true }, { id: 'c', name: 'Critic', is_default: false }];
 assert.deepEqual(orderAgents(agents).map(agent => agent.id), ['l', 'a', 'c']);
 assert.deepEqual(orderAgents([]), []);
});

test('recent chats fall into Today, Yesterday and Earlier by the local day, newest first in each', () => {
 const now = new Date(2026, 10, 12, 9, 0);
 const at = (day, hour) => new Date(2026, 10, day, hour, 0).toISOString();
 const groups = groupRecents([
  { id: 'old', created_at: at(3, 10) },
  { id: 'today-early', created_at: at(12, 0) },
  { id: 'yesterday', created_at: at(11, 23) },
  { id: 'today-late', created_at: at(12, 8) },
  { id: 'two-days', created_at: at(10, 12) },
 ], now);
 assert.deepEqual(groups.map(group => [group.day, group.items.map(item => item.id)]), [
  ['today', ['today-late', 'today-early']],
  ['yesterday', ['yesterday']],
  ['earlier', ['two-days', 'old']],
 ]);
});

test('a day with no chats has no group', () => {
 const now = new Date(2026, 10, 12, 9, 0);
 assert.deepEqual(groupRecents([], now), []);
 assert.deepEqual(groupRecents([{ id: 'x', created_at: new Date(2026, 10, 1).toISOString() }], now).map(group => group.day), ['earlier']);
});

test('the sidebar search narrows chats by title, ignoring case and surrounding space, and an empty search keeps all', () => {
 const chats = [{ id: 1, title: 'خطة حملة Meta' }, { id: 2, title: 'Weekly report' }];
 assert.deepEqual(matchChats(chats, '').map(chat => chat.id), [1, 2]);
 assert.deepEqual(matchChats(chats, '   ').map(chat => chat.id), [1, 2]);
 assert.deepEqual(matchChats(chats, ' meta ').map(chat => chat.id), [1]);
 assert.deepEqual(matchChats(chats, 'WEEKLY').map(chat => chat.id), [2]);
 assert.deepEqual(matchChats(chats, 'nothing'), []);
});

test('"More sections" reaches every existing section the reference has no place for, each named in both languages', () => {
 assert.deepEqual(moreSections.map(([path]) => path), ['home', 'projects', 'skills', 'approvals', 'usage', 'settings/members', 'settings/work', 'settings/agents', 'agents']);
 for (const language of ['en', 'ar']) {
  const catalogue = JSON.parse(readFileSync(new URL(`../lib/messages/${language}.json`, import.meta.url), 'utf8'));
  for (const [path, key] of moreSections) assert.ok(catalogue[key], `${language}: ${path} has a name`);
 }
});
