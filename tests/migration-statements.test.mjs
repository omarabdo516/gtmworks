import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { topLevelStatements } from './sql-statements.mjs';

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
