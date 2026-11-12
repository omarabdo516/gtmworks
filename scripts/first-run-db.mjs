import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
const root=process.cwd();
const database='postgresql://postgres:postgres@127.0.0.1:54322/postgres';

export function assertLocalTarget(baseURL, apiURL=process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://127.0.0.1:54321') {
 if(baseURL!=='http://127.0.0.1:3000' || apiURL!=='http://127.0.0.1:54321') throw new Error('First-run tests refuse non-local targets');
}
export function localQuery(sql,baseURL) {
 assertLocalTarget(baseURL);
 // Fixed connection, never the linked project or a caller-supplied database URL.
 const output=execFileSync('npx',['--no-install','supabase','db','query',sql,'--db-url',database,'--yes','-o','json','--agent','no'],{cwd:root,encoding:'utf8'});
 const result=JSON.parse(output);
 // With --agent no, the CLI returns a plain array of row objects.
 if(!Array.isArray(result)) throw new Error('Local query returned an unexpected JSON result');
 return result;
}
export function resetFirstRun(baseURL,seed=false) {
 assertLocalTarget(baseURL);
 const project=readFileSync(join(root,'supabase/config.toml'),'utf8').match(/^project_id\s*=\s*"([a-zA-Z0-9_-]+)"/m)?.[1];
 if(!project) throw new Error('Local Supabase project_id is missing or invalid');
 const sql=`do $$ declare tables text; begin
  select string_agg(format('%I.%I',schemaname,tablename),',') into tables from pg_tables where schemaname='public';
  execute 'truncate '||tables||' restart identity cascade';
 end $$;
 truncate auth.users cascade;
 insert into public.setup_claim(closed) values(false);
 ${seed?readFileSync(join(root,'supabase/seed.sql'),'utf8'):''}
 `;
 // Pin both connections to local sockets; --file=- makes psql wrap stdin in one transaction.
 execFileSync('docker',['--host','unix:///var/run/docker.sock','exec','-i',`supabase_db_${project}`,'psql','-X','-h','/var/run/postgresql','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1','--single-transaction','--file=-'],{cwd:root,encoding:'utf8',input:sql});
}
