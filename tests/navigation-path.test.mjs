import test from 'node:test';
import assert from 'node:assert/strict';
import { clickPath } from './navigation-measure.ts';

// The prepared-navigation measurement keeps the Inbox (reached from the sidebar's approvals entry) and adds the
// Activity log, the new sidebar's last entry (its own page, #11). It starts from Numbers, the sidebar entry that opens
// its own page (#35) where Home used to be. On the board, the Engine's own Kanban board (spec #831), a Card opens in its
// Card window (#835); the list reads the same board (#845), and its Card opens the board with that window.
test('the prepared click path measures the Inbox and the Activity log from the sidebar', () => {
 const step = name => clickPath.find(entry => entry.name === name);
 assert.deepEqual(step('inbox'), { name: 'inbox', link: '.nav a[href$="/approvals"]', path: '/approvals', content: '.approvals', motion: { shown: 0, settled: 700 } });
 assert.deepEqual(step('activity log'), { name: 'activity log', link: '.nav a[href$="/log"]', path: '/log', content: '.log-page', motion: { shown: 0, settled: 200 } });
 assert.deepEqual(step('open card'), { name: 'open card', link: '.table a[href$="?card=t_0000c0de"]', path: '/work/board', search: '?card=t_0000c0de', content: '.cw[open]', motion: { shown: 0, settled: 700 } });
 assert.deepEqual(step('close card'), { name: 'close card', link: '.cw[open] .cw-head .circle-btn[aria-label="Close the card"]', path: '/work/board', search: '', content: '.board', gone: '.cw[open]', motion: { shown: 190, settled: 190 } });
 // The board opens a Card in its window and closes it, with the window's approved motion as its only allowance.
 assert.deepEqual(step('open sheet'), { name: 'open sheet', link: '#board-cols .kcard[data-card="t_0000c0de"] a', path: '/work/board', search: '?card=t_0000c0de', content: '.cw[open]', motion: { shown: 0, settled: 280 } });
 assert.deepEqual(step('close sheet'), { name: 'close sheet', link: '.cw[open] .cw-head .circle-btn[aria-label="Close the card"]', path: '/work/board', search: '', content: '.board', gone: '.cw[open]', motion: { shown: 190, settled: 190 } });
 // A step that opens a new page waits for the page's 200ms fadeIn, beside which the current row's 150ms fade runs
 // (#135); one that opens the board (Marketing board, and the Inbox, the board on "Waiting on you") waits for the
 // board's 700ms entrance beside them (#131, #559); a step that stays on its page (the Card window) has its own allowance
 // only. Each run starts on the board.
 const boards = ['/work/board', '/approvals'];
 clickPath.forEach((entry, index) => {
  const from = index ? clickPath[index - 1].path : '/work/board';
  if (entry.path !== from) assert.deepEqual(entry.motion, { shown: 0, settled: boards.includes(entry.path) ? 700 : 200 }, entry.name);
  else assert.notDeepEqual(entry.motion, { shown: 0, settled: 200 }, entry.name);
 });
 assert.deepEqual(clickPath.map(entry => entry.name), ['numbers', 'work', 'open sheet', 'close sheet', 'list', 'open card', 'close card', 'calendar', 'inbox', 'activity log']);
});
