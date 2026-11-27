import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

// Spec #831, #846: the board is the Engine's own Kanban board, and the old board is switched off. No product code reads
// or writes the old Card tables; the tables stay, untouched, until Omar removes them himself (ADR 0033 item 9).
const oldCardTables = ['work_cards', 'work_stages', 'work_labels', 'work_card_labels', 'work_checklist', 'work_activity',
 'work_creatives', 'work_versions', 'work_comments', 'work_attachments', 'work_assignees', 'work_card_moves', 'work_card_visits',
 'approval_steps'];

// The product: what the install runs for a person or an Agent. Tests, fixtures, the install proof and migrations are not.
const product = ['app', 'components', 'lib', 'worker', 'middleware.ts', 'instrumentation.ts', 'server.js', 'scripts/web-server.mjs'];
const code = /\.(?:[cm]?[jt]sx?)$/;
function* files(path) {
 if (!existsSync(path)) return;
 if (!statSync(path).isDirectory()) { if (code.test(path)) yield path; return; }
 for (const name of readdirSync(path)) yield* files(join(path, name));
}

/** Every place a text names an old Card table, as `table` and its line. @param {string} text */
const namedTables = text => text.split('\n').flatMap((line, at) =>
 oldCardTables.filter(table => new RegExp(`\\b${table}\\b`).test(line)).map(table => ({ table, line: at + 1 })));

test('the check finds an old Card table named in code, and passes code that names none', () => {
 assert.deepEqual(namedTables("const {data}=await db.from('work_cards').select('id');"), [{ table: 'work_cards', line: 1 }]);
 assert.deepEqual(namedTables("a\ndb.rpc('x').select('approval_steps(id)')"), [{ table: 'approval_steps', line: 2 }]);
 assert.deepEqual(namedTables("db.from('kanban_cards').select('task_id'); // a work_card's id"), []);
});

test('no product code names an old Card table (#846)', () => {
 const found = product.flatMap(root => [...files(root)].flatMap(file => namedTables(readFileSync(file, 'utf8')).map(({ table, line }) => `${file}:${line} ${table}`)));
 assert.deepEqual(found, []);
});

// The migrations of spec #831 (from its first, the Run's board brief) drop no table and delete no row of the old board.
const first = '20270420084400';
const specMigrations = () => readdirSync('supabase/migrations').filter(name => name.endsWith('.sql') && name.slice(0, 14) >= first);
test('the board spec\'s migrations drop no table and delete no row of the old board', () => {
 assert.ok(specMigrations().includes('20270421000000_kanban_cards.sql'), 'the spec\'s own migration is read');
 for (const name of specMigrations()) {
  const sql = readFileSync(`supabase/migrations/${name}`, 'utf8').replace(/--.*$/gm, '');
  assert.doesNotMatch(sql, /\bdrop\s+table\b/i, name);
  for (const table of oldCardTables) {
   assert.doesNotMatch(sql, new RegExp(`\\b(?:delete\\s+from|truncate(?:\\s+table)?)\\s+(?:only\\s+)?(?:public\\.)?${table}\\b`, 'i'), `${name}: ${table}`);
   assert.doesNotMatch(sql, new RegExp(`\\b(?:update|alter\\s+table)\\s+(?:only\\s+)?(?:public\\.)?${table}\\b`, 'i'), `${name}: ${table}`);
  }
 }
});
