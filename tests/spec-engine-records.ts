import { execFileSync } from 'node:child_process';
import { lane, workdirOf } from './lane.mjs';

// The Engine handle reads a Company's Engine record with the service role, as the server does (#782). A browser spec
// that drives library code in its own process (a Run's start and close, with the fake of the contract answering for the
// Engine) points that client at its own lane's database, where the seeded Companies' records are, by calling this in its
// beforeAll. Never as the spec is loaded: the runner loads every spec to list the suite, with no database up, and an
// address set then would reach every worker it starts, on every lane.
let done=false;
export function laneEngineRecords() {
 if(done) return;
 const env=execFileSync('npx',['--no-install','supabase','status','-o','env',...(lane?['--workdir',workdirOf(lane)]:[])],{encoding:'utf8'});
 const value=(name:string)=>env.match(new RegExp(`^${name}="(.*)"$`,'m'))?.[1]??'';
 process.env.NEXT_PUBLIC_SUPABASE_URL=value('API_URL');
 process.env.SUPABASE_SERVICE_ROLE_KEY=value('SERVICE_ROLE_KEY');
 // The key scripts/local-db.sh encrypted the seeded records with, as scripts/web.sh gives the app.
 process.env.WEBHOOK_ENCRYPTION_KEY??='AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';
 done=true;
}
