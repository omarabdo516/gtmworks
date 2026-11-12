import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

// Two runners apply the same migration files. The installer streams every pending file and its history row through one
// `psql --single-transaction`; the Supabase CLI (local database, CI, design compare, visual baselines) sends a file's
// statements with no transaction block of its own. So no file may open, end or name a transaction itself (that would end
// the installer's one transaction early), and no top-level statement may require a transaction block (LOCK TABLE fails
// under the Supabase CLI: SQLSTATE 25P01). A lock taken inside a DO block has neither problem and lasts until the
// enclosing transaction ends, whichever runner made it.

// Top-level statements with comments removed. Strings, quoted names and dollar-quoted bodies are kept whole, so a
// semicolon or keyword inside a function body is never read as a statement.
export function topLevelStatements(sql) {
 const statements=[]; let current='', i=0;
 while(i<sql.length) {
  const rest=sql.slice(i,i+2);
  if(rest==='--') { const end=sql.indexOf('\n',i); i=end<0?sql.length:end; current+=' '; continue; }
  if(rest==='/*') { const end=sql.indexOf('*/',i+2); i=end<0?sql.length:end+2; current+=' '; continue; }
  if(sql[i]==="'"||sql[i]==='"') {
   const quote=sql[i]; let end=i+1;
   while(end<sql.length) { if(sql[end]===quote) { if(sql[end+1]===quote) { end+=2; continue; } break; } end++; }
   current+=sql.slice(i,end+1); i=end+1; continue;
  }
  const dollar=sql[i]==='$'&&sql.slice(i).match(/^\$([A-Za-z_]\w*)?\$/);
  if(dollar) { const end=sql.indexOf(dollar[0],i+dollar[0].length); const stop=end<0?sql.length:end+dollar[0].length; current+=sql.slice(i,stop); i=stop; continue; }
  if(sql[i]===';') { statements.push(current.trim()); current=''; i++; continue; }
  current+=sql[i]; i++;
 }
 statements.push(current.trim());
 return statements.filter(Boolean);
}

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
