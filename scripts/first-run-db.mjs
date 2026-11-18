import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { lane, originOf, portOf } from '../tests/lane.mjs';
const root=process.cwd();
// A browser test worker runs on its own local stack (tests/lane.mjs, #69): lane n has the app on port 3000+n and every
// Supabase port moved by 100*n. Outside a worker the lane is 0, the stack every other script uses.
const database=`postgresql://postgres:postgres@127.0.0.1:${portOf('db')}/postgres`;
const api=`http://127.0.0.1:${portOf('api')}`;

export function assertLocalTarget(baseURL, apiURL=process.env.NEXT_PUBLIC_SUPABASE_URL || api) {
 if(baseURL!==originOf() || apiURL!==api) throw new Error('First-run tests refuse non-local targets');
}
function localRun(sql,baseURL) {
 assertLocalTarget(baseURL);
 // Fixed connection, never the linked project or a caller-supplied database URL.
 return execFileSync('npx',['--no-install','supabase','db','query',sql,'--db-url',database,'--yes','-o','json','--agent','no'],{cwd:root,encoding:'utf8'});
}
// A statement that returns no rows (a DO block): the CLI prints its command tag, not JSON.
export function localStatement(sql,baseURL) {
 localRun(sql,baseURL);
}
export function localQuery(sql,baseURL) {
 const result=JSON.parse(localRun(sql,baseURL));
 // With --agent no, the CLI returns a plain array of row objects.
 if(!Array.isArray(result)) throw new Error('Local query returned an unexpected JSON result');
 return result;
}
// A reset meets the lane's own app in a deadlock when one of its sessions holds a lock the truncate needs while
// waiting for one the truncate holds (#326). Postgres rolls the whole transaction back and names the deadlock, so
// nothing was reset and the same reset is run again, up to five attempts, as freshSeed does (tests/fresh-seed.ts).
// Any other failure is the reset's own and is raised at once. Returns the pause before the next attempt, or null
// when the reset must fail.
export function resetRetryPause(stderr,attempt) {
 if(attempt>=5 || !String(stderr).includes('deadlock detected')) return null;
 return 200*attempt;
}
export function resetFirstRun(baseURL,seed=false) {
 assertLocalTarget(baseURL);
 const project=readFileSync(join(root,'supabase/config.toml'),'utf8').match(/^project_id\s*=\s*"([a-zA-Z0-9_-]+)"/m)?.[1];
 if(!project) throw new Error('Local Supabase project_id is missing or invalid');
 // The truncate takes every table's exclusive lock itself, and a session of the app that reads one table while asking
 // for another deadlocks with it. The reset ends this database's other sessions that hold a lock or are asking for one
 // first, so no such cycle can form; any that starts afterwards only waits. An idle session of the app's own pool holds
 // nothing and is left alone, so the app keeps its connections; the reset's own connection and every other psql are
 // left alone too.
 const sql=`select pg_terminate_backend(pid,5000) from pg_stat_activity
 where datname=current_database() and backend_type='client backend' and pid<>pg_backend_pid() and application_name<>'psql' and state<>'idle';
 do $$ declare tables text; begin
  select string_agg(format('%I.%I',schemaname,tablename),',') into tables from pg_tables where schemaname='public';
  execute 'truncate '||tables||' restart identity cascade';
 end $$;
 truncate auth.users cascade;
 insert into public.setup_claim(closed) values(false);
 ${seed?readFileSync(join(root,'supabase/seed.sql'),'utf8'):''}
 `;
 for(let attempt=1;;attempt++) {
  try {
   // Pin both connections to local sockets; --file=- makes psql wrap stdin in one transaction.
   execFileSync('docker',['--host','unix:///var/run/docker.sock','exec','-i',`supabase_db_${project}${lane?`-lane-${lane}`:''}`,'psql','-X','-h','/var/run/postgresql','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1','--single-transaction','--file=-'],{cwd:root,encoding:'utf8',input:sql});
   return;
  } catch(error) {
   const pause=resetRetryPause(error?.stderr,attempt);
   if(pause===null) throw error;
   Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,pause);
  }
 }
}
