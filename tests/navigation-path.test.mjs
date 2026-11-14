import test from 'node:test';
import assert from 'node:assert/strict';
import { clickPath } from './navigation-measure.ts';

// The prepared-navigation measurement keeps the Inbox (reached from the sidebar's approvals entry) and adds the
// Activity log, the new sidebar's last entry (its own page, #11). It starts from Numbers, the sidebar entry that opens
// its own page (#35) where Home used to be.
test('the prepared click path measures the Inbox and the Activity log from the sidebar', () => {
 const step = name => clickPath.find(entry => entry.name === name);
 assert.deepEqual(step('inbox'), { name: 'inbox', link: '.nav a[href$="/approvals"]', path: '/approvals', content: '.approvals' });
 assert.deepEqual(step('activity log'), { name: 'activity log', link: '.nav a[href$="/log"]', path: '/log', content: '.log-page' });
 assert.deepEqual(clickPath.map(entry => entry.name), ['numbers', 'work', 'open card', 'close card', 'list', 'calendar', 'inbox', 'activity log']);
});
