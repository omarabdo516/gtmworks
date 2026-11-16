import test from 'node:test';
import assert from 'node:assert/strict';
import { clickPath } from './navigation-measure.ts';

// The prepared-navigation measurement keeps the Inbox (reached from the sidebar's approvals entry) and adds the
// Activity log, the new sidebar's last entry (its own page, #11). It starts from Numbers, the sidebar entry that opens
// its own page (#35) where Home used to be. The Card's page opens from the list: on the board a Card opens as its sheet (#116).
test('the prepared click path measures the Inbox and the Activity log from the sidebar', () => {
 const step = name => clickPath.find(entry => entry.name === name);
 assert.deepEqual(step('inbox'), { name: 'inbox', link: '.nav a[href$="/approvals"]', path: '/approvals', content: '.approvals' });
 assert.deepEqual(step('activity log'), { name: 'activity log', link: '.nav a[href$="/log"]', path: '/log', content: '.log-page' });
 assert.deepEqual(step('open card'), { name: 'open card', link: '.table a[href$="/board/1"]', path: '/work/board/1', content: '.modal' });
 // The board opens a Card as its sheet and closes it, with the sheet's approved motion as its only allowance.
 assert.deepEqual(step('open sheet'), { name: 'open sheet', link: '#board-cols .kcard[data-card-id="1"] a', path: '/work/board', search: '?card=1', content: '.sheet[open]', motion: { shown: 0, settled: 280 } });
 assert.deepEqual(step('close sheet'), { name: 'close sheet', link: '.sheet[open] .sheet__top .circle-btn', path: '/work/board', search: '', content: '.board', gone: '.sheet[open]', motion: { shown: 190, settled: 190 } });
 assert.deepEqual(clickPath.map(entry => entry.name), ['numbers', 'work', 'open sheet', 'close sheet', 'list', 'open card', 'close card', 'calendar', 'inbox', 'activity log']);
});
