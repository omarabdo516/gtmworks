import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

// Spec #864, #883: a Conversation's messages are kept in the Engine only, and the old Conversation record is switched
// off. No product code reads or writes its stored messages and files, its queued turns, its Run notes, reservations and
// resets, or its Run ends; the tables stay, untouched, until Omar removes them himself (ADR 0033 item 9). Channels keep
// their own record (channel_*), which this list does not name.
const oldConversationTables = ['conversation_messages', 'conversation_attachments', 'conversation_queued_turns',
 'conversation_notes', 'conversation_run_notes', 'conversation_run_reservations', 'conversation_run_resets',
 'conversation_run_ran_out', 'conversation_run_ends'];

// The product: what the install runs for a person or an Agent. Tests, fixtures, the install proof and migrations are not.
const product = ['app', 'components', 'lib', 'worker', 'middleware.ts', 'instrumentation.ts', 'server.js', 'scripts/web-server.mjs'];
const code = /\.(?:[cm]?[jt]sx?)$/;
function* files(path) {
 if (!existsSync(path)) return;
 if (!statSync(path).isDirectory()) { if (code.test(path)) yield path; return; }
 for (const name of readdirSync(path)) yield* files(join(path, name));
}

/** Every place a text names an old Conversation table, as `table` and its line. @param {string} text */
const namedTables = text => text.split('\n').flatMap((line, at) =>
 oldConversationTables.filter(table => new RegExp(`\\b${table}\\b`).test(line)).map(table => ({ table, line: at + 1 })));

test('the check finds an old Conversation table named in code, and passes code that names none', () => {
 assert.deepEqual(namedTables("const {data}=await db.from('conversation_messages').select('id');"), [{ table: 'conversation_messages', line: 1 }]);
 assert.deepEqual(namedTables("a\ndb.from('conversations').select('conversation_run_ends(run_id)')"), [{ table: 'conversation_run_ends', line: 2 }]);
 assert.deepEqual(namedTables("db.from('conversations').select('open_runs'); db.from('channel_messages'); // conversation_messagesX"), []);
});

test('no product code names an old Conversation table (#883)', () => {
 const found = product.flatMap(root => [...files(root)].flatMap(file => namedTables(readFileSync(file, 'utf8')).map(({ table, line }) => `${file}:${line} ${table}`)));
 assert.deepEqual(found, []);
});

// The migrations of spec #864 (from its first, the lists from the Engine) drop no table and delete no row of the old
// record. Its cutover drops the Company switch of #876, a column of companies, and nothing of the old record.
const first = '20270425000000';
const specMigrations = () => readdirSync('supabase/migrations').filter(name => name.endsWith('.sql') && name.slice(0, 14) >= first);
test('the Conversation spec\'s migrations drop no table and delete no row of the old record', () => {
 assert.ok(specMigrations().includes('20270430000000_conversation_record_off.sql'), 'the switch-off\'s own migration is read');
 for (const name of specMigrations()) {
  const sql = readFileSync(`supabase/migrations/${name}`, 'utf8').replace(/--.*$/gm, '');
  assert.doesNotMatch(sql, /\bdrop\s+table\b/i, name);
  for (const table of oldConversationTables) {
   assert.doesNotMatch(sql, new RegExp(`\\b(?:delete\\s+from|truncate(?:\\s+table)?)\\s+(?:only\\s+)?(?:public\\.)?${table}\\b`, 'i'), `${name}: ${table}`);
   assert.doesNotMatch(sql, new RegExp(`\\b(?:update|alter\\s+table)\\s+(?:only\\s+)?(?:public\\.)?${table}\\b`, 'i'), `${name}: ${table}`);
  }
 }
});
