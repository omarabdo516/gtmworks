import test from 'node:test';
import assert from 'node:assert/strict';
import { clickPath } from './navigation-measure.ts';

// The prepared-navigation measurement keeps the Inbox (reached from the sidebar's approvals entry) and adds the
// Activity log, the new sidebar's last entry (its own page, #11). It starts from Numbers, the sidebar entry that opens
// its own page (#35) where Home used to be. A Card opens in its window over the board (#678), from the board and from the list.
test('the prepared click path measures the Inbox and the Activity log from the sidebar', () => {
 const step = name => clickPath.find(entry => entry.name === name);
 assert.deepEqual(step('inbox'), { name: 'inbox', link: '.nav a[href$="/approvals"]', path: '/approvals', content: '.approvals', motion: { shown: 0, settled: 700 } });
 assert.deepEqual(step('activity log'), { name: 'activity log', link: '.nav a[href$="/log"]', path: '/log', content: '.log-page', motion: { shown: 0, settled: 200 } });
 // From the list a Card opens over the board the list leaves for, so the step waits for the board's entrance.
 assert.deepEqual(step('open card from the list'), { name: 'open card from the list', link: '.table a[href$="/board?card=1"]', path: '/work/board', search: '?card=1', content: '.cw[open]', motion: { shown: 0, settled: 700 } });
 // The board opens a Card in its window and closes it, with the window's approved motion as its only allowance.
 assert.deepEqual(step('open card'), { name: 'open card', link: '#board-cols .kcard[data-card-id="1"] a', path: '/work/board', search: '?card=1', content: '.cw[open]', motion: { shown: 0, settled: 280 } });
 assert.deepEqual(step('close card'), { name: 'close card', link: '.cw[open] .cw-head .circle-btn[aria-label="Close the card"]', path: '/work/board', search: '', content: '.board', gone: '.cw[open]', motion: { shown: 190, settled: 190 } });
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
 assert.deepEqual(clickPath.map(entry => entry.name), ['numbers', 'work', 'open card', 'close card', 'list', 'open card from the list', 'close card on the board', 'calendar', 'inbox', 'activity log']);
});
