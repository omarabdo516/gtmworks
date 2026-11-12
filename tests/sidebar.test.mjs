import test from 'node:test';
import assert from 'node:assert/strict';
import { orderAgents, groupRecents } from '../lib/sidebar.mjs';

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
