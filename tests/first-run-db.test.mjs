import { test } from 'node:test';
import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import { readFileSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { localQuery, resetFirstRun, resetRetryPause } from '../scripts/first-run-db.mjs';

const baseURL='http://127.0.0.1:3000';

function stubExecution(t,implementation) {
 const command=t.mock.method(childProcess,'execFileSync',implementation);
 syncBuiltinESMExports();
 t.after(()=>{t.mock.restoreAll(); syncBuiltinESMExports();});
 const previous=process.env.NEXT_PUBLIC_SUPABASE_URL;
 process.env.NEXT_PUBLIC_SUPABASE_URL='http://127.0.0.1:54321';
 t.after(()=>{if(previous===undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL; else process.env.NEXT_PUBLIC_SUPABASE_URL=previous;});
 return command;
}

test('first-run reset streams SQL to local psql in a fail-fast transaction',t=>{
 const command=stubExecution(t,()=> '');
 resetFirstRun(baseURL);
 assert.equal(command.mock.callCount(),1);
 const [file,args,options]=command.mock.calls[0].arguments;
 const project=readFileSync('supabase/config.toml','utf8').match(/^project_id = "(.*)"/m)[1];
 assert.equal(file,'docker');
 assert.deepEqual(args,['--host','unix:///var/run/docker.sock','exec','-i',`supabase_db_${project}`,'psql','-X','-h','/var/run/postgresql','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1','--single-transaction','--file=-']);
 assert.equal(options.cwd,process.cwd());
 assert.equal(options.encoding,'utf8');
 assert.match(options.input,/schemaname='public'/);
 assert.match(options.input,/execute 'truncate '\|\|tables\|\|' restart identity cascade';/);
 assert.match(options.input,/end \$\$;\s+truncate auth\.users cascade;\s+insert into public\.setup_claim/);
 assert.doesNotMatch(options.input,/auth\.\w+[^;]*restart identity/i);
 assert.match(options.input,/insert into public\.setup_claim\(closed\) values\(false\);/);
 assert.doesNotMatch(options.input,/insert into public\.companies|\bbegin;|\bcommit;/i);
});

test('seed restore appends the unmodified seed after resetting to post-migration state',t=>{
 const command=stubExecution(t,()=> '');
 resetFirstRun(baseURL);
 resetFirstRun(baseURL,true);
 const empty=command.mock.calls[0].arguments[2].input;
 const restored=command.mock.calls[1].arguments[2].input;
 const seed=readFileSync('supabase/seed.sql','utf8');
 assert.equal(restored,empty.replace(/\n \n $/,()=>`\n ${seed}\n `));
 assert.doesNotMatch(restored,/update public\.setup_claim set closed=true/);
});

test('a reset that meets a deadlock runs its whole transaction again; any other failure is raised at once',t=>{
 const deadlock=Object.assign(new Error('Command failed'),{stderr:'psql:<stdin>:4: ERROR:  deadlock detected\nDETAIL:  Process 1231 waits for AccessExclusiveLock on relation 19537'});
 let calls=0;
 const command=stubExecution(t,()=>{ if(++calls===1) throw deadlock; return ''; });
 resetFirstRun(baseURL,true);
 assert.equal(command.mock.callCount(),2);
 assert.equal(command.mock.calls[1].arguments[2].input,command.mock.calls[0].arguments[2].input);
 // A failure that is not a deadlock left the database as it was: it says what is wrong and is not run again.
 const wrong=Object.assign(new Error('Command failed'),{stderr:'psql:<stdin>:5: ERROR:  relation "public.setup_claim" does not exist'});
 const other=stubExecution(t,()=>{throw wrong;});
 assert.throws(()=>resetFirstRun(baseURL),error=>error===wrong);
 assert.equal(other.mock.callCount(),1);
});

test('only a deadlock in a transaction rolled back whole is retried, five attempts at most',()=>{
 assert.equal(resetRetryPause('psql:<stdin>:4: ERROR:  deadlock detected',1),200);
 assert.equal(resetRetryPause('psql:<stdin>:4: ERROR:  deadlock detected',4),800);
 assert.equal(resetRetryPause('psql:<stdin>:4: ERROR:  deadlock detected',5),null);
 for(const [stderr,attempt] of [['psql:<stdin>:4: ERROR:  lock timeout',1],['psql:<stdin>:4: ERROR:  canceling statement due to statement timeout',2],['',1],[undefined,1],[null,3]])
  assert.equal(resetRetryPause(stderr,attempt),null,`${stderr} at attempt ${attempt}`);
});

test('local SELECTs parse the CLI non-agent row array and retain native JSON types',t=>{
 let output='[{"accounts":1,"people":1,"role":"owner","language":"ar"}]\n';
 const command=stubExecution(t,()=>output);
 const sql='select count(*)::int accounts from auth.users';
 assert.deepEqual(localQuery(sql,baseURL),[{accounts:1,people:1,role:'owner',language:'ar'}]);
 assert.deepEqual(command.mock.calls[0].arguments,['npx',['--no-install','supabase','db','query',sql,'--db-url','postgresql://postgres:postgres@127.0.0.1:54322/postgres','--yes','-o','json','--agent','no'],{cwd:process.cwd(),encoding:'utf8'}]);
 output='[]';
 assert.deepEqual(localQuery(sql,baseURL),[]);
 output='{"rows":[]}';
 assert.throws(()=>localQuery(sql,baseURL),/unexpected JSON/);
 output='not JSON';
 assert.throws(()=>localQuery(sql,baseURL),SyntaxError);
});

test('both helpers refuse remote targets before any command executes',t=>{
 const command=stubExecution(t,()=>{throw new Error('must not execute');});
 for(const app of ['https://app.example.com','http://localhost:3000',undefined]) {
  assert.throws(()=>resetFirstRun(app),/refuse non-local/);
  assert.throws(()=>localQuery('select 1',app),/refuse non-local/);
 }
 process.env.NEXT_PUBLIC_SUPABASE_URL='https://example.supabase.co';
 assert.throws(()=>resetFirstRun(baseURL,true),/refuse non-local/);
 assert.throws(()=>localQuery('select 1',baseURL),/refuse non-local/);
 assert.equal(command.mock.callCount(),0);
});

test('SQL execution failures propagate from resets and SELECTs',t=>{
 const failure=new Error('SQL failed');
 stubExecution(t,()=>{throw failure;});
 assert.throws(()=>resetFirstRun(baseURL),error=>error===failure);
 assert.throws(()=>resetFirstRun(baseURL,true),error=>error===failure);
 assert.throws(()=>localQuery('select 1',baseURL),error=>error===failure);
});
