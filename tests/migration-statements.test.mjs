import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { codeOutsideQuotes, topLevelStatements } from './sql-statements.mjs';

// Two runners apply the same migration files. The installer streams every pending file and its history row through one
// `psql --single-transaction`; the Supabase CLI (local database, CI, design compare, visual baselines) sends a file's
// statements with no transaction block of its own. So no file may open, end or name a transaction itself (that would end
// the installer's one transaction early), and no top-level statement may require a transaction block (LOCK TABLE fails
// under the Supabase CLI: SQLSTATE 25P01). A lock taken inside a DO block has neither problem and lasts until the
// enclosing transaction ends, whichever runner made it.

const migrations=readdirSync('supabase/migrations').filter(name=>name.endsWith('.sql')&&!name.endsWith('.verify.sql')).sort();
const transactionControl=/^(begin|start\s+transaction|commit|end|rollback|abort|savepoint|release|prepare\s+transaction|set\s+transaction|set\s+session\s+characteristics)\b/i;
const needsTransactionBlock=/^(lock\b|declare\s+\w+.*\bcursor\b)/is;

test('the statement reader keeps function bodies, strings and comments out of the statement list', () => {
 const sql=`-- lock table x;\ncreate function f() returns void language plpgsql as $body$ begin lock table t; commit; end $body$;\n/* begin; */ select 'a;b', "c;d";\ndo $$ begin perform 1; end $$;`;
 assert.deepEqual(topLevelStatements(sql).map(statement=>statement.split(/\s+/)[0]),['create','select','do']);
 assert.equal(topLevelStatements('lock table public.members in share row exclusive mode;')[0].split(' ')[0],'lock');
});

test('no migration controls its own transaction or needs a transaction block at top level', () => {
 assert.ok(migrations.length>20,'the migrations were found');
 const problems=migrations.flatMap(name=>topLevelStatements(readFileSync(`supabase/migrations/${name}`,'utf8'))
  .map((statement,index)=>({name,index,statement}))
  .filter(({statement})=>transactionControl.test(statement)||needsTransactionBlock.test(statement))
  .map(({name,index,statement})=>`${name} statement ${index}: ${statement.slice(0,60)}`));
 assert.deepEqual(problems,[]);
});

// #228 changes how functions that read Cards answer and nothing else, so the previous app version runs against it.
test("#228's migration only replaces functions", () => {
 const statements=topLevelStatements(readFileSync('supabase/migrations/20270103000000_hidden_card_readers.sql','utf8'));
 assert.ok(statements.length>0,'the migration was read');
 assert.deepEqual(statements.filter(statement=>!/^create\s+or\s+replace\s+function\s+public\.\w+\s*\(/i.test(statement)).map(statement=>statement.slice(0,60)),[]);
});

test('the statement reader knows escape strings, where a backslash escapes the quote (#259)', () => {
 assert.deepEqual(topLevelStatements("select E'it\\'s; fine', e'\\\\';\nselect 1/0"), ["select E'it\\'s; fine', e'\\\\'", 'select 1/0']);
 assert.deepEqual(topLevelStatements("select E'it''s; fine';\nselect 'a\\';\nselect 2;"), ["select E'it''s; fine'", "select 'a\\'", 'select 2']);
 assert.equal(topLevelStatements("select coalesce'x\\'; select 1").length, 2, 'an e that ends a word opens no escape string');
});

test('the statement reader nests block comments and opens a dollar quote only where a word ends (#259)', () => {
 const nested="select json_build_object('ok', false) /* outer /* inner */ ' */\n\\g /dev/null\nselect json_build_object('ok', true);";
 assert.match(codeOutsideQuotes(nested), /\\g/, 'the quote sits inside the outer comment, so the psql command after it is code');
 const glued="select json_build_object('ok', false) as result$tag$\n\\g /dev/null\nselect json_build_object('ok', true);";
 assert.match(codeOutsideQuotes(glued), /\\g/, 'result$tag$ is one name, not a dollar quote');
 assert.deepEqual(topLevelStatements('do $body$ begin perform 1; end $body$; select $$a;b$$'), ['do $body$ begin perform 1; end $body$', 'select $$a;b$$']);
});

test('a name ends where Postgres says: any character past ASCII belongs to it, as in its lexer (#259)', () => {
 // Postgres's lexer (scan.l): ident_cont is [A-Za-z\200-\377_0-9\$], so every byte past ASCII continues a name.
 for (const name of ['result́', 'result\u{1D400}', 'résumé']) {
  const glued=`select json_build_object('ok', false) as ${name}$tag$\n\\g /dev/null\nselect json_build_object('ok', true);`;
  assert.match(codeOutsideQuotes(glued), /\\g/, `${JSON.stringify(name)}$tag$ is one name`);
 }
 assert.deepEqual(topLevelStatements("select caféE'x\\'; select 1"), ["select caféE'x\\'", 'select 1'], 'an E that ends a longer name opens no escape string');
});
