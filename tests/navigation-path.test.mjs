import test from 'node:test';
import assert from 'node:assert/strict';
import { clickPath } from './navigation-measure.ts';

// The prepared-navigation measurement keeps the Inbox (reached from the sidebar's approvals entry) and adds the
// Activity log, the new sidebar's last entry (its own page, #11). It starts from Numbers, the sidebar entry that opens
// its own page (#35) where Home used to be. The Card's page opens from the list; the board is the Engine's own Kanban
// board (spec #831), and a Card opened over it returns to the path with its Card window (#835).
test('the prepared click path measures the Inbox and the Activity log from the sidebar', () => {
 const step = name => clickPath.find(entry => entry.name === name);
 assert.deepEqual(step('inbox'), { name: 'inbox', link: '.nav a[href$="/approvals"]', path: '/approvals', content: '.approvals', motion: { shown: 0, settled: 700 } });
 assert.deepEqual(step('activity log'), { name: 'activity log', link: '.nav a[href$="/log"]', path: '/log', content: '.log-page', motion: { shown: 0, settled: 200 } });
 assert.deepEqual(step('open card'), { name: 'open card', link: '.table a[href$="/board/1"]', path: '/work/board/1', content: '.modal', motion: { shown: 0, settled: 200 } });
 // A step that opens a new page waits for the page's 200ms fadeIn, beside which the current row's 150ms fade runs
 // (#135); one that opens the board (Marketing board, and the Inbox, the board on "Waiting on you") waits for the
 // board's 700ms entrance beside them (#131, #559); a step that stays on its page has its own allowance only. Each run
 // starts on the board.
 const boards = ['/work/board', '/approvals'];
 clickPath.forEach((entry, index) => {
  const from = index ? clickPath[index - 1].path : '/work/board';
  if (entry.path !== from) assert.deepEqual(entry.motion, { shown: 0, settled: boards.includes(entry.path) ? 700 : 200 }, entry.name);
  else assert.notDeepEqual(entry.motion, { shown: 0, settled: 200 }, entry.name);
 });
 assert.deepEqual(clickPath.map(entry => entry.name), ['numbers', 'work', 'list', 'open card', 'close card', 'calendar', 'inbox', 'activity log']);
});
